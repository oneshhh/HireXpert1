const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// Persistent DB file
const dbPath = path.join(__dirname, "hirexpert.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error("❌ DB connection error:", err);
  else console.log(`✅ Connected to SQLite DB at ${dbPath}`);
});

// Ensure durability in concurrent or cloud environments
db.serialize(() => {
  db.run("PRAGMA journal_mode=WAL;");  // Write-Ahead Logging
  db.run("PRAGMA synchronous=NORMAL;"); 

  db.run(`
    CREATE TABLE IF NOT EXISTS interviews (
      id TEXT PRIMARY KEY,
      title TEXT,
      questions TEXT,
      date TEXT,
      time TEXT,
      email TEXT
    )
  `);
});

module.exports = db;
