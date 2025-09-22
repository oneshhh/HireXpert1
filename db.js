// db.js
const { Pool } = require("pg");

// Use Render's DATABASE_URL (set this in your Render Environment Variables)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // required for Render
  },
});

// Ensure the interviews table exists
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS interviews (
        id UUID PRIMARY KEY,
        title TEXT NOT NULL,
        questions JSONB NOT NULL,
        date DATE NOT NULL,
        time TEXT NOT NULL,
        email TEXT NOT NULL
      )
    `);
    console.log("✅ Connected to PostgreSQL & ensured interviews table exists");
  } catch (err) {
    console.error("❌ Error setting up database:", err);
  }
})();

module.exports = pool;
