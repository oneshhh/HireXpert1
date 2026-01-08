// supabaseClient.js — TEMPORARY: run app without Supabase
require('dotenv').config();

let supabase_second_db_service = null;

if (!process.env.SECOND_SUPABASE_URL || !process.env.SECOND_SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[SUPABASE] Supabase is disabled. Running in test mode.');
} else {
  const { createClient } = require('@supabase/supabase-js');
  supabase_second_db_service = createClient(
    process.env.SECOND_SUPABASE_URL,
    process.env.SECOND_SUPABASE_SERVICE_ROLE_KEY
  );
  console.log('[SUPABASE] Supabase client initialized.');
}

module.exports = { supabase_second_db_service };
