// db.js — TEMPORARY: run app without DB (safe for testing)
const { Pool } = require('pg');
require('dotenv').config();

if (process.env.DB_DISABLED === 'true') {
  console.warn('[DB] DB is disabled. Running without database.');
  module.exports = null;
  return;
}

if (!process.env.DATABASE_URL) {
  console.warn('[DB] DATABASE_URL missing. Running without database.');
  module.exports = null;
  return;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // TEMP
  max: 5
});

pool.on('connect', () => {
  console.log('[DB] Connected successfully');
});

pool.on('error', (err) => {
  console.error('[DB] Pool error:', err);
});

module.exports = pool;
