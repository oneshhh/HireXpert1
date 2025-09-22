const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session");
const path = require("path");
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Middleware ----------
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.use(cors({ origin: "*" }));
app.use(
  session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: true,
  })
);

// ---------- Fake user database ----------
const users = [
  { email: "hr@company.com", password: "hr123", department: "HR" },
  { email: "pmo@company.com", password: "pmo123", department: "PMO" },
  { email: "gta@company.com", password: "gta123", department: "GTA" },
];

// ---------- Helper: robust questions parser ----------
function parseQuestionsField(q) {
  if (!q) return [];
  if (Array.isArray(q)) return q;
  if (typeof q === "object") return q;
  if (typeof q === "string") {
    try {
      return JSON.parse(q);
    } catch (e) {
      if (/^\{.*\}$/.test(q)) {
        return q
          .replace(/^{|}$/g, "")
          .split(",")
          .map((s) => s.replace(/^"|"$/g, ""));
      }
      return [q];
    }
  }
  return [];
}

// ---------- Email sender helper ----------
function sendInterviewEmail(to, id, title, date, time) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "vanshu2004sabharwal@gmail.com",
      pass: "gbsksbtmkgqaldnq",
    },
  });

  const link = `http://localhost:${PORT}/interview/${id}`;

  const mailOptions = {
    from: '"HireXpert" <yourgmail@gmail.com>',
    to,
    subject: `Interview Scheduled: ${title}`,
    html: `
      <p>Dear Candidate,</p>
      <p>You have an interview scheduled for <b>${title}</b>.</p>
      <p><b>Date:</b> ${date}<br><b>Time:</b> ${time}</p>
      <p>Click <a href="${link}">here</a> to join your interview.</p>
      <p>Regards,<br>HireXpert Team</p>
    `,
  };

  transporter.sendMail(mailOptions, (err, info) => {
    if (err) console.error("Error sending email:", err);
    else console.log("Email sent:", info.response);
  });
}

// ---------- Routes ----------

// Root -> Login page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Login
app.post("/login", (req, res) => {
  const { email, password, department } = req.body;
  const user = users.find(
    (u) => u.email === email && u.password === password && u.department === department
  );

  if (user) {
    req.session.user = user;
    switch (user.department) {
      case "HR":
        return res.redirect("/HR_Dashboard.html");
      case "PMO":
        return res.redirect("/PMO_Dashboard.html");
      case "GTA":
        return res.redirect("/GTA_Dashboard.html");
      default:
        return res.status(401).json({ message: "Unauthorized department." });
    }
  } else {
    res.status(401).json({ message: "Invalid credentials or department." });
  }
});

// Dashboards
app.get("/HR_Dashboard.html", (req, res) => {
  if (req.session.user?.department === "HR") {
    return res.sendFile(path.join(__dirname, "views", "HR_Dashboard.html"));
  }
  res.send("<h1>Unauthorized</h1><a href='/'>Login Again</a>");
});

app.get("/PMO_Dashboard.html", (req, res) => {
  if (req.session.user?.department === "PMO") {
    return res.sendFile(path.join(__dirname, "views", "PMO_Dashboard.html"));
  }
  res.send("<h1>Unauthorized</h1><a href='/'>Login Again</a>");
});

app.get("/GTA_Dashboard.html", (req, res) => {
  if (req.session.user?.department === "GTA") {
    return res.sendFile(path.join(__dirname, "views", "GTA_Dashboard.html"));
  }
  res.send("<h1>Unauthorized</h1><a href='/'>Login Again</a>");
});

// ---------- Schedule interview ----------
app.post("/schedule", async (req, res) => {
  try {
    let { title, questions, timeLimits, date, time, email } = req.body;

    // Normalize questions
    if (typeof questions === "string") {
      try { questions = JSON.parse(questions); } catch (e) { questions = [questions]; }
    }
    if (!Array.isArray(questions)) questions = [String(questions)];

    // Normalize timeLimits
    if (!timeLimits) timeLimits = [];
    if (typeof timeLimits === "string") {
      try { timeLimits = JSON.parse(timeLimits); } catch (e) { timeLimits = [parseInt(timeLimits) || 0]; }
    }
    if (!Array.isArray(timeLimits)) timeLimits = [parseInt(timeLimits) || 0];

    while (timeLimits.length < questions.length) timeLimits.push(0);

    const id = uuidv4();
    const questionsArrayLiteral = `{${questions.map(q => `"${q}"`).join(",")}}`;
    const timeLimitsArrayLiteral = `{${timeLimits.join(",")}}`;

    await pool.query(
      `INSERT INTO interviews (id, title, questions, time_limits, date, time, email)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, title, questionsArrayLiteral, timeLimitsArrayLiteral, date, time, email]
    );

    console.log("✅ Interview saved:", title);

    // Send email AFTER saving to DB
    sendInterviewEmail(email, id, title, date, time);

    res.json({
      success: true,
      message: "Interview scheduled successfully",
      email,
      id,
      link: `/interview/${id}`,
    });
  } catch (err) {
    console.error("❌ Error inserting interview:", err);
    res.status(500).json({ message: "Error saving interview." });
  }
});

// ---------- Fetch single interview ----------
app.get("/api/interview/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM interviews WHERE id = $1", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ message: "Interview not found" });

    const row = result.rows[0];
    res.json({
      ...row,
      questions: parseQuestionsField(row.questions),
      timeLimits: row.time_limits || [],
    });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ message: "DB error" });
  }
});

// ---------- Update interview ----------
app.post("/api/interview/:id/update", async (req, res) => {
  try {
    let { title, questions, timeLimits, date, time, email } = req.body;

    if (typeof questions === "string") {
      try { questions = JSON.parse(questions); } catch (e) { questions = [questions]; }
    }
    if (!Array.isArray(questions)) questions = [String(questions)];

    if (!timeLimits) timeLimits = [];
    if (typeof timeLimits === "string") {
      try { timeLimits = JSON.parse(timeLimits); } catch (e) { timeLimits = [parseInt(timeLimits) || 0]; }
    }
    if (!Array.isArray(timeLimits)) timeLimits = [parseInt(timeLimits) || 0];

    while (timeLimits.length < questions.length) timeLimits.push(0);

    const questionsArrayLiteral = `{${questions.map(q => `"${q}"`).join(",")}}`;
    const timeLimitsArrayLiteral = `{${timeLimits.join(",")}}`;

    await pool.query(
      `UPDATE interviews 
       SET title=$1, questions=$2, time_limits=$3, date=$4, time=$5, email=$6
       WHERE id=$7`,
      [title, questionsArrayLiteral, timeLimitsArrayLiteral, date, time, email, req.params.id]
    );

    res.json({ message: "Interview updated successfully" });
  } catch (err) {
    console.error("Update failed:", err);
    res.status(500).json({ message: "Update failed" });
  }
});

// ---------- Delete interview ----------
app.delete("/api/interview/:id/delete", async (req, res) => {
  try {
    await pool.query("DELETE FROM interviews WHERE id = $1", [req.params.id]);
    res.json({ message: "Interview deleted successfully" });
  } catch (err) {
    console.error("Delete failed:", err);
    res.status(500).json({ message: "Delete failed" });
  }
});

// ---------- Fetch all interviews ----------
app.get("/api/interviews", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM interviews ORDER BY date DESC");
    res.json(result.rows.map(r => ({
      ...r,
      questions: r.questions || [],
      timeLimits: r.time_limits || [],
    })));
  } catch (err) {
    console.error("Error fetching interviews:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ---------- Candidate interview page ----------
// ---------- Candidate interview page ----------
app.get("/interview/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM interviews WHERE id = $1", [req.params.id]);
    if (!result.rows.length) return res.status(404).send("<h1>Interview not found</h1>");

    const row = result.rows[0];
    const questions = parseQuestionsField(row.questions);
    const timeLimits = row.time_limits || [];

    res.send(`
      <h1>Interview for ${row.title}</h1>
      <p><b>Date:</b> ${row.date}</p>
      <p><b>Time:</b> ${row.time}</p>
      <p><b>Questions:</b></p>
      <ul>
        ${questions.map((q, i) => `<li>${q} (Time Limit: ${timeLimits[i] || 0} sec)</li>`).join("")}
      </ul>
    `);
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).send("DB error");
  }
});

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
