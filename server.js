const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session");
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid");
const db = require("./db");

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(
  session({
    secret: "your-secret",
    resave: false,
    saveUninitialized: true,
  })
);

// ✅ Helper to parse Postgres arrays
function parsePgArray(pgArray) {
  if (!pgArray) return [];
  return pgArray
    .replace(/^{|}$/g, "") // remove { }
    .split(",")
    .map((q) => q.replace(/^"|"$/g, "")); // strip quotes
}

// Root
app.get("/", (req, res) => {
  res.send("Server is running!");
});

// 📌 Create interview (HR schedules it)
app.post("/schedule", async (req, res) => {
  const { title, questions, date, time, email } = req.body;

  try {
    const id = uuidv4();
    const pgQuestions = `{${questions.map((q) => `"${q}"`).join(",")}}`;

    await db.query(
      `INSERT INTO interviews (id, title, questions, date, time, email)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, title, pgQuestions, date, time, email]
    );

    // Send email with interview link
    let transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const interviewLink = `https://yourapp.onrender.com/interview/${id}`;
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Your Interview Invitation",
      text: `Please complete your interview at: ${interviewLink}`,
    });

    console.log("✅ Email sent & interview created:", interviewLink);
    res.status(200).json({ success: true, interviewId: id });
  } catch (err) {
    console.error("❌ Error inserting interview:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 📌 Get interview by ID
app.get("/api/interview/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query("SELECT * FROM interviews WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Interview not found" });
    }

    const interview = result.rows[0];
    interview.questions = parsePgArray(interview.questions);

    res.json(interview);
  } catch (err) {
    console.error("❌ Error fetching interview:", err);
    res.status(500).json({ error: err.message });
  }
});

// 📌 Get all interviews
app.get("/api/interviews", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM interviews ORDER BY date DESC");

    const interviews = result.rows.map((row) => ({
      ...row,
      questions: parsePgArray(row.questions),
    }));

    res.json(interviews);
  } catch (err) {
    console.error("❌ Error fetching interviews:", err);
    res.status(500).json({ error: err.message });
  }
});

// 📌 Update interview
app.put("/api/interview/:id/update", async (req, res) => {
  const { id } = req.params;
  const { title, questions, date, time, email } = req.body;

  try {
    const pgQuestions = `{${questions.map((q) => `"${q}"`).join(",")}}`;

    await db.query(
      `UPDATE interviews
       SET title=$1, questions=$2, date=$3, time=$4, email=$5
       WHERE id=$6`,
      [title, pgQuestions, date, time, email, id]
    );

    res.status(200).json({ success: true, message: "Interview updated" });
  } catch (err) {
    console.error("❌ Error updating interview:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 📌 Delete interview
app.delete("/api/interviews/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM interviews WHERE id=$1", [id]);
    res.json({ success: true, message: "Interview deleted" });
  } catch (err) {
    console.error("❌ Error deleting interview:", err);
    res.status(500).json({ error: err.message });
  }
});

// 📌 Candidate interview page
app.get("/interview/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query("SELECT * FROM interviews WHERE id=$1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).send("Interview not found");
    }

    const interview = result.rows[0];
    interview.questions = parsePgArray(interview.questions);

    res.send(`
      <html>
        <body>
          <h1>${interview.title}</h1>
          <p>Date: ${interview.date}</p>
          <p>Time: ${interview.time}</p>
          <h3>Questions:</h3>
          <ul>
            ${interview.questions.map((q) => `<li>${q}</li>`).join("")}
          </ul>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("❌ Error fetching interview:", err);
    res.status(500).send("Server error");
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
