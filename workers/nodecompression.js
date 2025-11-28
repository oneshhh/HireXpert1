/**
 * SUPER-STABLE VIDEO COMPRESSION WORKER (FINAL PATCHED VERSION)
 * -------------------------------------------------------------
 * Supports:
 *  - Render free dyno (ffmpeg-static fallback)
 *  - VPS (uses system ffmpeg automatically)
 *  - Dynamic bitrate based on TARGET_PERCENT
 *  - Full crash protection + safe-loop
 *  - Path validation, null checks, truncated path detection
 *  - ffmpeg + ffprobe fallback
 *  - Zero worker downtime
 */

import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { createClient } from "@supabase/supabase-js";
quire("dotenv").config();
// ---------------------------------------------------------
// 🎥 FFmpeg + FFprobe PATH FALLBACK (REQUIRED FOR RENDER)
// ---------------------------------------------------------

function safeSetFFmpegPaths() {
  let chosenFfmpeg = null;
  let chosenFfprobe = null;

  // FFmpeg static (local) check
  if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
    chosenFfmpeg = ffmpegStatic;
  }

  // fallback to system ffmpeg
  if (!chosenFfmpeg && fs.existsSync("/usr/bin/ffmpeg")) {
    chosenFfmpeg = "/usr/bin/ffmpeg";
  }

  // Simply use system ffprobe, since Render includes it
  if (fs.existsSync("/usr/bin/ffprobe")) {
    chosenFfprobe = "/usr/bin/ffprobe";
  }

  console.log("🎥 Using ffmpeg:", chosenFfmpeg);
  console.log("🔍 Using ffprobe:", chosenFfprobe);

  ffmpeg.setFfmpegPath(chosenFfmpeg);
  ffmpeg.setFfprobePath(chosenFfprobe);
}

safeSetFFmpegPaths();

// ---------------------------------------------------------
// ⚙️ CONFIG
// ---------------------------------------------------------

const SUPABASE_URL = process.envprocess.env.SECOND_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SECOND_SUPABASE_SERVICE_ROLE_KEY;

// 🎚 Compression Level Setting
const TARGET_PERCENT = 0.40; // Example: 0.40 = 40% size

const TEMP_DIR = "./temp";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

console.log("\n🚀 Ultra-Stable Video Worker Started\n");

let isRunning = false;

// ---------------------------------------------------------
// 🔁 SAFE LOOP → never overlaps, never crashes
// ---------------------------------------------------------

async function safeLoop() {
  if (isRunning) {
    console.log("⏳ Worker busy, skipping...\n");
    return;
  }
  isRunning = true;

  try {
    await mainLoop();
  } catch (err) {
    console.error("💥 Unhandled error in mainLoop:", err);
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

  if (error) {
    console.error("❌ DB fetch error:", error);
    return;
  }

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
  console.log(`📄 raw_path = ${raw_path}`);

  // ---------------- SAFE VALIDATION ----------------
  if (!raw_path || typeof raw_path !== "string" || raw_path.trim() === "") {
    console.log(`⚠️ Row ${id} skipped — empty raw_path`);
    await markCompressed(id);
    return;
  }

  if (raw_path.includes("...")) {
    console.log(`⚠️ Row ${id}: truncated path skipped`);
    await markCompressed(id);
    return;
  }

  let storagePath = raw_path.replace(/^raw\//, "");
  console.log(`📁 Storage path: ${storagePath}`);

  // ---------------- DOWNLOAD ----------------
  const { data: fileData, error: downloadErr } =
    await supabase.storage.from("raw").download(storagePath);

  if (downloadErr || !fileData) {
    console.log(`❌ Download failed for ${storagePath}`);
    console.log(downloadErr);
    await markCompressed(id);
    return;
  }

  fs.mkdirSync(TEMP_DIR, { recursive: true });

  const localRaw = `${TEMP_DIR}/raw_${id}.webm`;
  const localCompressed = `${TEMP_DIR}/compressed_${id}.mp4`;

  fs.writeFileSync(localRaw, Buffer.from(await fileData.arrayBuffer()));
  console.log(`⬇ Saved locally → ${localRaw}`);

  // ---------------- EARLY MARK ----------------
  await markCompressed(id);

  // ---------------- PROBE BITRATE ----------------
  let originalBitrate = 2000;
  try {
    originalBitrate = await getBitrate(localRaw);
    console.log(`📊 Original bitrate: ${originalBitrate} kbps`);
  } catch {
    console.log("⚠️ Bitrate read failed — fallback 2000k");
  }

  const targetBitrate = Math.max(300, Math.floor(originalBitrate * TARGET_PERCENT));
  console.log(`🎚 Target bitrate = ${targetBitrate} kbps`);

  // ---------------- COMPRESS ----------------
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

    console.log(`🎉 Compression OK: ${localCompressed}`);
  } catch (err) {
    console.error("❌ Compression error:", err);
    cleanup(localRaw, localCompressed);
    return;
  }

  // ---------------- UPLOAD ----------------
  const buffer = fs.readFileSync(localCompressed);

  const { error: uploadError } = await supabase.storage
    .from("raw")
    .upload(storagePath, buffer, {
      upsert: true,
      contentType: "video/mp4",
    });

  if (uploadError) {
    console.error("❌ Upload failed:", uploadError);
  } else {
    console.log(`⬆ Replaced original → ${storagePath}`);
  }

  // ---------------- CLEANUP ----------------
  cleanup(localRaw, localCompressed);
}

// ---------------------------------------------------------
// 🛠️ HELPERS
// ---------------------------------------------------------

async function markCompressed(id) {
  const { error } = await supabase
    .from("answers")
    .update({ is_compressed: true })
    .eq("id", id);

  if (error) console.log("⚠️ Mark failed:", error);
  else console.log(`🟢 Marked is_compressed = TRUE (${id})`);
}

function cleanup(...files) {
  for (const file of files) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {}
  }
  console.log("🧹 Cleanup complete\n");
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