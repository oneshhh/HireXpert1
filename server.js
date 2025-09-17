const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session");
const path = require("path");
const db = require("./db");
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid"); // unique IDs

const app = express();
const PORT = 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.use(session({
  secret: "supersecretkey",
  resave: false,
  saveUninitialized: true
}));

// Fake user database
const users = [
  { email: "hr@company.com", password: "hr123", department: "HR" },
  { email: "pmo@company.com", password: "pmo123", department: "PMO" },
  { email: "gta@company.com", password: "gta123", department: "GTA" }
];

// Default route -> login page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Login route
app.post("/login", (req, res) => {
  const { email, password, department } = req.body;
  const user = users.find(u => u.email === email && u.password === password && u.department === department);

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
app.post("/schedule", (req, res) => {
  const { title, questions, date, time, email } = req.body;

  if (!title || !questions || !date || !time || !email) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const id = uuidv4();
  const questionsStr = JSON.stringify(questions);

  db.run(
    `INSERT INTO interviews (id, title, questions, \`date\`, \`time\`, email)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, title, questionsStr, date, time, email],
    (err) => {
      if (err) {
        console.error("❌ Error inserting interview:", err);
        return res.status(500).json({ message: "Error saving interview." });
      }

      console.log("✅ Interview saved:", title);
      sendInterviewEmail(email, id, title, date, time);

      res.json({
        success: true,
        message: "Interview scheduled successfully",
        email,
        id,
        link: `/interview/${id}`
      });
    }
  );
});

// -----------------------------
// Fetch single interview by ID
// -----------------------------
app.get("/api/interview/:id", (req, res) => {
  db.get(`SELECT * FROM interviews WHERE id = ?`, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ message: "DB error" });
    if (!row) return res.status(404).json({ message: "Interview not found" });

    res.json({
      ...row,
      questions: JSON.parse(row.questions)
    });
  });
});

// -----------------------------
// Update interview
// -----------------------------
app.post("/api/interview/:id/update", (req, res) => {
  const { title, questions, date, time, email } = req.body;
  const questionsStr = JSON.stringify(questions);

  db.run(
    `UPDATE interviews 
     SET title = ?, questions = ?, \`date\` = ?, \`time\` = ?, email = ?
     WHERE id = ?`,
    [title, questionsStr, date, time, email, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ message: "Update failed" });
      res.json({ message: "Interview updated successfully" });
    }
  );
});

// -----------------------------
// Delete interview
// -----------------------------
app.delete("/api/interview/:id/delete", (req, res) => {
  db.run(`DELETE FROM interviews WHERE id = ?`, [req.params.id], function (err) {
    if (err) return res.status(500).json({ message: "Delete failed" });
    res.json({ message: "Interview deleted successfully" });
  });
});

// -----------------------------
// Fetch all interviews (HR dashboard)
// -----------------------------
app.get("/api/interviews", (req, res) => {
  db.all("SELECT * FROM interviews", [], (err, rows) => {
    if (err) {
      console.error("❌ Error fetching interviews:", err);
      return res.status(500).json({ error: "Database error" });
    }

    const formatted = rows.map(r => ({
      ...r,
      questions: JSON.parse(r.questions)
    }));
    res.json(formatted);
  });
});

// -----------------------------
// Candidate interview page
// -----------------------------
app.get("/interview/:id", (req, res) => {
  db.get(`SELECT * FROM interviews WHERE id = ?`, [req.params.id], (err, row) => {
    if (err) return res.status(500).send("DB error");
    if (!row) return res.status(404).send("<h1>Interview not found</h1>");

    const questions = JSON.parse(row.questions);
    res.send(`
      <h1>Interview for ${row.title}</h1>
      <p><b>Date:</b> ${row.date}</p>
      <p><b>Time:</b> ${row.time}</p>
      <p><b>Questions:</b></p>
      <ul>
        ${questions.map(q => `<li>${q}</li>`).join("")}
      </ul>
    `);
  });
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
app.get('/interview-view.html', (req, res) => {
  if (req.session.user && req.session.user.department === "HR") {
    res.sendFile(path.join(__dirname, 'views', 'interview-view.html'));
  } else {
    res.send("<h1>Unauthorized</h1><a href='/'>Login Again</a>");
  }
});


// -----------------------------
// API route to fetch interview JSON (SQLite version)
app.get("/api/interviews/:id", (req, res) => {
  const id = req.params.id;

  db.get("SELECT * FROM interviews WHERE id = ?", [id], (err, row) => {
    if (err) {
      console.error("❌ DB error:", err);
      return res.status(500).json({ message: "Database error" });
    }
    if (!row) {
      return res.status(404).json({ message: "Interview not found" });
    }

    res.json({
      title: row.title || "",
      questions: JSON.parse(row.questions || "[]"),
      date: row.date || "",
      time: row.time || "",
      email: row.email || ""
    });
  });
});
// -----------------------------
// Email sender
// -----------------------------
function sendInterviewEmail(to, id, title, date, time) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "vanshu2004sabharwal@gmail.com",
      pass: "gbsksbtmkgqaldnq"
    }
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
    `
  };

  transporter.sendMail(mailOptions, (err, info) => {
    if (err) {
      console.error("❌ Error sending email:", err);
    } else {
      console.log("📧 Email sent:", info.response);
    }
  });
}

// -----------------------------
// Start server
// -----------------------------
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});


// CORS policy to allow requests from any origin
const cors = require("cors");
app.use(cors({ origin: "*" }));