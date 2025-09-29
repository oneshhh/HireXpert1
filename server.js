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
  return [String(q)];
}

// The separate sendInterviewEmail function is now removed.

// ---------- NEW GEMINI QUESTION GENERATOR ROUTE (Corrected) ----------
app.post('/api/generate', async (req, res) => {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: 'API key is not configured on the server.' });
    }
    const { jobDescription, numQuestions, difficulty } = req.body;
    if (!jobDescription || !numQuestions || !difficulty) {
        return res.status(400).json({ error: 'jobDescription, numQuestions, and difficulty are required.' });
    }
    // =========== THIS IS THE CORRECTED LINE ===========
    // Using the stable, public model name 'gemini-1.5-flash-latest'
    const API_URL = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-8b-latest:generateContent?key=${GEMINI_API_KEY}`;

    
    const prompt = `Based on the following job description, generate ${numQuestions} technical interview questions at a "${difficulty}" difficulty level. Return ONLY a valid JSON array of strings, with each string being a question. Do not include any other text, formatting, or markdown backticks. \n\nJob Description: ${jobDescription}`;
    try {
        const geminiResponse = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await geminiResponse.json();
        if (!geminiResponse.ok) {
            // Forward the specific error from Google's server
            console.error('Gemini API Error:', data);
            return res.status(geminiResponse.status).json({ error: data.error.message || 'Failed to generate questions.' });
        }
        res.json(data);
    } catch (error) {
        console.error('Server Error calling Gemini:', error);
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
        res.redirect(`/${user.department}_Dashboard.html`);
    } else {
        res.status(401).send("Invalid credentials or department.");
    }
});

// Dashboards
app.get("/HR_Dashboard.html", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "HR_Dashboard.html"));
});

app.get("/PMO_Dashboard.html", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "PMO_Dashboard.html"));
});

app.get("/GTA_Dashboard.html", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "GTA_Dashboard.html"));
});

// ---------- NEW ROUTE FOR CANDIDATE PORTAL SESSIONS ----------
app.get("/api/session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionResult = await pool.query(`SELECT * FROM candidate_sessions WHERE session_id = $1`, [sessionId]);
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ message: "Interview session not found or has expired." });
    }
    const session = sessionResult.rows[0];
    const interviewId = session.interview_id;
    const interviewResult = await pool.query(`SELECT * FROM interviews WHERE id = $1`, [interviewId]);
    if (interviewResult.rows.length === 0) {
      return res.status(404).json({ message: "Interview details could not be found." });
    }
    const interview = interviewResult.rows[0];
    res.json({
      sessionId: session.session_id,
      candidateEmail: session.candidate_email,
      status: session.status,
      interviewId: interview.id,
      title: interview.title,
      questions: interview.questions || [],
      timeLimits: interview.time_limits || [],
      date: interview.date,
      time: interview.time
    });
  } catch (err) {
    console.error("Error fetching session details:", err);
    res.status(500).json({ message: "An internal server error occurred." });
  }
});


// =================================================================
// ===========        THIS IS THE DEFINITIVE FIX         ===========
// =================================================================
app.post("/schedule", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); // Start transaction for safety
    let { title, questions, timeLimits, date, time, emails } = req.body;

    // --- Data Normalization ---
    if (!Array.isArray(questions)) questions = [String(questions || '')];
    if (!Array.isArray(timeLimits)) timeLimits = (String(timeLimits || '').split(',')).map(t => parseInt(t, 10) || 0);
    while (timeLimits.length < questions.length) timeLimits.push(0);

    // --- Create Master Interview Template ---
    const interviewId = uuidv4(); // The correct ID is created here.
    await client.query(
      `INSERT INTO interviews (id, title, questions, time_limits, date, time)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [interviewId, title, questions, timeLimits, date, time]
    );
    console.log("✅ Master interview template saved:", title);

    // --- Create a Unique Session and Send Email for Each Candidate ---
    const candidateEmails = (emails || '').split(',').map(email => email.trim()).filter(email => email);
    const verifiedSenderEmail = process.env.EMAIL_USER || "vanshu2004sabharwal@gmail.com";

    for (const email of candidateEmails) {
      const sessionId = uuidv4();
      await client.query(
        `INSERT INTO candidate_sessions (session_id, interview_id, candidate_email)
         VALUES ($1, $2, $3)`,
        [sessionId, interviewId, email]
      );
      
      // --- Email logic is now directly inside the loop, using the correct interviewId ---
      const link = `https://candidateportal1.onrender.com/setup?id=${interviewId}`;
      const msg = {
        to: email,
        from: verifiedSenderEmail,
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
        console.log(`✅ Email sent successfully to: ${email} via SendGrid`);
      } catch(err) {
        console.error(`❌ CRITICAL: Error sending email to ${email}:`, err);
        if (err.response) { console.error(err.response.body); }
        // We throw an error to make sure the entire transaction is rolled back.
        throw new Error(`Failed to send email to ${email}. Aborting schedule.`);
      }
    }
    
    await client.query('COMMIT'); // Commit all database changes if successful
    res.json({
      success: true,
      message: `Interview scheduled successfully for ${candidateEmails.length} candidate(s).`,
    });
  } catch (err) {
    await client.query('ROLLBACK'); // Roll back database changes on any failure
    console.error("❌ Error in /schedule route:", err.message);
    res.status(500).json({ message: err.message || "Failed to schedule interview." });
  } finally {
    client.release();
  }
});

// ---------- Fetch all interviews ----------
app.get("/api/interviews", async (req, res) => {
  try {
    const { search } = req.query;
    let result;
    if (search) {
      const searchTerm = `%${search}%`;
      result = await pool.query(
        `SELECT * FROM interviews WHERE title ILIKE $1 OR id::text ILIKE $1 ORDER BY date DESC`,
        [searchTerm]
      );
    } else {
      result = await pool.query("SELECT * FROM interviews ORDER BY date DESC");
    }
    res.json(result.rows.map(r => ({
      id: r.id,
      title: r.title,
      questions: r.questions || [],
      date: r.date,
      time: r.time,
      timeLimits: r.time_limits || [],
    })));
  } catch (err) {
    console.error("Error fetching interviews:", err);
    res.status(500).json({ error: "Database error" });
  }
});


// =================================================================
// =========== API ROUTES FOR VIEW/EDIT/DELETE ===========
// =================================================================

// ---------- Fetch single interview TEMPLATE ----------
async function fetchSingleInterview(req, res) {
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
    console.error("DB error fetching single interview:", err);
    res.status(500).json({ message: "DB error" });
  }
}
app.get("/api/interview/:id", fetchSingleInterview);
app.get("/api/interviews/:id", fetchSingleInterview);


// ---------- Update interview TEMPLATE ----------
app.post("/api/interview/:id/update", async (req, res) => {
  try {
    let { title, questions, timeLimits, date, time } = req.body;

    // --- Data Normalization ---
    if (!Array.isArray(questions)) questions = [String(questions || '')];
    if (!Array.isArray(timeLimits)) timeLimits = (String(timeLimits || '').split(',')).map(t => parseInt(t, 10) || 0);
    while (timeLimits.length < questions.length) timeLimits.push(0);

    await pool.query(
      `UPDATE interviews 
       SET title=$1, questions=$2, time_limits=$3, date=$4, time=$5
       WHERE id=$6`,
      [title, questions, timeLimits, date, time, req.params.id]
    );

    res.json({ message: "Interview template updated successfully" });
  } catch (err) {
    console.error("Update failed:", err);
    res.status(500).json({ message: "Update failed" });
  }
});

// ---------- Delete interview TEMPLATE and all associated SESSIONS----------
app.delete("/api/interview/:id/delete", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); // Start a transaction

    const interviewId = req.params.id;

    // 1. Delete all candidate sessions linked to this interview template.
    await client.query(
        "DELETE FROM candidate_sessions WHERE interview_id = $1", 
        [interviewId]
    );
    console.log(`Deleted sessions for interview ID: ${interviewId}`);

    // 2. Delete the master interview template itself.
    await client.query(
        "DELETE FROM interviews WHERE id = $1", 
        [interviewId]
    );
    console.log(`Deleted interview template with ID: ${interviewId}`);

    await client.query('COMMIT'); // Commit the transaction
    res.json({ message: "Interview and all associated sessions deleted successfully" });
  } catch (err)
 {
    await client.query('ROLLBACK'); // Roll back the transaction on error
    console.error("Delete failed:", err);
    res.status(500).json({ message: "Delete failed" });
  } finally {
    client.release(); // Release the client back to the pool
  }
});


// =================================================================
// =========== NEW ROUTE TO FETCH CANDIDATES FOR AN INTERVIEW ===========
// =================================================================
app.get("/api/interview/:id/candidates", async (req, res) => {
  try {
    const { id } = req.params; // This is the master interview_id

    // Query the candidate_sessions table for all sessions linked to this interview_id
    const result = await pool.query(
      `SELECT session_id, candidate_email, status 
       FROM candidate_sessions 
       WHERE interview_id = $1 
       ORDER BY created_at DESC`,
      [id]
    );

    // Return the list of candidates found
    res.json(result.rows);

  } catch (err) {
    console.error(`Error fetching candidates for interview ID ${req.params.id}:`, err);
    res.status(500).json({ message: "Failed to fetch candidate list." });
  }
});


// =================================================================
// =========== ROUTES TO SERVE STATIC HTML PAGES ===========
// =================================================================

app.get("/interview-view.html", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "interview-view.html"));
});

app.get("/interview-edit.html", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "interview-edit.html"));
});


// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

app.get("/candidates.html", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "candidates.html"));
});

// Add this API route to server.js to provide the data for the page
app.get("/api/candidates/all", async (req, res) => {
    try {
        const { search } = req.query;
        let query;
        let queryParams = [];

        // This is the base query that joins the tables to get all necessary info
        let baseQuery = `
            SELECT 
                cs.session_id, 
                cs.candidate_email, 
                cs.status, 
                cs.created_at,
                i.title AS interview_title 
            FROM 
                candidate_sessions cs
            JOIN 
                interviews i ON cs.interview_id = i.id
        `;

        // If a search term is provided, add a WHERE clause to filter the results
        if (search) {
            query = `${baseQuery} WHERE cs.candidate_email ILIKE $1 OR i.title ILIKE $1 ORDER BY cs.created_at DESC`;
            queryParams.push(`%${search}%`); // Add wildcards for partial matching
        } else {
            // If no search term, fetch all candidates
            query = `${baseQuery} ORDER BY cs.created_at DESC`;
        }

        const result = await pool.query(query, queryParams);
        res.json(result.rows);
        
    } catch (err) {
        console.error("Error fetching all candidates:", err);
        res.status(500).json({ error: "Database error" });
    }
});

