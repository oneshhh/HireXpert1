const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session");
const path = require("path"); // <-- restored
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

// Use your existing db.js which exports a Pool (ensure db.js exists)
const pool = require("./db");

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

// Fake user database (unchanged)
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

// ---------- Root -> serve login page ----------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// ---------- Login route ----------
app.post("/login", (req, res) => {
  const { email, password, department } = req.body;
  const user = users.find(
    (u) => u.email === email && u.password === password && u.department === department
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

// ---------- Dashboard routes ----------
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

// ---------- Nodemailer ----------
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
        to: email,
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

// ---------- Schedule interview (INSERT) ----------
app.post("/schedule", async (req, res) => {

  sendInterviewEmail(email, id, title, date, time);

  try {
    let { title, questions, timeLimits, date, time, email } = req.body;

    // normalize questions -> array
    if (typeof questions === "string") {
      try { questions = JSON.parse(questions); } catch (e) { questions = [questions]; }
    }
    if (!Array.isArray(questions)) questions = [String(questions)];

    // normalize timeLimits -> array of integers
    if (!timeLimits) timeLimits = [];
    if (typeof timeLimits === "string") {
      try { timeLimits = JSON.parse(timeLimits); } catch (e) { timeLimits = [parseInt(timeLimits) || 0]; }
    }
    if (!Array.isArray(timeLimits)) timeLimits = [parseInt(timeLimits) || 0];

    // ensure timeLimits has same length as questions
    while (timeLimits.length < questions.length) timeLimits.push(0);

    const id = uuidv4();
    const questionsArrayLiteral = toPostgresArray(questions);
    const timeLimitsArrayLiteral = `{${timeLimits.join(",")}}`;

    await pool.query(
      `UPDATE interviews 
      SET title=$1, questions=$2, time_limits=$3, date=$4, time=$5, email=$6
      WHERE id=$7`,
      [title, questionsArrayLiteral, timeLimitsArrayLiteral, date, time, email, req.params.id]
    );

    console.log("✅ Interview saved:", title);

    

// ---------- Fetch single interview by ID ----------
app.get("/api/interview/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM interviews WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ message: "Interview not found" });

    const row = result.rows[0];
    const questions = parseQuestionsField(row.questions);
    const timeLimits = row.time_limits || [];

    res.json({
      ...row,
      questions,
      timeLimits
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

    // normalize questions -> array
    if (typeof questions === "string") {
      try { questions = JSON.parse(questions); } catch (e) { questions = [questions]; }
    }
    if (!Array.isArray(questions)) questions = [String(questions)];

    // normalize timeLimits -> array
    if (!timeLimits) timeLimits = [];
    if (typeof timeLimits === "string") {
      try { timeLimits = JSON.parse(timeLimits); } catch (e) { timeLimits = [parseInt(timeLimits) || 0]; }
    }
    if (!Array.isArray(timeLimits)) timeLimits = [parseInt(timeLimits) || 0];

    // ensure timeLimits has same length as questions
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

    const formatted = result.rows.map(r => ({
      ...r,
      questions: r.questions || [],
      timeLimits: r.time_limits || [],
    }));

    res.json(formatted);
  } catch (err) {
    console.error("Error fetching interviews:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ---------- Candidate interview page ----------
app.get("/interview/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM interviews WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).send("<h1>Interview not found</h1>");

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

// ---------- Pages for edit/view ----------
app.get("/interview-edit.html", (req, res) => {
  if (req.session.user && req.session.user.department === "HR") {
    return res.sendFile(path.join(__dirname, "views", "interview-edit.html"));
  }
  res.send("<h1>Unauthorized</h1><a href='/'>Login Again</a>");
});

app.get("/interview-view.html", (req, res) => {
  if (req.session.user && req.session.user.department === "HR") {
    return res.sendFile(path.join(__dirname, "views", "interview-view.html"));
  }
  res.send("<h1>Unauthorized</h1><a href='/'>Login Again</a>");
});

// ---------- API route alias ----------
app.get("/api/interviews/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM interviews WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ message: "Interview not found" });

    const row = result.rows[0];
    res.json({
      title: row.title || "",
      questions: parseQuestionsField(row.questions),
      timeLimits: row.time_limits || [],
      date: row.date || "",
      time: row.time || "",
      email: row.email || "",
    });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ message: "Database error" });
  }
});


// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
