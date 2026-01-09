// supabaseClient.js
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

/**
 * STEP 3: CLIENT REPOINT
 *
 * We intentionally KEEP the exported variable names:
 *   - supabase_second_db
 *   - supabase_second_db_service
 *
 * But we point them to DATABASE A.
 *
 * This allows server.js to remain unchanged.
 */

// --------------------------------------
// DATABASE A (PRIMARY SUPABASE PROJECT)
// --------------------------------------

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// --------------------------------------
// WARNINGS IF KEYS ARE MISSING
// --------------------------------------

if (!supabaseUrl) {
  console.warn("WARNING: SUPABASE_URL is not set.");
}
if (!supabaseAnonKey) {
  console.warn("WARNING: SUPABASE_ANON_KEY is not set.");
}
if (!supabaseServiceRoleKey) {
  console.warn("WARNING: SUPABASE_SERVICE_ROLE_KEY is not set. Writes will FAIL.");
}

// --------------------------------------
// CREATE CLIENTS (NAMES KEPT FOR COMPATIBILITY)
// --------------------------------------

// 1) READ-ONLY (ANON) CLIENT
const supabase_second_db = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

// 2) SERVICE ROLE CLIENT (FULL ACCESS)
const supabase_second_db_service = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

// --------------------------------------
module.exports = {
  supabase_second_db,          // READ client (anon)
  supabase_second_db_service   // WRITE client (service role)
};
