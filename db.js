// db.js
const { Pool } = require("pg");

// Use Render's DATABASE_URL (add in your Render Environment Variables)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // needed for Render
  },
});

// Create table if it doesn’t exist
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS interviews (
        id UUID PRIMARY KEY,
        title TEXT,
        questions TEXT[],
        date DATE,
        time TEXT,
        email TEXT
      )
    `);
    console.log("✅ Connected to PostgreSQL & ensured table exists");
  } catch (err) {
    console.error("❌ Error setting up database:", err);
  }
})();

module.exports = pool;
