import { Pool } from 'pg';
require('dotenv').config();

// =================================================================
// ===========        START OF DEBUGGING BLOCK           ===========
// =================================================================
console.log("\n--- DEBUGGING DATABASE CONNECTION ---");
console.log(`[INFO] Attempting to load DATABASE_URL from .env file...`);

if (!process.env.DATABASE_URL) {
    console.error("\n[FATAL] DATABASE_URL is UNDEFINED.");
    console.error("This is the cause of the crash. Please check the following:");
    console.error("1. Is the .env file in the same root directory as your package.json?");
    console.error("2. Is the variable name spelled correctly in your .env file?");
    console.error("3. Is the file named exactly '.env' and not '.env.txt'?");
    console.log("-------------------------------------\n");
    // Exit the process to prevent the crash and make the error clear
    process.exit(1);
}
console.log("-------------------------------------\n");
// =================================================================
// ===========         END OF DEBUGGING BLOCK            ===========
// =================================================================



const connectionConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
};

const pool = new Pool(connectionConfig);

(async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS interviews (
        id UUID PRIMARY KEY,
        title TEXT NOT NULL,
        questions TEXT[] NOT NULL,
        time_limits INTEGER[] NOT NULL,
        date DATE NOT NULL,
        time TEXT NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS candidate_sessions (
          session_id UUID PRIMARY KEY,
          interview_id UUID REFERENCES interviews(id) ON DELETE CASCADE,
          candidate_email VARCHAR(255) NOT NULL,
          status VARCHAR(50) DEFAULT 'Invited',
          results JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    console.log("✅ Connected to PostgreSQL & ensured all tables are correctly configured.");
  } catch (err) {
    console.error("❌ Error setting up database tables:", err);
  } finally {
    client.release();
  }
})();

export default pool;

