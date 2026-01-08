/**
 * One-time migration script: DB-B → DB-A
 * Safe to re-run (ON CONFLICT DO NOTHING)
 *
 * Run with:
 *   node migrate_db_b_to_a.js
 */

require("dotenv").config();

const { supabase_second_db_service } = require("./supabaseClient"); // DB-B
const pool = require("./db"); // DB-A (pg pool)

// ---------- helpers ----------

function normalizeJson(value) {
  if (value === null || value === undefined) return [];

  try {
    // unwrap repeatedly until it's no longer a string
    while (typeof value === "string") {
      value = JSON.parse(value);
    }

    // handle object-wrapped-string case: { "json": "..." }
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1
    ) {
      const inner = Object.values(value)[0];
      if (typeof inner === "string") {
        value = JSON.parse(inner);
      }
    }

    // final sanity
    if (typeof value === "object") return value;

    return [];
  } catch {
    return [];
  }
}



// ---------- migrate candidates ----------

async function migrateCandidates() {
  console.log("🔁 Migrating candidates...");

  let from = 0;
  const limit = 500;

  while (true) {
    const { data, error } = await supabase_second_db_service
      .from("candidates")
      .select("*")
      .range(from, from + limit - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const c of data) {
      await pool.query(
        `
        INSERT INTO public.candidates (
          id,
          interview_id,
          candidate_token,
          name,
          email,
          cam_ok,
          mic_ok,
          user_agent,
          created_at,
          candidate_code,
          resume_path
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
        )
        ON CONFLICT (interview_id, candidate_token) DO NOTHING
        `,
        [
          c.id,
          c.interview_id,
          c.candidate_token,
          c.name,
          c.email,
          c.cam_ok,
          c.mic_ok,
          c.user_agent,
          c.created_at,
          c.candidate_code,
          c.resume_path
        ]
      );
    }

    from += limit;
    console.log(`✅ Candidates migrated: ${from}`);
  }
}

// ---------- migrate answers ----------

async function migrateAnswers() {
  console.log("🔁 Migrating answers...");

  let from = 0;
  const limit = 500;

  while (true) {
    const { data, error } = await supabase_second_db_service
      .from("answers")
      .select("*")
      .range(from, from + limit - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const a of data) {
      const values = [
        a.id,
        a.interview_id,
        a.candidate_token,
        a.question_id,
        a.raw_path,
        a.processed_path,
        a.transcript_path,
        a.mime_type,
        a.file_size_bigint,
        a.duration_seconds,
        a.user_agent,
        a.total_warnings,
        a.question_warning_count,
        normalizeJson(a.warnings_json), // ✅ fixed
        a.session_tab_switch_count,
        a.rating,
        a.notes,
        a.status,
        a.error_message,
        a.error_code,
        a.retry_count,
        a.last_attempt_at,
        a.processed_at,
        a.transcoder_version,
        a.created_at,
        a.updated_at,
        normalizeJson(a.processed_paths),  // $27,
        normalizeJson(a.transcript_paths), // $28
        a.language,
        a.is_compressed,
        a.compression_attempts
      ];

      // Safety check (remove after first successful run if you want)
      if (values.length !== 31) {
        throw new Error(`Parameter count mismatch: ${values.length}`);
      }

      await pool.query(
        `
        INSERT INTO public.answers (
          id,
          interview_id,
          candidate_token,
          question_id,
          raw_path,
          processed_path,
          transcript_path,
          mime_type,
          file_size_bigint,
          duration_seconds,
          user_agent,
          total_warnings,
          question_warning_count,
          warnings_json,
          session_tab_switch_count,
          rating,
          notes,
          status,
          error_message,
          error_code,
          retry_count,
          last_attempt_at,
          processed_at,
          transcoder_version,
          created_at,
          updated_at,
          processed_paths,
          transcript_paths,
          language,
          is_compressed,
          compression_attempts
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,
          $19,$20,$21,$22,$23,$24,$25,$26,
          $27,$28,$29,$30,$31
        )
        ON CONFLICT (interview_id, candidate_token, question_id) DO NOTHING
        `,
        values
      );
    }

    from += limit;
    console.log(`✅ Answers migrated: ${from}`);
  }
}

// ---------- runner ----------

(async () => {
  try {
    console.log("🚀 Starting DB-B → DB-A migration");

    await migrateCandidates();
    await migrateAnswers();

    console.log("🎉 Migration completed successfully");
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
})();
