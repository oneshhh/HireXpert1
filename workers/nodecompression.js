/**
 * SUPER-STABLE VIDEO COMPRESSION WORKER (CLEAN + FIXED)
 * -------------------------------------------------------------
 * - ES Modules only (Render compatible)
 * - ffmpeg-static + system fallback
 * - Dynamic bitrate compression
 * - Safe looping system (never overlaps)
 * - Full crash protection
 */

import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

/* ---------------------------------------------------------
 * 🎥 FFmpeg + FFprobe PATH FALLBACK
 * --------------------------------------------------------- */
function safeSetFFmpegPaths() {
  let ffmpegPath = null;
  let ffprobePath = null;

  if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
    ffmpegPath = ffmpegStatic;
  }

  if (!ffmpegPath && fs.existsSync("/usr/bin/ffmpeg")) {
    ffmpegPath = "/usr/bin/ffmpeg";
  }

  if (fs.existsSync("/usr/bin/ffprobe")) {
    ffprobePath = "/usr/bin/ffprobe";
  }

  console.log("🎥 Using ffmpeg:", ffmpegPath);
  console.log("🔍 Using ffprobe:", ffprobePath);

  ffmpeg.setFfmpegPath(ffmpegPath);
  ffmpeg.setFfprobePath(ffprobePath);
}

safeSetFFmpegPaths();

/* ---------------------------------------------------------
 * ⚙️ CONFIG (Safe for Render + Local)
 * --------------------------------------------------------- */
const SUPABASE_URL =
  process.env.SECOND_SUPABASE_URL ||
  "https://mytoggimxxnqlirfvtci.supabase.co";

const SUPABASE_SERVICE_KEY =
  process.env.SECOND_SUPABASE_SERVICE_ROLE_KEY ||
  "YOUR_FALLBACK_SERVICE_ROLE_KEY_HERE";

const TARGET_PERCENT = 0.40;
const TEMP_DIR = "./temp";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

console.log("\n🚀 Ultra-Stable Video Worker Started\n");

let isRunning = false;

/* ---------------------------------------------------------
 * 🔁 SAFE LOOP (never overlaps)
 * --------------------------------------------------------- */
async function safeLoop() {
  if (isRunning) {
    console.log("⏳ Worker busy, skipping...\n");
    return;
  }

  isRunning = true;
  try {
    await mainLoop();
  } catch (err) {
    console.error("💥 Error in mainLoop:", err);
  }
  isRunning = false;
}

safeLoop();
setInterval(safeLoop, 20000);

/* ---------------------------------------------------------
 * 🔍 MAIN LOOP
 * --------------------------------------------------------- */
async function mainLoop() {
  console.log("🔍 Querying videos where is_compressed = false ...");

  const { data: rows, error } = await supabase
    .from("answers")
    .select("*")
    .eq("is_compressed", false)
    .limit(20);

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
      console.error(`💥 Crash processing ID ${row.id}:`, err);
    }
  }
}

/* ---------------------------------------------------------
 * 🎬 PROCESS VIDEO
 * --------------------------------------------------------- */
async function processVideo(row) {
  const { id, raw_path } = row;

  console.log(`🎬 Processing row: ${id}`);
  console.log(`📄 raw_path = ${raw_path}`);

  if (!raw_path || typeof raw_path !== "string") {
    console.log(`⚠️ Skipping ${id}: invalid path`);
    await markCompressed(id);
    return;
  }

  if (raw_path.includes("...")) {
    console.log(`⚠️ Skipping ${id}: truncated path`);
    await markCompressed(id);
    return;
  }

  const storagePath = raw_path.replace(/^raw\//, "");
  console.log(`📁 Storage path: ${storagePath}`);

  // DOWNLOAD
  const { data: fileData, error: dlErr } =
    await supabase.storage.from("raw").download(storagePath);

  if (dlErr || !fileData) {
    console.log(`❌ Download failed for ${storagePath}`);
    console.log(dlErr);
    await markCompressed(id);
    return;
  }

  fs.mkdirSync(TEMP_DIR, { recursive: true });

  const localRaw = `${TEMP_DIR}/raw_${id}.webm`;
  const localCompressed = `${TEMP_DIR}/compressed_${id}.mp4`;

  fs.writeFileSync(localRaw, Buffer.from(await fileData.arrayBuffer()));
  console.log(`⬇ Saved locally → ${localRaw}`);

  await markCompressed(id);

  // GET ORIGINAL BITRATE
  let originalBitrate = 2000;
  try {
    originalBitrate = await getBitrate(localRaw);
    console.log(`📊 Original bitrate: ${originalBitrate} kbps`);
  } catch {
    console.log("⚠️ Bitrate read failed — fallback 2000k");
  }

  const targetBitrate = Math.max(300, Math.floor(originalBitrate * TARGET_PERCENT));
  console.log(`🎚 Target bitrate = ${targetBitrate} kbps`);

  // COMPRESS
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
    console.error("❌ Compression failed:", err);
    cleanup(localRaw, localCompressed);
    return;
  }

  // UPLOAD
  const buffer = fs.readFileSync(localCompressed);
  const { error: uploadErr } = await supabase.storage
    .from("raw")
    .upload(storagePath, buffer, {
      upsert: true,
      contentType: "video/mp4",
    });

  if (uploadErr) console.error("❌ Upload failed:", uploadErr);
  else console.log(`⬆ Replaced original → ${storagePath}`);

  cleanup(localRaw, localCompressed);
}

/* ---------------------------------------------------------
 * 🔧 HELPERS
 * --------------------------------------------------------- */
async function markCompressed(id) {
  const { error } = await supabase
    .from("answers")
    .update({ is_compressed: true })
    .eq("id", id);

  if (error) console.log("⚠️ Mark failed:", error);
  else console.log(`🟢 Marked is_compressed = TRUE (${id})`);
}

function cleanup(...files) {
  for (const f of files) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
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
        resolve(Math.floor(stream.bit_rate / 1000));
      } catch {
        reject("no bitrate");
      }
    });
  });
}
