// db.js
// Flexible DB loader: prefers split env vars (DB_HOST/DB_USER/DB_PASSWORD) and falls back to DATABASE_URL.
// Includes SSL options: accept self-signed (quick fix) or use a provided CA via PG_SSL_CERT.
// Exports: { pool, waitForDb }

const { Pool } = require('pg');
const fs = require('fs');

// Load .env (local dev). Render/Prod will provide actual env vars.
require('dotenv').config();

// -----------------------
// Tunables (change in-code or override with env if desired)
// -----------------------
const DEFAULT_MAX_CLIENTS = 3;
const DEFAULT_IDLE_MS = 30000;
const DEFAULT_CONN_TIMEOUT_MS = 5000;
const DEFAULT_RETRIES = 6;
const DEFAULT_BACKOFF_BASE_MS = 1000;

// If you want to force quick-accept of self-signed certs in-code, set FORCE_ACCEPT_SELF_SIGNED = true
// But better: set env PG_ACCEPT_SELF_SIGNED=true in Render (or locally) if you need the quick fix.
const FORCE_ACCEPT_SELF_SIGNED = false;

// -----------------------
// Helper: mask a connection string for logs (do not print secrets)
// -----------------------
function maskDatabaseUrl(url) {
  try {
    const u = new URL(url);
    const user = u.username || 'user';
    return `${user}:*****@${u.hostname}:${u.port || '5432'}${u.pathname || ''}`;
  } catch (e) {
    return 'invalid-url';
  }
}

// -----------------------
// Determine connection config
// Prefer split vars (DB_HOST, DB_USER, DB_PASSWORD). Otherwise, use DATABASE_URL.
// -----------------------
const hasSplit = !!(process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD);

let poolOptions = {};
let using = '';

if (hasSplit) {
  using = 'split-vars';
  const host = process.env.DB_HOST;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const port = parseInt(process.env.DB_PORT || '6543', 10); // default to Supabase pooler port if omitted
  const database = process.env.DB_NAME || process.env.DB_DATABASE || 'postgres';

  poolOptions = {
    host,
    port,
    user,
    password,
    database
  };

} else if (process.env.DATABASE_URL) {
  using = 'database-url';
  poolOptions = {
    connectionString: process.env.DATABASE_URL
  };
} else {
  console.error('[DB] ERROR: No database configuration found. Set DB_HOST/DB_USER/DB_PASSWORD OR DATABASE_URL.');
  // Exit early to avoid confusing runtime errors
  process.exit(1);
}

// -----------------------
// Pool tunables (allow env override, otherwise use defaults)
const maxClients = Number(process.env.PG_MAX_CLIENTS || DEFAULT_MAX_CLIENTS);
const idleMs = Number(process.env.PG_IDLE_MS || DEFAULT_IDLE_MS);
const connTimeoutMs = Number(process.env.PG_CONN_TIMEOUT_MS || DEFAULT_CONN_TIMEOUT_MS);

poolOptions.max = maxClients;
poolOptions.idleTimeoutMillis = idleMs;
poolOptions.connectionTimeoutMillis = connTimeoutMs;
// -----------------------

// -----------------------
// SSL handling
// Priority:
// 1. If FORCE_ACCEPT_SELF_SIGNED or PG_ACCEPT_SELF_SIGNED=true -> rejectUnauthorized: false (quick fix).
// 2. Else if PG_SSL_CERT provided (PEM text) -> write PEM to /tmp and use it (secure).
// 3. Else -> default strict verification (rejectUnauthorized: true).
// -----------------------
let ssl;
const acceptSelfSignedEnv = (process.env.PG_ACCEPT_SELF_SIGNED || '').toLowerCase() === 'true';

if (FORCE_ACCEPT_SELF_SIGNED || acceptSelfSignedEnv) {
  ssl = { rejectUnauthorized: false };
  console.warn('[DB] WARNING: accepting self-signed TLS certs (rejectUnauthorized=false). This is INSECURE — use only short-term.');
} else if (process.env.PG_SSL_CERT) {
  try {
    const caPath = '/tmp/pg_ca.pem';
    fs.writeFileSync(caPath, process.env.PG_SSL_CERT, { encoding: 'utf8' });
    const ca = fs.readFileSync(caPath).toString();
    ssl = { rejectUnauthorized: true, ca };
    console.log('[DB] Using PG_SSL_CERT for TLS verification (CA loaded).');
  } catch (e) {
    console.error('[DB] Failed to write/read PG_SSL_CERT. Falling back to strict verification without CA. Error:', e);
    ssl = { rejectUnauthorized: true };
  }
} else {
  // If NODE_ENV === 'production' we keep strict verification, otherwise still strict by default.
  ssl = { rejectUnauthorized: true };
}

// Attach ssl to poolOptions. If poolOptions already has connectionString, pg accepts ssl too.
poolOptions.ssl = ssl;

// -----------------------
// Create Pool
// -----------------------
const pool = new Pool(poolOptions);

// Pool-level error logging
pool.on('error', (err) => {
  console.error('[DB] Unexpected PG pool error:', err && err.stack ? err.stack : err);
});

// -----------------------
// waitForDb helper with retries + exponential backoff
// -----------------------
async function waitForDb(retries = DEFAULT_RETRIES, baseDelay = DEFAULT_BACKOFF_BASE_MS) {
  const label = using === 'split-vars' ? `${process.env.DB_HOST || 'unknown-host'}:${process.env.DB_PORT || '6543'}` :
    (process.env.DATABASE_URL ? maskDatabaseUrl(process.env.DATABASE_URL) : 'unknown-url');

  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      client.release();
      console.log(`[DB] Connected successfully (${label}). pool max=${maxClients}, ssl.rejectUnauthorized=${ssl.rejectUnauthorized}`);
      return;
    } catch (err) {
      const delay = baseDelay * Math.pow(2, i);
      // show both code and message and stack to help debugging
      console.warn(`[DB] Connection attempt ${i + 1}/${retries} failed: ${err && err.code ? err.code : err.message}. Retrying in ${delay}ms`);
      if (err && err.stack) console.debug(err.stack);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Failed to connect to the database after retries');
}

// -----------------------
// Export
// -----------------------
module.exports = { pool, waitForDb };
