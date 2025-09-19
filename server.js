const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session");
const path = require("path");
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const { Pool } = require("pg");

// -----------------------------
// Database connection (Postgres)
// -----------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // set this in Render
  ssl: { rejectUnauthorized: false }
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
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

// Fake user database
const users = [
  { email: "hr@company.com", password: "hr123", department: "HR" },
  { email: "pmo@company.com", password: "pmo123", department: "PMO" },
  { email: "gta@company.com", password: "gta123", department: "GTA" },
];

// Default route -> login page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Login route
app.post("/login", (req, res) => {
  const { email, password, department } = req.body;
  const user = users.find(
    (u) =>
      u.email === email &&
      u.password === password &&
      u.department === department
  );

  if (user) {
    req.session.user = user;
    switch (user.department) {
      case "HR":
        res.redirect("/HR_Dashboard.html");
        break;
      case "PMO":
        res.redirect("/PMO_Dashboard.html");
        break;
      case "GTA":
        res.redirect("/GTA_Dashboard.html");
        break;
      default:
        res.status(401).json({ message: "Unauthorized department." });
        break;
    }
  } else {
    res.status(401).json({ message: "Invalid credentials or department." });
  }
});

// Dashboard routes with access control
app.get("/HR_Dashboard.html", (req, res) => {
  if (req.session.user && req.session.user.department === "HR") {
    return res.sendFile(path.join(__dirname, "views", "HR_Dashboard.html"));
  }
  res.send("<h1>Unauthorized</h1><a href='/'>Login Again</a>");
});

app.get("/PMO_Dashboard.html", (req, res) => {
  if (req.session.user && req.session.user.department === "PMO") {
    return res.sendFile(path.join(__dirname, "views", "PMO_Dashboard.html"));
  }
  res.send("<h1>Unauthorized</h1><a href='/'>Login Again</a>");
});

app.get("/GTA_Dashboard.html", (req, res) => {
  if (req.session.user && req.session.user.department === "GTA") {
    return res.sendFile(path.join(__dirname, "views", "GTA_Dashboard.html"));
  }
  res.send("<h1>Unauthorized</h1><a href='/'>Login Again</a>");
});

// -----------------------------
// Schedule interview (insert)
// -----------------------------
app.post("/schedule", async (req, res) => {
  const { title, questions, date, time, email } = req.body;

  if (!title || !questions || !date || !time || !email) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const id = uuidv4();
  const questionsStr = JSON.stringify(questions);

  try {
    await pool.query(
      `INSERT INTO interviews (id, title, questions, date, time, email)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, title, questionsStr, date, time, email]
    );

    console.log("Interview saved:", title);
    sendInterviewEmail(email, id, title, date, time);

    res.json({
      success: true,
      message: "Interview scheduled successfully",
      email,
      id,
      link: `/interview/${id}`,
    });
  } catch (err) {
    console.error("Error inserting interview:", err);
    res.status(500).json({ message: "Error saving interview." });
  }
});

// -----------------------------
// Fetch single interview by ID
// -----------------------------
app.get("/api/interview/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM interviews WHERE id = $1",
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Interview not found" });
    }

    const row = result.rows[0];
    res.json({
      ...row,
      questions: row.questions ? JSON.parse(row.questions) : [],
    });
  } catch (err) {
    res.status(500).json({ message: "DB error" });
  }
});

// -----------------------------
// Update interview
// -----------------------------
app.post("/api/interview/:id/update", async (req, res) => {
  const { title, questions, date, time, email } = req.body;
  const questionsStr = JSON.stringify(questions);

  try {
    await pool.query(
      `UPDATE interviews 
       SET title = $1, questions = $2, date = $3, time = $4, email = $5
       WHERE id = $6`,
      [title, questionsStr, date, time, email, req.params.id]
    );
    res.json({ message: "Interview updated successfully" });
  } catch (err) {
    res.status(500).json({ message: "Update failed" });
  }
});

// -----------------------------
// Delete interview
// -----------------------------
app.delete("/api/interview/:id/delete", async (req, res) => {
  try {
    await pool.query("DELETE FROM interviews WHERE id = $1", [req.params.id]);
    res.json({ message: "Interview deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Delete failed" });
  }
});

// -----------------------------
// Fetch all interviews (HR dashboard)
// -----------------------------
app.get("/api/interviews", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM interviews");
    const formatted = result.rows.map((r) => ({
      ...r,
      questions: r.questions ? JSON.parse(r.questions) : [],
    }));
    res.json(formatted);
  } catch (err) {
    console.error("Error fetching interviews:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// -----------------------------
// Candidate interview page
// -----------------------------
app.get("/interview/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM interviews WHERE id = $1",
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).send("<h1>Interview not found</h1>");
    }

    const row = result.rows[0];
    const questions = row.questions ? JSON.parse(row.questions) : [];

    res.send(`
      <h1>Interview for ${row.title}</h1>
      <p><b>Date:</b> ${row.date}</p>
      <p><b>Time:</b> ${row.time}</p>
      <p><b>Questions:</b></p>
      <ul>
        ${questions.map((q) => `<li>${q}</li>`).join("")}
      </ul>
    `);
  } catch (err) {
    res.status(500).send("DB error");
  }
});

// -----------------------------
// Logout
// -----------------------------
app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/");
});

// -----------------------------
// Interview edit page
// -----------------------------
app.get("/interview-edit.html", (req, res) => {
  if (req.session.user && req.session.user.department === "HR") {
    return res.sendFile(path.join(__dirname, "views", "interview-edit.html"));
  }
  res.send("<h1>Unauthorized</h1><a href='/'>Login Again</a>");
});

// -----------------------------
// Interview view page
// -----------------------------
app.get("/interview-view.html", (req, res) => {
  if (req.session.user && req.session.user.department === "HR") {
    res.sendFile(path.join(__dirname, "views", "interview-view.html"));
  } else {
    res.send("<h1>Unauthorized</h1><a href='/'>Login Again</a>");
  }
});

// -----------------------------
// API route to fetch interview JSON
// -----------------------------
app.get("/api/interviews/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM interviews WHERE id = $1",
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Interview not found" });
    }

    const row = result.rows[0];
    res.json({
      title: row.title || "",
      questions: row.questions ? JSON.parse(row.questions) : [],
      date: row.date || "",
      time: row.time || "",
      email: row.email || "",
    });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// -----------------------------
// Email sender
// -----------------------------
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
    if (err) {
      console.error("Error sending email:", err);
    } else {
      console.log("Email sent:", info.response);
    }
  });
}

// -----------------------------
// Start server
// -----------------------------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
