const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// DB file will live in project root
const db = new sqlite3.Database(path.join(__dirname, "hirexpert.db"), (err) => {
  if (err) console.error("❌ DB connection error:", err);
  else console.log("✅ Connected to SQLite DB");
});

// Create table if it doesn’t exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS interviews (
      id TEXT PRIMARY KEY,
      title TEXT,
      questions TEXT,
      \`date\` TEXT,
      \`time\` TEXT,
      email TEXT
    )
  `);
});

module.exports = db;
