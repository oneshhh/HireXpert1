// db.js  — Supabase / Render safe version (Option A quick fix)
// All important tunables are set in-code (hard-coded) per your request.

const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

// ---------------------------
// Basic env checks (no secrets printed)
// ---------------------------
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD) {
  console.error("[FATAL] Missing DB_HOST / DB_USER / DB_PASSWORD. Please set them in the environment.");
  process.exit(1);
}

// ---------------------------
// Hard-coded tunables (in-code)
// ---------------------------
// Per your request — these values are enforced in the code (not relying on env vars)
const PG_MAX_CLIENTS = 3;            // small per-instance pool to avoid pooler saturation
const PG_IDLE_MS = 30000;           // 30s
const PG_CONN_TIMEOUT_MS = 5000;    // 5s
const FORCE_NODE_ENV_PRODUCTION = true; // if true, we treat runtime as production for SSL logic
const FORCE_ACCEPT_SELF_SIGNED = true;  // Option A quick fix: accept self-signed certs (INSECURE — short-term)

// ---------------------------
// Build connection config
// ---------------------------
const connectionConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || "6543", 10), // default to Supabase pooler port
  database: process.env.DB_NAME || "postgres",
  max: PG_MAX_CLIENTS,
  idleTimeoutMillis: PG_IDLE_MS,
  connectionTimeoutMillis: PG_CONN_TIMEOUT_MS
};

// ---------------------------
// SSL handling (Option A)
// ---------------------------
let ssl;
if (FORCE_ACCEPT_SELF_SIGNED) {
  ssl = { rejectUnauthorized: false };
  console.warn("[DB] QUICK FIX: accepting self-signed certs (rejectUnauthorized=false). This is insecure; replace with CA later.");
} else {
  // If you later want strict verification, set FORCE_ACCEPT_SELF_SIGNED = false and provide PG_SSL_CERT via env.
  if (process.env.PG_SSL_CERT) {
    const caPath = '/tmp/pg_ca.pem';
    fs.writeFileSync(caPath, process.env.PG_SSL_CERT);
    ssl = { rejectUnauthorized: true, ca: fs.readFileSync(caPath).toString() };
    console.log('[DB] Using PG_SSL_CERT for TLS verification');
  } else {
    ssl = { rejectUnauthorized: true };
  }
}
connectionConfig.ssl = ssl;

// ---------------------------
// Create pool and helpers
// ---------------------------
const pool = new Pool(connectionConfig);

pool.on('error', (err) => {
  console.error("[DB] Unexpected PG pool error:", err);
});

async function waitForDb(retries = 6, baseDelay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      client.release();
      console.log(`[DB] ✅ Connected successfully to ${process.env.DB_HOST}:${connectionConfig.port}`);
      return;
    } catch (err) {
      const delay = baseDelay * Math.pow(2, i);
      console.warn(`[DB] Connection attempt ${i + 1}/${retries} failed: ${err.code || err.message}. Retrying in ${delay} ms…`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error("Failed to connect to the database after retries");
}

module.exports = { pool, waitForDb };
