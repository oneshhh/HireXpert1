// supabaseClient.js
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

// --- DB_B (Supabase Second Database) URLs & Keys ---
const secondSupabaseUrl = process.env.SECOND_SUPABASE_URL;

// Public anonymous key (read-only)
const secondSupabaseAnonKey = process.env.SECOND_SUPABASE_ANON_KEY;

// Service role key (FULL access: insert, update, delete — bypasses RLS)
const secondSupabaseServiceKey = process.env.SECOND_SUPABASE_SERVICE_ROLE_KEY;

// Warn if anything is missing
if (!secondSupabaseUrl) {
  console.warn("WARNING: SECOND_SUPABASE_URL is NOT SET.");
}
if (!secondSupabaseAnonKey) {
  console.warn("WARNING: SECOND_SUPABASE_ANON_KEY is NOT SET.");
}
if (!secondSupabaseServiceKey) {
  console.warn("WARNING: SECOND_SUPABASE_SERVICE_ROLE_KEY is NOT SET — writes to DB_B will FAIL.");
}

// --- Create BOTH clients ---
// Read-only client (safe for public endpoints)
const supabase_second_db_anon = createClient(
  secondSupabaseUrl,
  secondSupabaseAnonKey
);

// Full-access client (used ONLY by the backend for writing)
const supabase_second_db_service = createClient(
  secondSupabaseUrl,
  secondSupabaseServiceKey
);

module.exports = {
  supabase_second_db_anon,
  supabase_second_db_service
};
