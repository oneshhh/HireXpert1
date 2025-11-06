const { Pool } = require('pg');
require('dotenv').config();

// =================================================================
// ===========           START OF DEBUGGING BLOCK          ===========
// =================================================================
console.log("\n--- DEBUGGING DATABASE CONNECTION ---");
console.log(`[INFO] Attempting to load separate DB variables (DB_HOST, DB_USER...)`);

// [THE FIX] Check for the new variables, not DATABASE_URL
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD) {
    console.error("\n[FATAL] DB_HOST, DB_USER, or DB_PASSWORD are UNDEFINED.");
    console.error("This is the cause of the crash. Please check the following:");
    console.error("1. Are these variables set in the Render Environment Dashboard?");
    console.error("2. Are the variable names spelled correctly?");
    console.log("-------------------------------------\n");
    // Exit the process to prevent the crash and make the error clear
    process.exit(1);
} else {
    // This is a more accurate log.
    console.log(`[INFO] Database variables found. Will attempt connection to host: ${process.env.DB_HOST}`);
}
console.log("-------------------------------------\n");
// =================================================================
// ===========            END OF DEBUGGING BLOCK           ===========
// =================================================================


// --- THE CORRECT SSL LOGIC FOR SUPABASE ---
// This config is correct and uses the new variables.
const connectionConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    ssl: { 
        rejectUnauthorized: false 
    }
};
// --- END OF NEW LOGIC ---

const pool = new Pool(connectionConfig);

// This async block is a great way to test the connection on startup.
/*
(async () => {
  let client; // Define client outside try
  try {
    client = await pool.connect(); // Test the connection
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
        .interview_id UUID REFERENCES interviews(id) ON DELETE CASCADE,
          candidate_email VARCHAR(255) NOT NULL,
          status VARCHAR(50) DEFAULT 'Invited',
          results JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // This is the *real* success message
    console.log("✅ Connected to PostgreSQL & ensured all tables are correctly configured.");
  } catch (err) {
    // If the connection fails (e.g., ECONNREFUSED), this will log it.
    console.error("❌ Error during database startup connection or table setup:", err);
  } finally {
    if (client) {
      // Only release the client if it was successfully connected
      client.release();
    }
  }
})();
*/

module.exports = pool;