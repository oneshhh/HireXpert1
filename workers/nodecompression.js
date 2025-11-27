/**
 * SUPER-STABLE VIDEO COMPRESSION WORKER
 * ---------------------------------------------------------
 * Features:
 * - Runs every 20 seconds
 * - Fetches answers where is_compressed = false
 * - Skips invalid/null/truncated paths
 * - Immediately marks row as compressed to prevent loops
 * - Computes bitrate dynamically based on TARGET_PERCENT
 * - Handles all ffmpeg/storage/temp-file errors
 * - Never crashes, never overlaps, retries safely
 */

import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { createClient } from "@supabase/supabase-js";

ffmpeg.setFfmpegPath(ffmpegStatic);

// ---------------------------------------------------------
// ⚙️ CONFIG
// ---------------------------------------------------------
const SUPABASE_URL = "https://mytoggimxxnqlirfvtci.supabase.co";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15dG9nZ2lteHhucWxpcmZ2dGNpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzQxMjQ1OSwiZXhwIjoyMDcyOTg4NDU5fQ.BeOWV-v4QNEua46M9WQKtAJF84VS3dc-5C5KPDOsMV8";

//  ⭐ Compression level (0.30 = 30%, 0.50 = 50%, etc)
/**
 * ---------------------------------------------------------
 * 🎚 COMPRESSION LEVEL SETTINGS
 * ---------------------------------------------------------
 * TARGET_PERCENT controls how much of the original bitrate
 * we keep during compression.
 *
 * Examples:
 *   0.50  →  keep 50% of original bitrate  (medium quality)
 *   0.40  →  keep 40%                      (good balance)
 *   0.30  →  keep 30%                      (low size)
 *   0.20  →  keep 20%                      (very small files)
 * Adjust this value anytime without modifying other code.
 */

const TARGET_PERCENT = 0.40;
// ---------------------------------------------------------


// temp directory
const TEMP_DIR = "./temp";

// ---------------------------------------------------------
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

console.log("🚀 Video Compression Worker Started...\n");

let isRunning = false;

// ---------------------------------------------------------
// 🔁 SAFE LOOP
// ---------------------------------------------------------
async function safeLoop() {
  if (isRunning) {
    console.log("⏳ Previous loop still running… Skipping.\n");
    return;
  }

  isRunning = true;
  try {
    await mainLoop();
  } catch (err) {
    console.error(" Worker crashed inside mainLoop:", err);
  }
  isRunning = false;
}

safeLoop();
setInterval(safeLoop, 20000);

// ---------------------------------------------------------
// 🔍 MAIN LOOP
// ---------------------------------------------------------
async function mainLoop() {
  console.log("🔍 Querying videos where is_compressed = false ...");

  const { data: rows, error } = await supabase
    .from("answers")
    .select("*")
    .eq("is_compressed", false)
    .limit(30);

  if (error) return console.error("❌ DB fetch error:", error);

  if (!rows.length) {
    console.log("✔ No pending videos.\n");
    return;
  }

  console.log(`📦 Found ${rows.length} videos.\n`);

  for (const row of rows) {
    try {
      await processVideo(row);
    } catch (err) {
      console.error(`💥 processVideo crashed for ID ${row.id}:`, err);
    }
  }
}

// ---------------------------------------------------------
// 🎬 PROCESS VIDEO
// ---------------------------------------------------------
async function processVideo(row) {
  const { id, raw_path } = row;

  console.log(`🎬 Processing row: ${id}`);
  console.log("📄 raw_path =", raw_path);

  // ---------------- SAFE PATH VALIDATION ----------------

  if (!raw_path || typeof raw_path !== "string" || raw_path.trim() === "") {
    console.log(`⚠️ Row ${id} skipped — raw_path is null or empty.`);
    await markCompressed(id);
    return;
  }

  if (raw_path.includes("...")) {
    console.log(`⚠️ Row ${id}: raw_path contains truncated '...' → skipping`);
    await markCompressed(id);
    return;
  }

  // Remove prefix
  let storagePath = raw_path.replace(/^raw\//, "");
  console.log("📁 Storage path:", storagePath);

  // ---------------- STEP 1: DOWNLOAD ----------------

  const { data: downloadData, error: downloadError } =
    await supabase.storage.from("raw").download(storagePath);

  if (downloadError || !downloadData) {
    console.log(`❌ Download failed for ${storagePath}`);
    console.log(downloadError);
    await markCompressed(id);
    return;
  }

  fs.mkdirSync(TEMP_DIR, { recursive: true });

  const localRaw = `${TEMP_DIR}/raw_${id}.webm`;
  const localCompressed = `${TEMP_DIR}/compressed_${id}.mp4`;

  fs.writeFileSync(localRaw, Buffer.from(await downloadData.arrayBuffer()));
  console.log(`⬇ Saved locally → ${localRaw}`);

  // ---------------- STEP 1.5: EARLY MARKING ----------------

  await markCompressed(id);

  // ---------------- STEP 2: PROBE ORIGINAL BITRATE ----------------

  let originalBitrate = 2000; // fallback
  try {
    originalBitrate = await getBitrate(localRaw);
    console.log(`📊 Original bitrate: ${originalBitrate} kbps`);
  } catch {
    console.log("⚠️ Could not read bitrate, using fallback 2000k");
  }

  const targetBitrate = Math.floor(originalBitrate * TARGET_PERCENT);
  console.log(`🎚 Target bitrate (${TARGET_PERCENT * 100}%): ${targetBitrate} kbps`);

  // ---------------- STEP 3: COMPRESS ----------------

  console.log("🎬 Running compression...");
  try {
    await new Promise((resolve, reject) => {
      ffmpeg(localRaw)
        .videoCodec("libx264")
        .videoBitrate(`${targetBitrate}k`)
        .audioBitrate("64k")
        .on("end", resolve)
        .on("error", reject)
        .save(localCompressed);
    });
    console.log(`🎉 Compression complete → ${localCompressed}`);
  } catch (err) {
    console.error("❌ Compression failed:", err);
    cleanup(localRaw, localCompressed);
    return;
  }

  // ---------------- STEP 4: UPLOAD ----------------

  const fileBuffer = fs.readFileSync(localCompressed);

  const { error: uploadError } = await supabase.storage
    .from("raw")
    .upload(storagePath, fileBuffer, {
      contentType: "video/mp4",
      upsert: true,
    });

  if (uploadError) {
    console.error("❌ Upload failed:", uploadError);
  } else {
    console.log(`⬆ Replaced original: ${storagePath}`);
  }

  cleanup(localRaw, localCompressed);
}

// ---------------------------------------------------------
// 🔧 HELPERS
// ---------------------------------------------------------

async function markCompressed(id) {
  const { error } = await supabase
    .from("answers")
    .update({ is_compressed: true })
    .eq("id", id);

  if (error) console.log("⚠️ Failed to set is_compressed:", error);
  else console.log(`🟢 Marked as compressed: ${id}`);
}

function cleanup(...files) {
  for (const file of files) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (err) {
      console.log(`⚠️ Could not delete ${file}:`, err);
    }
  }
  console.log("🧹 Cleanup done\n");
}

function getBitrate(file) {
  return new Promise((resolve, reject) => {
    ffmpeg(file).ffprobe((err, data) => {
      if (err) return reject(err);
      try {
        const stream = data.streams.find((s) => s.codec_type === "video");
        const bitrate = Math.floor(stream.bit_rate / 1000);
        resolve(bitrate);
      } catch {
        reject("no bitrate");
      }
    });
  });
}
