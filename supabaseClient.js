// supabaseClient.js
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

// --------------------------------------
// DB_B (Supabase Second Database)
// --------------------------------------

// URL (same for both anon + service)
const secondSupabaseUrl = process.env.SECOND_SUPABASE_URL;

// ANON KEY (read-only) — your existing key
const secondSupabaseAnonKey = process.env.SECOND_SUPABASE_KEY;

// SERVICE ROLE KEY (full write access — must bypass RLS)
const secondSupabaseServiceKey = process.env.SECOND_SUPABASE_SERVICE_ROLE_KEY;

// --------------------------------------
// WARNINGS IF KEYS ARE MISSING
// --------------------------------------
if (!secondSupabaseUrl) {
  console.warn("WARNING: SECOND_SUPABASE_URL is not set.");
}
if (!secondSupabaseAnonKey) {
  console.warn("WARNING: SECOND_SUPABASE_KEY (anon key) is not set.");
}
if (!secondSupabaseServiceKey) {
  console.warn("WARNING: SECOND_SUPABASE_SERVICE_ROLE_KEY is not set. Writes will FAIL.");
}

// --------------------------------------
// CREATE BOTH CLIENTS
// --------------------------------------

// 1) ANON client (READ-ONLY) — KEEP THIS NAME AS REQUESTED
const supabase_second_db = createClient(
  secondSupabaseUrl,
  secondSupabaseAnonKey
);

// 2) SERVICE ROLE client (FULL ACCESS FOR WRITES)
const supabase_second_db_service = createClient(
  secondSupabaseUrl,
  secondSupabaseServiceKey
);

// --------------------------------------
module.exports = {
  supabase_second_db,          // READ client (anonymously)
  supabase_second_db_service   // WRITE client (service role)
};
