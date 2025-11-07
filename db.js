// db.js
const { Pool } = require('pg');
const fs = require('fs');

// Load .env for local dev (Render/Prod will use real env)
require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

// Support either a single DATABASE_URL OR individual DB_* vars
const useUrl = !!process.env.DATABASE_URL;

const connectionString = process.env.DATABASE_URL || null;

// If not using DATABASE_URL, build a config from DB_HOST / DB_USER / ...
const host = process.env.DB_HOST || null;
const user = process.env.DB_USER || null;
const password = process.env.DB_PASSWORD || null;
const database = process.env.DB_NAME || process.env.DB_DATABASE || 'postgres';

// parse port with sensible default for Supabase pooler (6543) or fallback to 5432
const port = process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : (process.env.SUPABASE_POOLER === 'true' ? 6543 : 5432);

// Pool tunables (small conservative defaults — adjust via env on Render)
const MAX_CLIENTS = Number(process.env.PG_MAX_CLIENTS || 3);
const IDLE_TIMEOUT_MS = Number(process.env.PG_IDLE_MS || 30000);
const CONNECTION_TIMEOUT_MS = Number(process.env.PG_CONN_TIMEOUT_MS || 5000);

// SSL handling: For local/dev we allow self-signed; set rejectUnauthorized=true in production and provide CA if needed
const ssl = isProd ? { rejectUnauthorized: true } : { rejectUnauthorized: false };

// Validate we have either a connection string or host/user/password
if (!connectionString && (!host || !user || !password)) {
  console.warn('[DB] WARNING: DATABASE_URL not set and DB_HOST/DB_USER/DB_PASSWORD not fully provided.');
  console.warn('[DB] If you intended to use split variables, please set DB_HOST, DB_USER, DB_PASSWORD (or set DATABASE_URL).');
  // Do NOT exit here - let waitForDb handle startup retries; exiting immediately can obscure real runtime behavior.
}

// Build pool options
const poolOptions = connectionString ? {
  connectionString,
  max: MAX_CLIENTS,
  idleTimeoutMillis: IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  ssl
} : {
  host,
  port,
  user,
  password,
  database,
  max: MAX_CLIENTS,
  idleTimeoutMillis: IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  ssl
};

const pool = new Pool(poolOptions);

// Pool-level error handling
pool.on('error', (err) => {
  console.error('[DB] Unexpected PG pool error:', err);
});

// Helper: waitForDb with retries + exponential backoff
async function waitForDb(retries = 6, baseDelayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      client.release();
      console.log('[DB] connected (host:', (connectionString ? '(via DATABASE_URL)' : host) + ', port:', port + ')');
      return;
    } catch (err) {
      const delay = baseDelayMs * Math.pow(2, i); // exponential backoff
      console.warn(`[DB] connect attempt ${i + 1}/${retries} failed: ${err.code || err.message}. retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Failed to connect to the database after retries');
}

module.exports = { pool, waitForDb };
