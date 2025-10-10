const express = require("express");
const session = require("express-session");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
require('dotenv').config();
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const cors = require("cors");
const pool = require("./db");
const fetch = require('node-fetch');

const PORT = process.env.PORT || 3000;
const app = express();

// ---------- Middleware ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(cors({ origin: "*" })); // Consider restricting this to your frontend URL in production
app.use(
  session({
    secret: process.env.SESSION_SECRET || "a-default-secret-for-development", // It's better to use an environment variable
    resave: false,
    saveUninitialized: true,
  })
);

// ---------- Fake user database (with Admin user) ----------
const users = [
  { email: "admin@company.com", password: "admin123", department: "Admin" },
  { email: "hr@company.com", password: "hr123", department: "HR" },
  { email: "pmo@company.com", password: "pmo123", department: "PMO" },
  { email: "gta@company.com", password: "gta123", department: "GTA" },
];

// ---------- Helper: robust questions parser ----------
function parseQuestionsField(q) {
  if (!q) return [];
  if (Array.isArray(q)) return q;
  return [String(q)];
}

// =================================================================
// =========== EMAIL SENDER USING SEND GRID===========
// =================================================================
async function sendInterviewEmail(to, interviewId, title, date, time) { 
  const verifiedSenderEmail = process.env.EMAIL_USER || "vanshu2004sabharwal@gmail.com";
  const link = `https://candidateportal1.onrender.com/setup?id=${interviewId}`;
  const msg = {
    to: to, // Recipient
    from: verifiedSenderEmail, // Verified Sender
    subject: `Interview Scheduled: ${title}`,
    html: `
      <p>Dear Candidate,</p>
      <p>You have an interview scheduled for <b>${title}</b>.</p>
      <p><b>Date:</b> ${date}<br><b>Time:</b> ${time}</p>
      <p>Click <a href="${link}">here</a> to join your interview.</p>
      <p>Regards,<br>HireXpert Team</p>
    `,
  };
  try {
    await sgMail.send(msg);
    console.log(`✅ Email sent successfully to: ${to} via SendGrid`);
    return { success: true };
  } catch (err) {
    console.error(`❌ CRITICAL: Error sending email via SendGrid:`, err);
    if (err.response) {
      console.error(err.response.body)
    }
    return { success: false, error: err };
  }
}


// ---------- NEW GEMINI QUESTION GENERATOR ROUTE ----------
app.post('/api/generate', async (req, res) => {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: 'API key is not configured on the server.' });
    }
    const { jobDescription, numQuestions, difficulty } = req.body;
    if (!jobDescription || !numQuestions || !difficulty) {
        return res.status(400).json({ error: 'jobDescription, numQuestions, and difficulty are required.' });
    }
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    const prompt = `Based on the following job description, generate ${numQuestions} technical interview questions at a "${difficulty}" difficulty level. Return ONLY a valid JSON array of strings, with each string being a question. Do not include any other text, formatting, or markdown backticks. \n\nJob Description: ${jobDescription}`;
    try {
        const geminiResponse = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await geminiResponse.json();
        if (!geminiResponse.ok) {
            return res.status(geminiResponse.status).json({ error: data.error.message || 'Failed to generate questions.' });
        }
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
});

// ---------- Routes ----------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", (req, res) => {
    const { email, password, department } = req.body;
    const user = users.find(u => u.email === email && u.password === password && u.department === department);
    if (user) {
        req.session.user = user;
        if (user.department === 'Admin') {
            return res.redirect('/admin_Dashboard.html');
        }
        res.redirect(`/${user.department}_Dashboard.html`);
    } else {
        res.status(401).send("Invalid credentials or department.");
    }
});

// Dashboards
app.get("/HR_Dashboard.html", (req, res) => { res.sendFile(path.join(__dirname, "views", "HR_Dashboard.html")); });
app.get("/PMO_Dashboard.html", (req, res) => { res.sendFile(path.join(__dirname, "views", "PMO_Dashboard.html")); });
app.get("/GTA_Dashboard.html", (req, res) => { res.sendFile(path.join(__dirname, "views", "GTA_Dashboard.html")); });

// =================================================================
// ===========        ROUTES FOR ADMIN DASHBOARD       ===========
// =================================================================
app.get("/admin_Dashboard.html", (req, res) => {
    if (req.session.user?.department === 'Admin') {
        return res.sendFile(path.join(__dirname, "views", "admin_Dashboard.html"));
    }
    res.status(401).send("<h1>Unauthorized</h1><p>You must be an admin to view this page.</p><a href='/'>Login Again</a>");
});

app.get("/api/users", (req, res) => {
    res.json(users);
});

app.get("/api/analytics/status-counts", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT status, COUNT(*) AS count FROM candidate_sessions GROUP BY status`
        );
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching status counts:", err);
        res.status(500).json({ error: "Database error" });
    }
});

app.get("/api/analytics/interviews-over-time", async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 7;
        const result = await pool.query(
            `SELECT DATE(created_at) AS date, COUNT(*) AS count
             FROM interviews
             WHERE created_at >= NOW() - INTERVAL '${days} days'
             GROUP BY DATE(created_at)
             ORDER BY date ASC`
        );
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching interviews over time data:", err);
        res.status(500).json({ error: "Database error" });
    }
});
// =================================================================


// ---------- Core API Routes ----------
app.get("/api/session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionResult = await pool.query(`SELECT * FROM candidate_sessions WHERE session_id = $1`, [sessionId]);
    if (sessionResult.rows.length === 0) return res.status(404).json({ message: "Interview session not found." });
    const session = sessionResult.rows[0];
    const interviewResult = await pool.query(`SELECT * FROM interviews WHERE id = $1`, [session.interview_id]);
    if (interviewResult.rows.length === 0) return res.status(404).json({ message: "Interview details not found." });
    const interview = interviewResult.rows[0];
    res.json({
      sessionId: session.session_id, candidateEmail: session.candidate_email, status: session.status,
      interviewId: interview.id, title: interview.title, questions: interview.questions || [],
      timeLimits: interview.time_limits || [], date: interview.date, time: interview.time
    });
  } catch (err) {
    console.error("Error fetching session details:", err);
    res.status(500).json({ message: "An internal server error occurred." });
  }
});

// ========== CORRECTED /schedule ROUTE ==========
app.post("/schedule", async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.session.user || !req.session.user.department) return res.status(401).json({ message: "Unauthorized." });
    const { department } = req.session.user;
    await client.query('BEGIN');
    
    let { title, questions, timeLimits, date, time, emails, schedulerEmail } = req.body;

    if (!schedulerEmail) {
        throw new Error("Scheduler email is required.");
    }
    
    if (!Array.isArray(questions)) questions = [String(questions || '')];
    if (!Array.isArray(timeLimits)) timeLimits = (String(timeLimits || '').split(',')).map(t => parseInt(t, 10) || 0);
    while (timeLimits.length < questions.length) timeLimits.push(0);

    const interviewId = uuidv4();
    await client.query(
      `INSERT INTO interviews (id, title, questions, time_limits, date, time, department, created_at, position_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 'open')`,
      [interviewId, title, questions, timeLimits, date, time, department]
    );

    const candidateEmails = (emails || '').split(',').map(email => email.trim()).filter(email => email);

    // Email candidates
    for (const email of candidateEmails) {
      const sessionId = uuidv4();
      await client.query(
        `INSERT INTO candidate_sessions (session_id, interview_id, candidate_email, department)
         VALUES ($1, $2, $3, $4)`,
        [sessionId, interviewId, email, department]
      );
      const emailResult = await sendInterviewEmail(email, interviewId, title, date, time);
      if (!emailResult.success) throw new Error(`Failed to send email to candidate ${email}.`);
    }

    // Email the scheduler with the calendar invite AND CHECK FOR SUCCESS
    const schedulerEmailResult = await sendSchedulerConfirmationEmail(schedulerEmail, title, date, time, candidateEmails);
    if (!schedulerEmailResult.success) {
        throw new Error("Failed to send confirmation email to scheduler.");
    }
    
    await client.query('COMMIT');
    res.json({ success: true, message: `Interview scheduled for ${candidateEmails.length} candidate(s).` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("❌ Error in /schedule route:", err.message);
    res.status(500).json({ message: err.message || "Failed to schedule interview." });
  } finally {
    client.release();
  }
});

// =================================================================
// ===========        ROUTES FOR HR DASHBOARD FEATURES (RESTORED)       ===========
// =================================================================
app.get("/api/interviews/counts", async (req, res) => {
    try {
        const { department } = req.query;
        if (!department) return res.status(400).json({ error: "Department is required." });
        const result = await pool.query(
            `SELECT position_status, COUNT(*) AS count 
             FROM interviews 
             WHERE department = $1
             GROUP BY position_status`,
            [department]
        );
        const counts = { open: 0, closed: 0 };
        result.rows.forEach(row => {
            if (row.position_status === 'open') counts.open = parseInt(row.count, 10);
            if (row.position_status === 'closed') counts.closed = parseInt(row.count, 10);
        });
        res.json(counts);
    } catch (err) {
        res.status(500).json({ error: "Database error" });
    }
});

app.post("/api/interviews/bulk-update-status", async (req, res) => {
    try {
        const { interviewIds, status } = req.body;
        if (!interviewIds || !Array.isArray(interviewIds) || !status) {
            return res.status(400).json({ error: "interviewIds and status are required." });
        }
        await pool.query(
            `UPDATE interviews SET position_status = $1 WHERE id = ANY($2::uuid[])`,
            [status, interviewIds]
        );
        res.json({ success: true, message: `${interviewIds.length} interviews updated.` });
    } catch (err) {
        res.status(500).json({ error: "Failed to update interviews." });
    }
});

app.post("/api/interviews/bulk-delete", async (req, res) => {
    const { interviewIds } = req.body;
    if (!interviewIds || !Array.isArray(interviewIds) || interviewIds.length === 0) {
        return res.status(400).json({ error: "interviewIds array is required." });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("DELETE FROM candidate_sessions WHERE interview_id = ANY($1::uuid[])", [interviewIds]);
        await client.query("DELETE FROM interviews WHERE id = ANY($1::uuid[])", [interviewIds]);
        await client.query('COMMIT');
        res.json({ success: true, message: `${interviewIds.length} interviews deleted.` });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: "Failed to delete interviews." });
    } finally {
        client.release();
    }
});
// =================================================================


// --- UPDATED /api/interviews to handle position_status filter ---
app.get("/api/interviews", async (req, res) => {
  try {
    const { search, department, position_status } = req.query; 
    
    let queryParams = [];
    let whereClauses = [];
    let baseQuery = "SELECT * FROM interviews";

    if (department) {
        queryParams.push(department);
        whereClauses.push(`department = $${queryParams.length}`);
    }
    if (position_status) {
        queryParams.push(position_status);
        whereClauses.push(`position_status = $${queryParams.length}`);
    }
    if (search) {
        queryParams.push(`%${search}%`);
        whereClauses.push(`(title ILIKE $${queryParams.length})`);
    }

    if (whereClauses.length > 0) {
        baseQuery += " WHERE " + whereClauses.join(" AND ");
    }
    baseQuery += " ORDER BY created_at DESC";

    const result = await pool.query(baseQuery, queryParams);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching interviews:", err);
    res.status(500).json({ error: "Database error" });
  }
});


// --- ALL OTHER API ROUTES ---
app.get("/api/candidates/all", async (req, res) => {
    try {
        const { search, department } = req.query;
        let queryParams = [];
        let whereClauses = [];
        let baseQuery = `
            SELECT cs.session_id, cs.candidate_email, cs.status, cs.created_at, i.title AS interview_title, cs.department, cs.review_url 
            FROM candidate_sessions cs JOIN interviews i ON cs.interview_id = i.id
        `;
        if (department) { queryParams.push(department); whereClauses.push(`cs.department = $${queryParams.length}`); }
        if (search) { queryParams.push(`%${search}%`); whereClauses.push(`(cs.candidate_email ILIKE $${queryParams.length} OR i.title ILIKE $${queryParams.length})`); }
        if (whereClauses.length > 0) baseQuery += " WHERE " + whereClauses.join(" AND ");
        baseQuery += " ORDER BY cs.created_at DESC";
        const result = await pool.query(baseQuery, queryParams);
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching all candidates:", err);
        res.status(500).json({ error: "Database error" });
    }
});

app.get("/api/interview/:id", async (req, res) => {
    const result = await pool.query("SELECT * FROM interviews WHERE id = $1", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ message: "Interview not found" });
    res.json(result.rows[0]);
});

app.post("/api/interview/:id/update", async (req, res) => {
  try {
    let { title, questions, timeLimits, date, time } = req.body;
    if (!Array.isArray(questions)) questions = [String(questions || '')];
    if (!Array.isArray(timeLimits)) timeLimits = (String(timeLimits || '').split(',')).map(t => parseInt(t, 10) || 0);
    while (timeLimits.length < questions.length) timeLimits.push(0);
    await pool.query(
      `UPDATE interviews SET title=$1, questions=$2, time_limits=$3, date=$4, time=$5 WHERE id=$6`,
      [title, questions, timeLimits, date, time, req.params.id]
    );
    res.json({ message: "Interview template updated successfully" });
  } catch (err) {
    console.error("Update failed:", err);
    res.status(500).json({ message: "Update failed" });
  }
});

app.delete("/api/interview/:id/delete", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const interviewId = req.params.id;
    await client.query("DELETE FROM candidate_sessions WHERE interview_id = $1", [interviewId]);
    await client.query("DELETE FROM interviews WHERE id = $1", [interviewId]);
    await client.query('COMMIT');
    res.json({ message: "Interview and all associated sessions deleted successfully" });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Delete failed:", err);
    res.status(500).json({ message: "Delete failed" });
  } finally {
    client.release();
  }
});

app.get("/api/interview/:id/candidates", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT session_id, candidate_email, status FROM candidate_sessions WHERE interview_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(`Error fetching candidates for interview ID ${req.params.id}:`, err);
    res.status(500).json({ message: "Failed to fetch candidate list." });
  }
});

// --- Static Page Routes ---
app.get("/interview-view.html", (req, res) => res.sendFile(path.join(__dirname, "views", "interview-view.html")));
app.get("/interview-edit.html", (req, res) => res.sendFile(path.join(__dirname, "views", "interview-edit.html")));
app.get("/candidates.html", (req, res) => res.sendFile(path.join(__dirname, "views", "candidates.html")));

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

