// supabaseClient.js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const secondSupabaseUrl = process.env.SECOND_SUPABASE_URL;
const secondSupabaseKey = process.env.SECOND_SUPABASE_KEY;

if (!secondSupabaseUrl || !secondSupabaseKey) {
    console.warn("WARNING: SECOND_SUPABASE_URL or SECOND_SUPABASE_KEY is not set.");
    console.warn("The 'Review Submissions' tab will not be able to load data.");
}

const supabase_second_db = createClient(secondSupabaseUrl, secondSupabaseKey);

module.exports = { supabase_second_db };