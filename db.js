// db.js — debug-hardened quick-fix (prefers DATABASE_URL, forces quick TLS accept, conservative pool)
// Replace your current db.js with this. This is intended as a temporary debugging/repair step.

const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

// ----------------- Hard-coded conservative settings (temporary) -----------------
const MAX_CLIENTS = 1;                     // VERY conservative while debugging/recovering
const IDLE_TIMEOUT_MS = 30000;
const CONNECTION_TIMEOUT_MS = 20000;       // give slow nodes more time
const WAIT_RETRIES = 6;
const WAIT_BASE_MS = 1000;

// ----------------- Choose connection source -----------------
const usingDatabaseUrl = !!process.env.DATABASE_URL;
let poolOptions = {};

if (usingDatabaseUrl) {
  // Prefer explicit DATABASE_URL (use same string you tested locally)
  poolOptions = { connectionString: process.env.DATABASE_URL };
  console.log('[DB] Using DATABASE_URL (preferred). Masked:', (() => {
    try { const u = new URL(process.env.DATABASE_URL); return `${u.username}:*****@${u.hostname}:${u.port}${u.pathname}`; } catch(e){ return '[invalid DATABASE_URL]'; }
  })());
} else if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD) {
  // Fallback to split vars
  poolOptions = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '6543', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'postgres'
  };
  console.log('[DB] Using split DB env vars. Host:', poolOptions.host + ':' + poolOptions.port, 'User:', poolOptions.user);
} else {
  console.error('[DB] No DATABASE_URL and no DB_HOST/DB_USER/DB_PASSWORD — exiting.');
  process.exit(1);
}

// ----------------- SSL quick-fix (temporary) -----------------
// Force the quick workaround: do not verify certificate chain during this recovery period.
// WARNING: this is insecure. Replace with proper CA (PG_SSL_CERT) as soon as possible.
poolOptions.ssl = { rejectUnauthorized: false };
console.warn('[DB] QUICK FIX: SSL certificate verification disabled (rejectUnauthorized=false). This is insecure and temporary.');

// ----------------- Pool tunables -----------------
poolOptions.max = Number(process.env.PG_MAX_CLIENTS || MAX_CLIENTS);
poolOptions.idleTimeoutMillis = Number(process.env.PG_IDLE_MS || IDLE_TIMEOUT_MS);
poolOptions.connectionTimeoutMillis = Number(process.env.PG_CONN_TIMEOUT_MS || CONNECTION_TIMEOUT_MS);

// ----------------- Create pool and logging -----------------
const pool = new Pool(poolOptions);

pool.on('error', (err) => {
  console.error('[DB] Pool error:', err && err.stack ? err.stack : err);
});

// ----------------- Improved waitForDb with AggregateError drilling -----------------
async function waitForDb(retries = WAIT_RETRIES, baseDelay = WAIT_BASE_MS) {
  const label = usingDatabaseUrl
    ? (process.env.DATABASE_URL ? (() => { try { const u = new URL(process.env.DATABASE_URL); return `${u.hostname}:${u.port}`; } catch(e){ return 'DATABASE_URL'; } })() : 'DATABASE_URL')
    : `${poolOptions.host}:${poolOptions.port}`;

  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      client.release();
      console.log(`[DB] Connected successfully (${label}). pool.max=${poolOptions.max}, ssl.rejectUnauthorized=${poolOptions.ssl.rejectUnauthorized}`);
      return;
    } catch (err) {
      const delay = baseDelay * Math.pow(2, i);
      // If AggregateError from pg-pool, it contains .errors array
      if (err && err.name === 'AggregateError' && Array.isArray(err.errors)) {
        console.warn(`[DB] Connection attempt ${i+1}/${retries} failed with AggregateError: ${err.message}. Retrying in ${delay}ms`);
        err.errors.forEach((e, idx) => {
          console.error(`[DB]   inner[${idx}] -> code=${e.code || 'n/a'} message=${e.message || e}`);
          if (e.stack) console.debug(e.stack);
        });
      } else {
        console.warn(`[DB] Connection attempt ${i+1}/${retries} failed: ${err && (err.code || err.message) ? (err.code || err.message) : err}. Retrying in ${delay}ms`);
        if (err && err.stack) console.debug(err.stack);
      }
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // Final failure
  // Capture one last attempt error for logs (connect once more to get proper final error if possible)
  try {
    const client = await pool.connect();
    client.release();
    console.log('[DB] Unexpectedly connected on final attempt.');
    return;
  } catch (finalErr) {
    console.error('[DB] Final connect attempt failed:', finalErr && (finalErr.code || finalErr.message) ? (finalErr.code || finalErr.message) : finalErr);
    if (finalErr && finalErr.stack) console.debug(finalErr.stack);
    throw new Error('Failed to connect to the database after retries');
  }
}

module.exports = { pool, waitForDb };
