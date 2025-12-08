const express = require("express");
const cookieSession = require('cookie-session');
const path = require("path");
const { v4: uuidv4 } = require("uuid");
require('dotenv').config();
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const cors = require("cors");
const pool = require('./db');
const fetch = (...args) =>import('node-fetch').then(({ default: fetch }) => fetch(...args));
const bcrypt = require('bcrypt');
const fs = require('fs');
const reviewRoutes = require('./review.routes.js');
const PORT = process.env.PORT || 3000;
const app = express();
const { supabase_second_db_service } = require('./supabaseClient');
const crypto = require("crypto");
const { Parser } = require('json2csv');
const ExcelJS = require("exceljs");
// Middleware
app.use(express.json());
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
const allowedOrigins = [
  "https://hirexpert-1ecv.onrender.com",       // admin dashboard   vansh
  "https://candidateportal1.onrender.com",     // external application   abhishek 
];

// 3. Token-Based Interview Setup Route
app.get(
  "/api/setup",
  cors({
    origin: "https://candidateportal1.onrender.com"
  }),
  async (req, res) => {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: "MISSING_TOKEN" });
    }

    try {
      const result = await pool.query(
        "SELECT * FROM interview_access_tokens WHERE token=$1",
        [token]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ error: "INVALID_TOKEN" });
      }

      const row = result.rows[0];

      // 🔒 Check expiration
      if (new Date() > row.expires_at) {
        return res.status(401).json({ error: "TOKEN_EXPIRED" });
      }

      // 🔒 Check if token already used
      if (row.used) {
        return res.status(401).json({ error: "TOKEN_USED" });
      }

      // ✅ Valid and unused token — allow setup page to load
      return res.json({
        success: true,
        interviewId: row.interview_id,
        candidateEmail: row.candidate_email
      });

    } catch (err) {
      console.error("Token validation error:", err);
      return res.status(500).json({ error: "SERVER_ERROR" });
    }
  }
);

app.post("/api/consume-token", async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ error: "MISSING_TOKEN" });
    }

    try {
        const result = await pool.query(
            "SELECT * FROM interview_access_tokens WHERE token=$1",
            [token]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: "INVALID_TOKEN" });
        }

        const row = result.rows[0];

        if (row.used) {
            return res.status(400).json({ error: "TOKEN_USED" });
        }

        await pool.query(
            "UPDATE interview_access_tokens SET used = TRUE, used_at = NOW() WHERE token=$1",
            [token]
        );

        return res.json({ success: true });

    } catch (err) {
        console.error("Token consume error:", err);
        res.status(500).json({ error: "SERVER_ERROR" });
    }
});
app.get(
  "/api/external/interviews/:id",
  cors({
    origin: "https://candidateportal1.onrender.com"
  }),
  requireApiKey,
  async (req, res) => {
    try {
      const interviewId = req.params.id;

      const result = await pool.query(`
        SELECT 
          id,
          custom_interview_id,
          title,
          questions,
          time_limits,
          date,
          time,
          department,
          position_status,
          job_description,
          created_by_user_id,
          scheduler_ids,
          created_at,
          visitor_reviewer_ids
        FROM interviews
        WHERE id = $1
      `, [interviewId]);

      res.json(result.rows);

    } catch (err) {
      console.error("External API Error:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

app.use(cors({
  origin: function (origin, callback) {
    // allow server-to-server requests (no origin)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));
app.use(cookieSession({
  name: 'session',
  keys: ['secret1', 'secret2'],
  sameSite: 'lax',     // ✅ allows same-site requests
  secure: process.env.NODE_ENV === 'production',  // ✅ safe for both local + live
  maxAge: 24 * 60 * 60 * 1000                    // 1 day
}));

// --- External API Key Middleware ---
function requireApiKey(req, res, next) {
  const sentKey = req.headers["x-api-key"];
  if (!sentKey || sentKey !== process.env.HX_API_KEY) {
    return res.status(403).json({ error: "Forbidden: Invalid API Key" });
  }
  next();
}

// --- PUBLIC EXTERNAL INTERVIEW API (API-KEY PROTECTED) ---
app.get(
  "/api/external/interviews",
  cors({
    origin: "https://candidateportal1.onrender.com", // allow your external portal
  }),
  requireApiKey,
  async (req, res) => {
    try {
      const interviewId = req.query.id;

      let query = `
        SELECT 
          id,
          custom_interview_id,
          title,
          questions,
          time_limits,
          date,
          time,
          department,
          position_status,
          job_description,
          created_by_user_id,
          scheduler_ids,
          created_at,
          visitor_reviewer_ids
        FROM interviews
      `;
      
      const values = [];

      if (interviewId) {
        query += " WHERE id = $1";
        values.push(interviewId);
      }

      query += " ORDER BY created_at DESC";

      const result = await pool.query(query, values);
      res.json(result.rows);

    } catch (err) {
      console.error("External API Error:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

app.use('/api', reviewRoutes); // Mount all routes from review.routes.js

async function generateCandidateCode(client, email, interviewId) {
    // 1. Extract initials from email OR name (email since name isn't stored)
    const localPart = email.split('@')[0];
    const parts = localPart.split(/[._-]/);
    let initials = parts.map(p => p[0]?.toUpperCase()).join('');
    if (!initials) initials = localPart.substring(0, 2).toUpperCase();

    // 2. Get Month/Year
    const now = new Date();
    const month = now.toLocaleString('en-US', { month: 'short' }).toUpperCase(); // JAN, FEB...
    const year = now.getFullYear();

    // 3. Get incremental number
    const countResult = await client.query(
        `SELECT COUNT(*)::int FROM candidate_sessions WHERE interview_id = $1`,
        [interviewId]
    );

    const number = (countResult.rows[0].count + 1).toString().padStart(4, '0');

    // 4. Build final candidate_code
    return `${month}/${year}/${number}/${initials}`;
}



// --- Viewer Initialization Route ---
// This sets up a session for viewers using a token from the invite link
app.get("/api/viewer/init", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ message: "Missing viewer token" });
    }

    // ✅ Example: pull viewer info from DB (adjust table/field names)
    const { rows } = await pool.query(
      "SELECT id, email, name, interview_id FROM viewers WHERE token = $1",
      [token]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: "Invalid or expired token" });
    }

    // ✅ Store minimal viewer info in session
    req.session.viewer = {
      id: rows[0].id,
      email: rows[0].email,
      name: rows[0].name,
      interview_id: rows[0].interview_id
    };

    console.log("Viewer session created:", req.session.viewer);

    res.json({ success: true, message: "Viewer session initialized" });
  } catch (err) {
    console.error("Error initializing viewer session:", err);
    res.status(500).json({ message: "Server error initializing viewer" });
  }
});


// Helper functions
function parseQuestionsField(q) {
    if (!q) return [];
    if (Array.isArray(q)) return q;
    return [String(q)];
}

async function sendInterviewEmail(to, interviewId, title, date, time) {

    console.log("📨 sendInterviewEmail CALLED for:", to);
    console.log("🆔 interviewId:", interviewId);

    const verifiedSenderEmail = process.env.EMAIL_USER;

    try {
        console.log("🔐 Generating token...");
        const token = crypto.randomBytes(32).toString("hex");

        console.log("📅 Setting expiry...");
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        console.log("📝 Inserting token into DB...");
        await pool.query(
            `INSERT INTO interview_access_tokens 
             (token, interview_id, candidate_email, expires_at)
             VALUES ($1, $2, $3, $4)`,
            [token, interviewId, to, expiresAt]
        );

        console.log("✅ Token inserted:", token);

        const link = `https://candidateportal1.onrender.com/setup?token=${token}`;
        console.log("🔗 Link generated:", link);

        const msg = {
            to: to,
            from: verifiedSenderEmail,
            subject: `Interview Scheduled: ${title}`,
            html: `
                <p>Dear Candidate,</p>
                <p>Your interview for <b>${title}</b> has been scheduled.</p>
                <p><b>Date:</b> ${date}<br><b>Time:</b> ${time}</p>
                <p><a href="${link}">Click here to begin your interview</a></p>
                <p>This link will expire in 24 hours for security reasons.</p>
                <p>Regards,<br>HireXpert Team</p>
            `,
        };

        console.log("📧 Sending email...");
        await sgMail.send(msg);

        console.log("✉️ Email sent successfully to:", to);
        return { success: true };

    } catch (err) {
        console.error("❌ ERROR in sendInterviewEmail:", err);
        if (err.response) console.log("📩 SendGrid Error:", err.response.body);
        return { success: false };
    }
}


async function sendSchedulerConfirmationEmail(to, title, date, time, candidates) {
    const verifiedSenderEmail = process.env.EMAIL_USER || "vanshu2004sabharwal@gmail.com";
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const event = {
        title: `Interview: ${title}`,
        description: `Interview scheduled with the following candidates: ${candidates.join(', ')}`,
        start: [year, month, day, hour, minute],
        duration: { hours: 1 },
        status: 'CONFIRMED',
        organizer: { name: 'HireXpert', email: verifiedSenderEmail },
        attendees: [{ name: 'Scheduler', email: to, rsvp: true, partstat: 'NEEDS-ACTION', role: 'REQ-PARTICIPANT' }]
    };
    const msg = {
        to: to,
        from: verifiedSenderEmail,
        subject: `CONFIRMATION: Interview Scheduled for ${title}`,
        html: `<p>This is a confirmation that you have successfully scheduled the interview: <b>${title}</b>.</p><p><b>Date:</b> ${date}<br><b>Time:</b> ${time}</p><p><b>Candidates Invited:</b> ${candidates.join(', ')}</p>`,
    };
    try {
        await sgMail.send(msg);
        console.log(`✅ Scheduler confirmation sent successfully to: ${to}`);
        return { success: true };
    } catch (err) {
        console.error(`❌ CRITICAL: Error sending scheduler confirmation:`, err);
        if (err.response) console.error(err.response.body);
        return { success: false, error: err };
    }
}

// AI Question Generator Route
app.post('/api/generate', async (req, res) => {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) { return res.status(500).json({ error: 'API key is not configured on the server.' }); }
    const { jobDescription, numQuestions, difficulty } = req.body;
    if (!jobDescription || !numQuestions || !difficulty) { return res.status(400).json({ error: 'jobDescription, numQuestions, and difficulty are required.' }); }
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    const prompt = `Based on the following job description, generate ${numQuestions} technical interview questions at a "${difficulty}" difficulty level. Return ONLY a valid JSON array of strings, with each string being a question. Do not include any other text, formatting, or markdown backticks. \n\nJob Description: ${jobDescription}`;
    try {
        const geminiResponse = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
        const data = await geminiResponse.json();
        if (!geminiResponse.ok) { return res.status(geminiResponse.status).json({ error: data.error.message || 'Failed to generate questions.' }); }
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
});

// Auth and Page Routes
app.get("/", (req, res) => { res.sendFile(path.join(__dirname, "public", "login.html")); });

// ========== CORRECTED: /login route to handle multiple departments properly ==========
app.post("/login", async (req, res) => {
    const { email, password, department } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        const user = result.rows[0];

        if (user) {
            if (!user.is_active) {
                return res.status(403).send("Your account has been disabled. Please contact an administrator.");
            }
            const hasDepartmentAccess = user.department.includes(department);
            if (!hasDepartmentAccess) {
                 return res.status(401).send("User does not have access to the selected department.");
            }

            const isMatch = await bcrypt.compare(password, user.password_hash);
            if (isMatch) {
                req.session.user = {
                    id: user.id,
                    email: user.email,
                    departments: user.department,
                    activeDepartment: department
                };
                console.log('Session user set:', req.session.user); // Logging

                // cookie-session automatically saves on response, so just redirect
                if (department === 'Admin') {
                    return res.redirect('/admin_Dashboard.html');
                }
                return res.redirect(`/${department}_Dashboard.html`);

            } else { // Added 'else' for clarity if password doesn't match
                 res.status(401).send("Invalid credentials.");
            }
        } else { // Added 'else' for clarity if user not found
             res.status(401).send("Invalid credentials.");
        }
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).send("An internal server error occurred.");
    }
});

// API endpoint to get current user info and login, logout functions
app.get("/api/me", (req, res) => {
  // If internal user is logged in, return the usual minimal user info
  if (req.session && req.session.user) {
    return res.json({
      type: 'user',
      id: req.session.user.id,
      email: req.session.user.email,
      activeDepartment: req.session.user.activeDepartment,
      first_name: req.session.user.first_name || null,
      last_name: req.session.user.last_name || null
    });
  }

  // If an external viewer is logged in, return a limited viewer profile
  if (req.session && req.session.viewer) {
    const v = req.session.viewer;
    // Return only non-sensitive fields so client can distinguish viewer vs user
    return res.json({
      type: 'viewer',
      viewer: {
        id: v.id,
        email: v.email,
        name: v.name || null
      }
    });
  }

  // No session at all
  return res.status(401).json({ message: "Not authenticated" });
});


app.get("/logout", (req, res) => {
    // For cookie-session, clear the session by setting it to null
    try {
        req.session = null;
    } catch (err) {
        console.error("Error clearing session on logout:", err);
    }
    // Clear the cookie name you set in cookieSession (name: 'session')
    res.clearCookie('session');
    // Redirect to the login page
    res.redirect('/');
    window.location.href = "/";

});

app.get("/HR_Dashboard.html", (req, res) => { res.sendFile(path.join(__dirname, "views", "HR_Dashboard.html")); });
app.get("/PMO_Dashboard.html", (req, res) => { res.sendFile(path.join(__dirname, "views", "PMO_Dashboard.html")); });
app.get("/GTA_Dashboard.html", (req, res) => { res.sendFile(path.join(__dirname, "views", "GTA_Dashboard.html")); });
app.get("/admin_Dashboard.html", (req, res) => {
    if (req.session.user?.activeDepartment === 'Admin') {
        return res.sendFile(path.join(__dirname, "views", "admin_Dashboard.html"));
    }
    res.status(401).send("<h1>Unauthorized</h1><p>You must be an admin to view this page.</p><a href='/'>Login Again</a>");
});

// User Management API Routes
app.get("/api/users", async (req, res) => {
    try {
        // ADDED: is_active field to the SELECT statement
        const result = await pool.query("SELECT id, first_name, last_name, email, department, created_at, is_active FROM users ORDER BY created_at DESC");
        res.json(result.rows);
    } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ message: "Failed to fetch users." });
    }
});

// ========== CORRECTED: /api/users-by-dept to correctly filter users ==========
app.get("/api/users-by-dept", async (req, res) => {
    if (!req.session.user || !req.session.user.activeDepartment) {
        return res.status(401).json({ message: "Unauthorized." });
    }
    const { activeDepartment } = req.session.user;

    try {
        // Find users who have access to the current department OR are Admins
        const result = await pool.query(
            "SELECT id, first_name, last_name, email FROM users WHERE department @> ARRAY[$1::TEXT] OR department @> ARRAY['Admin'::TEXT] ORDER BY first_name, last_name", 
            [activeDepartment]
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Error fetching users by department:", error);
        res.status(500).json({ message: "Failed to fetch users." });
    }
});

app.post("/api/add-user", async (req, res) => {
    if (req.session.user?.activeDepartment !== 'Admin') {
        return res.status(403).json({ message: "Forbidden: Only admins can add users." });
    }

    let { firstName, lastName, email, departments, password } = req.body;
    
    if (typeof departments === 'string') {
        departments = [departments];
    }
    
    if (!firstName || !lastName || !email || !Array.isArray(departments) || departments.length === 0 || !password) {
        return res.status(400).json({ message: "All fields, including at least one department, are required." });
    }

    try {
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // CORRECTED: Added the 'is_active' column and set it to true for new users.
        const newUserResult = await pool.query(
            `INSERT INTO users (first_name, last_name, email, password_hash, department, is_active)
             VALUES ($1, $2, $3, $4, $5, true)
             RETURNING id, email, department`,
            [firstName, lastName, email, passwordHash, departments]
        );
        
        res.status(201).json({ success: true, message: "User created successfully.", user: newUserResult.rows[0] });
    } catch (error) {
        console.error("Error creating user:", error);
        if (error.code === '23505') {
            return res.status(409).json({ message: "A user with this email already exists." });
        }
        res.status(500).json({ message: "An internal server error occurred." });
    }
});

app.post("/api/user/:id/update", async (req, res) => {
    if (req.session.user?.activeDepartment !== 'Admin') {
        return res.status(403).json({ message: "Forbidden: Only admins can edit users." });
    }
    const { id } = req.params;
    // CORRECTED: Changed variable from 'isDisabled' to 'isActive'
    let { firstName, lastName, email, departments, password, isActive } = req.body;

    if (typeof departments === 'string') {
        departments = [departments];
    }

    if (!firstName || !lastName || !email || !Array.isArray(departments) || departments.length === 0) {
        return res.status(400).json({ message: "Name, email, and department are required." });
    }

    try {
        if (password) {
            const saltRounds = 10;
            const passwordHash = await bcrypt.hash(password, saltRounds);
            // CORRECTED: Changed SQL column from 'is_disabled' to 'is_active'
            await pool.query(
                `UPDATE users SET first_name = $1, last_name = $2, email = $3, department = $4, is_active = $5, password_hash = $6 WHERE id = $7`,
                [firstName, lastName, email, departments, isActive, passwordHash, id]
            );
        } else {
            // CORRECTED: Changed SQL column from 'is_disabled' to 'is_active'
            await pool.query(
                `UPDATE users SET first_name = $1, last_name = $2, email = $3, department = $4, is_active = $5 WHERE id = $6`,
                [firstName, lastName, email, departments, isActive, id]
            );
        }
        res.json({ success: true, message: "User updated successfully." });
    } catch (error) {
        console.error("Error updating user:", error);
        if (error.code === '23505') {
            return res.status(409).json({ message: "A user with this email already exists." });
        }
        res.status(500).json({ message: "An internal server error occurred." });
    }
});

// Add this new route to your server.js, for example, after the update route
app.delete("/api/user/:id", async (req, res) => {
    if (req.session.user?.activeDepartment !== 'Admin') {
        return res.status(403).json({ message: "Forbidden: Only admins can delete users." });
    }
    const { id } = req.params;
    if (id === req.session.user.id) {
        return res.status(400).json({ message: "Admin cannot delete their own account." });
    }

    try {
        await pool.query("DELETE FROM users WHERE id = $1", [id]);
        res.json({ success: true, message: `User deleted successfully.` });
    } catch (err) {
        console.error("Failed to delete user:", err);
        res.status(500).json({ message: "Failed to delete user." });
    }
});

app.post("/api/users/bulk-delete", async (req, res) => {
    if (req.session.user?.activeDepartment !== 'Admin') {
        return res.status(403).json({ message: "Forbidden: Only admins can delete users." });
    }
    const { userIds } = req.body;
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: "An array of userIds is required." });
    }

    const filteredUserIds = userIds.filter(id => id !== req.session.user.id);
    if (filteredUserIds.length !== userIds.length) {
        console.warn(`Admin user ${req.session.user.email} attempted to self-delete.`);
    }

    if (filteredUserIds.length === 0) {
        return res.json({ success: true, message: "No users were deleted. Admin cannot delete their own account." });
    }

    try {
        await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [filteredUserIds]);
        res.json({ success: true, message: `${filteredUserIds.length} user(s) deleted.` });
    } catch (err) {
        console.error("Failed to delete users:", err);
        res.status(500).json({ error: "Failed to delete users." });
    }
});

// Analytics API Routes
app.get("/api/analytics/status-counts", async (req, res) => {
    try {
        const result = await pool.query(`SELECT status, COUNT(*) AS count FROM candidate_sessions GROUP BY status`);
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching status counts:", err);
        res.status(500).json({ error: "Database error" });
    }
});

app.get("/api/analytics/interviews-over-time", async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 7;
        const result = await pool.query(`SELECT DATE(created_at) AS date, COUNT(*) AS count FROM interviews WHERE created_at >= NOW() - INTERVAL '${days} days' GROUP BY DATE(created_at) ORDER BY date ASC`);
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching interviews over time data:", err);
        res.status(500).json({ error: "Database error" });
    }
});

// Core Interview/Candidate API Routes
app.get("/api/session/:sessionId", async (req, res) => {
    try {
        const { sessionId } = req.params;
        const sessionResult = await pool.query(`SELECT * FROM candidate_sessions WHERE session_id = $1`, [sessionId]);
        if (sessionResult.rows.length === 0) return res.status(404).json({ message: "Interview session not found." });
        const session = sessionResult.rows[0];
        const interviewResult = await pool.query(`SELECT * FROM interviews WHERE id = $1`, [session.interview_id]);
        if (interviewResult.rows.length === 0) return res.status(404).json({ message: "Interview details not found." });
        const interview = interviewResult.rows[0];
        res.json({ sessionId: session.session_id, candidateEmail: session.candidate_email, status: session.status, interviewId: interview.id, title: interview.title, questions: interview.questions || [], timeLimits: interview.time_limits || [], date: interview.date, time: interview.time });
    } catch (err) {
        console.error("Error fetching session details:", err);
        res.status(500).json({ message: "An internal server error occurred." });
    }
});

app.post("/schedule", async (req, res) => {
    console.log("📥 /schedule HIT");
    const client = await pool.connect();

    let createdInterviewId = null;
    let createdCandidateRecords = [];

    try {
        if (!req.session.user || !req.session.user.activeDepartment || !req.session.user.id) {
            return res.status(401).json({ message: "Unauthorized." });
        }

        const department = req.session.user.activeDepartment;
        const createdByUserId = req.session.user.id;
        
        await client.query('BEGIN');

    let { title, questions, timeLimits, date, time, candidates, customIdText, jobDescription, schedulerIds } = req.body;

    if (!customIdText) throw new Error("The custom Interview ID text is required.");
    if (!schedulerIds || schedulerIds.length === 0) throw new Error("At least one reviewer must be assigned.");


        const now = new Date();
        const year = now.getFullYear().toString().slice(-2);
        const monthName = now.toLocaleString('en-US', { month: 'short' });

        const serialResult = await client.query(
            `SELECT COUNT(*) FROM interviews 
             WHERE EXTRACT(YEAR FROM created_at) = $1 
             AND EXTRACT(MONTH FROM created_at) = $2`,
             [now.getFullYear(), now.getMonth() + 1]
        );

        const serialNumber = parseInt(serialResult.rows[0].count) + 1;
        const paddedSerialNumber = serialNumber.toString().padStart(4, '0');
        const customInterviewId = `${year}/${monthName}/${paddedSerialNumber}/${customIdText}`;

        if (!Array.isArray(questions)) questions = [String(questions || '')];
        if (!Array.isArray(timeLimits)) {
            timeLimits = String(timeLimits || '').split(',').map(t => parseInt(t, 10) || 0);
        }
        while (timeLimits.length < questions.length) timeLimits.push(0);

        const interviewId = uuidv4();
        createdInterviewId = interviewId;

        await client.query(
            `INSERT INTO interviews 
            (id, custom_interview_id, title, questions, time_limits, date, time, department, created_at, position_status, job_description, created_by_user_id, visitor_reviewer_ids)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), 'open', $9, $10, $11)`,
            [interviewId, customInterviewId, title, questions, timeLimits, date, time, department, jobDescription, createdByUserId, schedulerIds]
        );

        if (!Array.isArray(candidates) || candidates.length === 0) {
            throw new Error("At least one candidate is required.");
        }

        for (const cand of candidates) {
            const { first, last, email } = cand;
            if (!first || !last || !email) {
                throw new Error("Each candidate must include first, last, and email.");
            }

            const sessionId = uuidv4();
            const month = String(new Date().getMonth() + 1).padStart(2, "0");
            const yearFull = String(new Date().getFullYear());
            const randomDigits = String(Math.floor(1000 + Math.random() * 9000));
            const initials = first[0].toUpperCase() + last[0].toUpperCase();
            const candidateCode = `${month}/${yearFull}/${randomDigits}/${initials}`;

            await client.query(
                `INSERT INTO candidate_sessions
                (session_id, interview_id, candidate_first_name, candidate_last_name, candidate_email, candidate_code, department)
                VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [sessionId, interviewId, first, last, email, candidateCode, department]
            );

            createdCandidateRecords.push({ email, first, last });
        }

        await client.query("COMMIT");

        // 🔥🔥🔥 EMAILS SENT AFTER COMMIT — SAFE 🔥🔥🔥
        for (const cand of createdCandidateRecords) {
            console.log("📨 Sending email AFTER COMMIT:", cand.email);
            await sendInterviewEmail(cand.email, createdInterviewId, title, date, time);
        }

        return res.json({
            success: true,
            message: `Interview scheduled for ${createdCandidateRecords.length} candidate(s).`
        });

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ Error in /schedule route:", err);
        return res.status(500).json({ message: err.message });
    } finally {
        client.release();
    }
});


// Excel Export Route
app.get("/api/interview/:id/download-excel", async (req, res) => {
    try {
        const { id } = req.params;

        // -----------------------------------------
        // 1️⃣ FETCH INTERVIEW DETAILS
        // -----------------------------------------
        const interviewRes = await pool.query(
            `SELECT title, custom_interview_id, date, time, department, job_description
             FROM interviews WHERE id = $1`,
            [id]
        );

        if (interviewRes.rows.length === 0)
            return res.status(404).json({ message: "Interview not found" });

        const interview = interviewRes.rows[0];

        // Format time (clean)
        const formattedTime = interview.time
            ? new Date(`1970-01-01T${interview.time}Z`).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "numeric"
              })
            : "N/A";

        // -----------------------------------------
        // 2️⃣ FETCH CANDIDATES
        // -----------------------------------------
        const candRes = await pool.query(
            `SELECT candidate_first_name, candidate_last_name, candidate_email,
                    department, created_at, status, ai_evaluation
             FROM candidate_sessions
             WHERE interview_id = $1
             ORDER BY created_at ASC`,
            [id]
        );

        const candidates = candRes.rows;

        // -----------------------------------------
        // 3️⃣ CREATE WORKBOOK
        // -----------------------------------------
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("Interview Report");

        // -----------------------------------------
        // 4️⃣ METADATA SECTION (Formatted)
        // 7 Columns Wide: A–G
        // -----------------------------------------
        const metadata = [
            ["Interview Title", interview.title],
            ["Interview ID", interview.custom_interview_id],
            ["Department", interview.department],
            ["Date", new Date(interview.date).toLocaleDateString("en-US")],
            ["Time", formattedTime],
            ["Job Description", interview.job_description || ""]
        ];

        metadata.forEach(row => {
            ws.addRow([row[0], row[1], "", "", "", "", ""]);
        });

        // Apply formatting to metadata rows
        for (let i = 1; i <= metadata.length; i++) {
            ws.getCell(`A${i}`).font = { bold: true };
            ws.getCell(`A${i}`).alignment = { wrapText: true, vertical: "top" };
            ws.getCell(`B${i}`).alignment = { wrapText: true, vertical: "top" };
        }

        // Add spacing rows
        ws.addRow([]);
        ws.addRow([]);
        
        const headers = [
            "First Name",
            "Last Name",
            "Email",
            "Department",
            "Invited At",
            "Status",
            "Rating",
            "Summary",
            "JD Match",
            "Suitability",
            "Strengths",
            "Weaknesses"
        ];

        ws.addRow(headers);

        const headerRow = ws.getRow(ws.lastRow.number);
        headerRow.font = { bold: true };
        headerRow.alignment = { wrapText: true };

        // -----------------------------------------
        // 6️⃣ CANDIDATE ROWS
        // -----------------------------------------
        candidates.forEach(c => {
            let rating = "N/A";
            let summary = "N/A";
            let jd_match = "N/A";
            let suitability = "N/A";
            let strengths = "N/A";
            let weaknesses = "N/A";

            if (c.ai_evaluation) {
                rating = c.ai_evaluation.rating ?? "N/A";
                summary = c.ai_evaluation.summary || "N/A";
                jd_match = c.ai_evaluation.jd_match || "N/A";
                suitability = c.ai_evaluation.suitability || "N/A";

                strengths = Array.isArray(c.ai_evaluation.strengths)
                    ? c.ai_evaluation.strengths.join("; ")
                    : "N/A";

                weaknesses = Array.isArray(c.ai_evaluation.weaknesses)
                    ? c.ai_evaluation.weaknesses.join("; ")
                    : "N/A";
            }

            ws.addRow([
                c.candidate_first_name,
                c.candidate_last_name,
                c.candidate_email,
                c.department,
                new Date(c.created_at).toLocaleString("en-US"),
                c.status || "Invited",
                rating,
                summary,
                jd_match,
                suitability,
                strengths,
                weaknesses
            ]);
        });

        // -----------------------------------------
        // 7️⃣ CONTROL COLUMN WIDTHS EXACTLY
        // -----------------------------------------

        // Metadata layout (A-B normal, C-G spacing)
        ws.getColumn(1).width = 22; // Field label
        ws.getColumn(2).width = 50; // Main metadata text
        for (let col = 3; col <= 7; col++) {
            ws.getColumn(col).width = 3; // spacing columns
        }

        // Candidate table (Columns C → N)
        ws.columns.forEach((col, idx) => {
            if (idx + 1 >= 3) {
                let max = 15; // minimum width
                col.eachCell({ includeEmpty: true }, cell => {
                    const v = cell.value ? cell.value.toString() : "";
                    const len = v.length + 2;
                    if (len > max) max = len;
                });
                if (max > 40) max = 40; // cap width
                col.width = max;
                col.alignment = { wrapText: true, vertical: "top" };
            }
        });

        // -----------------------------------------
        // 8️⃣ SEND FILE
        // -----------------------------------------
        const safeName = interview.title.replace(/[^a-z0-9]/gi, "_").toLowerCase();

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${safeName}_report.xlsx"`);

        await wb.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error("Excel Export Error:", err);
        res.status(500).json({ message: "Failed to generate Excel file." });
    }
});

// ========================
// AI Candidate Evaluation (PostgreSQL + Cache)
// ========================
app.post("/api/ai/evaluate-candidate", async (req, res) => {
    try {
        const { interview_id, candidate_email, job_description, transcripts } = req.body;

        if (!interview_id || !candidate_email) {
            return res.status(400).json({ message: "Missing interview_id or candidate_email." });
        }

        if (!job_description || !transcripts) {
            return res.status(400).json({ message: "Missing job description or transcripts." });
        }

        // 1️⃣ CHECK CACHE
        const existing = await pool.query(
            `SELECT ai_used, ai_evaluation 
             FROM candidate_sessions 
             WHERE interview_id = $1 AND candidate_email = $2`,
            [interview_id, candidate_email]
        );

        if (existing.rows.length > 0 && existing.rows[0].ai_used) {
            return res.json({
                evaluation: existing.rows[0].ai_evaluation,
                from_cache: true
            });
        }

        // 2️⃣ RUN AI WITH STRICT SCHEMA ENFORCEMENT
        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

        const prompt = `
You are an expert technical interviewer. Evaluate the candidate using the job description and transcripts.

You MUST return ONLY valid JSON matching EXACTLY this schema:

{
  "rating": number (0–10),
  "summary": string,
  "jd_match": string,
  "suitability": "Strong Fit" | "Good Fit" | "Average" | "Weak" | "No Fit",
  "strengths": string[],
  "weaknesses": string[]
}

❗ DO NOT wrap inside any other object (no "evaluation_report", no "data", no "results").
❗ DO NOT add extra fields.
❗ DO NOT change key names.

### JOB DESCRIPTION:
${job_description}

### TRANSCRIPTS:
${transcripts
    .map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.transcript}`)
    .join("\n\n")}
`;

        const aiResult = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                { text: prompt }
                            ]
                        }
                    ]
                })
            }
        );

        const aiJson = await aiResult.json();

        if (!aiJson?.candidates?.[0]?.content?.parts?.[0]?.text) {
            return res.status(500).json({ message: "AI returned no text" });
        }

        let raw = aiJson.candidates[0].content.parts[0].text;
        let cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

        let evaluation;

        // 3️⃣ PARSE & AUTO-FIX JSON SHAPE
        try {
            evaluation = JSON.parse(cleaned);
        } catch (err) {
            console.error("❌ JSON parse failed. Raw output:", cleaned);
            return res.status(500).json({ message: "AI returned invalid JSON." });
        }

        // AUTO-REPAIR FIELDS IF NEEDED
        evaluation = {
            rating: typeof evaluation.rating === "number" ? evaluation.rating : 0,
            summary: evaluation.summary || "No summary provided.",
            jd_match: evaluation.jd_match || "No JD match analysis provided.",
            suitability: evaluation.suitability || "Average",
            strengths: Array.isArray(evaluation.strengths) ? evaluation.strengths : [],
            weaknesses: Array.isArray(evaluation.weaknesses) ? evaluation.weaknesses : []
        };

        // 4️⃣ STORE INTO DB
        await pool.query(
            `UPDATE candidate_sessions
             SET ai_used = TRUE,
                 ai_evaluation = $1,
                 ai_generated_at = NOW()
             WHERE interview_id = $2 AND candidate_email = $3`,
            [evaluation, interview_id, candidate_email]
        );

        return res.json({
            evaluation,
            from_cache: false
        });

    } catch (err) {
        console.error("❌ AI Evaluation Error:", err);
        return res.status(500).json({ message: "AI evaluation failed." });
    }
});

app.get("/api/interviews/counts", async (req, res) => {
    try {
        const { department } = req.query;
        if (!department) return res.status(400).json({ error: "Department is required." });
        const result = await pool.query(`SELECT position_status, COUNT(*) AS count FROM interviews WHERE department = $1 GROUP BY position_status`, [department]);
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
        if (!interviewIds || !Array.isArray(interviewIds) || !status) { return res.status(400).json({ error: "interviewIds and status are required." }); }
        await pool.query(`UPDATE interviews SET position_status = $1 WHERE id = ANY($2::uuid[])`, [status, interviewIds]);
        res.json({ success: true, message: `${interviewIds.length} interviews updated.` });
    } catch (err) {
        res.status(500).json({ error: "Failed to update interviews." });
    }
});

/* app.post("/api/interviews/bulk-delete", async (req, res) => {
    const { interviewIds } = req.body;
    if (!interviewIds || !Array.isArray(interviewIds) || interviewIds.length === 0) { return res.status(400).json({ error: "interviewIds array is required." }); }
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
});**/

app.post("/api/interviews/bulk-delete", async (req, res) => {
    const { interviewIds } = req.body;

    console.log("Bulk Delete Called. interviewIds:", interviewIds);

    if (!interviewIds || !Array.isArray(interviewIds) || interviewIds.length === 0) {
        return res.status(400).json({ error: "interviewIds array is required." });
    }
});

    

app.get("/api/interviews", async (req, res) => {
    try {
        const { search, department, position_status, page = 1, limit = 10 } = req.query;
        let queryParams = [];
        let whereClauses = [];
        
        // UPDATED: Query to join users table
        let baseQuery = "SELECT i.*, u.first_name, u.last_name FROM interviews i LEFT JOIN users u ON i.created_by_user_id = u.id";

        if (department) { queryParams.push(department); whereClauses.push(`i.department = $${queryParams.length}`); }
        if (position_status) { queryParams.push(position_status); whereClauses.push(`i.position_status = $${queryParams.length}`); }
        if (search) { queryParams.push(`%${search}%`); whereClauses.push(`(i.title ILIKE $${queryParams.length})`); }
        
        if (whereClauses.length > 0) { baseQuery += " WHERE " + whereClauses.join(" AND "); }
        baseQuery += " ORDER BY i.created_at DESC";
        
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const offset = (pageNum - 1) * limitNum;
        
        queryParams.push(limitNum);
        baseQuery += ` LIMIT $${queryParams.length}`;
        queryParams.push(offset);
        baseQuery += ` OFFSET $${queryParams.length}`;
        
        const result = await pool.query(baseQuery, queryParams);
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching interviews:", err);
        res.status(500).json({ error: "Database error" });
    }
});


app.post("/api/interview/:id/toggle-status", async (req, res) => {
    if (req.session.user?.activeDepartment !== 'Admin') {
        return res.status(403).json({ message: "Forbidden: Only admins can change status." });
    }
    const { id } = req.params;
    try {
        const interviewResult = await pool.query("SELECT position_status FROM interviews WHERE id = $1", [id]);
        if (interviewResult.rows.length === 0) {
            return res.status(404).json({ message: "Interview not found." });
        }
        const currentStatus = interviewResult.rows[0].position_status;
        const newStatus = currentStatus === 'open' ? 'closed' : 'open';
        await pool.query("UPDATE interviews SET position_status = $1 WHERE id = $2", [newStatus, id]);
        res.json({ success: true, message: `Interview status changed to ${newStatus}.`, newStatus: newStatus });
    } catch (err) {
        console.error("Failed to toggle interview status:", err);
        res.status(500).json({ error: "Failed to toggle interview status." });
    }
});

app.get("/api/candidates/all", async (req, res) => {
    try {
        const { search, department, page = 1, limit = 10 } = req.query;

        let queryParams = [];
        let whereClauses = [];

        let baseQuery = `
        SELECT 
            cs.session_id,
            cs.candidate_email,
            cs.candidate_code,
            cs.candidate_first_name,
            cs.candidate_last_name,
            cs.status,
            cs.created_at,
            i.title AS interview_title,
            cs.department,
            cs.review_url
            FROM candidate_sessions cs
            JOIN interviews i ON cs.interview_id = i.id
        `;

        // Filter by department
        if (department) {
            queryParams.push(department);
            whereClauses.push(`cs.department = $${queryParams.length}`);
        }

        // 🔍 Search filter
        if (search) {
            queryParams.push(`%${search}%`);
            whereClauses.push(`
                (
                    cs.candidate_email ILIKE $${queryParams.length}
                    OR cs.candidate_code ILIKE $${queryParams.length}
                    OR cs.candidate_first_name ILIKE $${queryParams.length}
                    OR cs.candidate_last_name ILIKE $${queryParams.length}
                    OR (cs.candidate_first_name || ' ' || cs.candidate_last_name) ILIKE $${queryParams.length}
                    OR i.title ILIKE $${queryParams.length}
                )
            `);
        }


        // Apply filters
        if (whereClauses.length > 0) {
            baseQuery += " WHERE " + whereClauses.join(" AND ");
        }

        baseQuery += " ORDER BY cs.created_at DESC";

        // Pagination
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const offset = (pageNum - 1) * limitNum;

        queryParams.push(limitNum);
        baseQuery += ` LIMIT $${queryParams.length}`;

        queryParams.push(offset);
        baseQuery += ` OFFSET $${queryParams.length}`;

        const result = await pool.query(baseQuery, queryParams);
        res.json(result.rows);

    } catch (err) {
        console.error("Error fetching all candidates:", err);
        res.status(500).json({ error: "Database error" });
    }
});

// [NEW] 1. PAGE ROUTE for add_visitors.htm;
// (Place this with your other page routes like /settings.html)
app.get("/add_visitors.html", (req, res) => {
    // SECURITY: Protect this page
    if (req.session.user?.activeDepartment !== 'Admin') {
        return res.status(403).send("<h1>403 Forbidden</h1><p>You must be an admin to access this page.</p>");
    }
    // Assumes 'add_visitors.html' is in your 'views' folder
    res.sendFile(path.join(__dirname, "views", "add_visitors.html"));
});


// [NEW] 2. API ROUTE to GET all visitors
// (Place this with other API routes like /api/users)
// [REPLACE] this route in server.js
app.get("/api/visitors", async (req, res) => {
    // SECURITY: Only Admins can see the visitor list
    if (req.session.user?.activeDepartment !== 'Admin') {
        return res.status(403).json({ message: "Forbidden: Only admins can view visitors." });
    }
    
    try {
        // [NEW] Added 'department' column
        const result = await pool.query("SELECT id, first_name, last_name, email, department FROM visitors ORDER BY created_at DESC");
        res.json(result.rows);
    } catch (error) {
        console.error("Error fetching visitors:", error);
        res.status(500).json({ message: "Failed to fetch visitors." });
    }
});

// [NEW] 3. API ROUTE to ADD a new visitor
// [REPLACE] this route in server.js
app.post("/api/visitors/add", async (req, res) => {
    // SECURITY: Only Admins can add visitors
    if (req.session.user?.activeDepartment !== 'Admin') {
        return res.status(403).json({ message: "Forbidden: Only admins can add visitors." });
    }
    
    // [NEW] Added 'departments'
    const { firstName, lastName, email, password, departments } = req.body;

    if (!firstName || !lastName || !email || !password) {
        return res.status(400).json({ message: "All fields are required." });
    }

    try {
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        const newVisitorResult = await pool.query(
            // [NEW] Added 'department' column
            `INSERT INTO visitors (first_name, last_name, email, password_hash, department)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, email`,
            [firstName, lastName, email, passwordHash, departments || []] // Send departments or empty array
        );
        
        res.status(201).json({ 
            success: true, 
            message: "Visitor added successfully.", 
            user: newVisitorResult.rows[0] 
        });

    } catch (error) {
// ... (rest of the function is the same)
        console.error("Error creating visitor:", error);
        if (error.code === '23505') { // Unique constraint (email)
            return res.status(409).json({ message: "A visitor with this email already exists." });
        }
        res.status(500).json({ message: "An internal server error occurred." });
    }
});

// Add this new route to server.js
app.get("/api/visitors/by-dept", async (req, res) => {
    // Security: Only logged-in users (schedulers) can see the visitor list
    if (!req.session.user) {
        return res.status(401).json({ message: "Not authenticated" });
    }
    
    const { department } = req.query;
    if (!department) {
        return res.status(400).json({ message: "Department is required." });
    }

    try {
        // Fetches visitors where their 'department' array contains the one requested
        // OR visitors who are 'Admins' (if you add an 'Admin' tag)
        const query = `
            SELECT id, first_name, last_name, email 
            FROM visitors 
            WHERE department @> ARRAY[$1::TEXT] OR department @> ARRAY['Admin'::TEXT]
            ORDER BY first_name
        `;
        const { rows } = await pool.query(query, [department]);
        res.json(rows);
    } catch (error) {
        console.error("Error fetching visitors by dept:", error);
        res.status(500).json({ message: "Failed to fetch visitors." });
    }
});

// [NEW] 4. API ROUTE to DELETE a visitor
app.delete("/api/visitors/:id", async (req, res) => {
    // SECURITY: Only Admins can delete visitors
    if (req.session.user?.activeDepartment !== 'Admin') {
        return res.status(403).json({ message: "Forbidden: Only admins can delete visitors." });
    }
    
    const { id } = req.params;

    try {
        const deleteResult = await pool.query("DELETE FROM visitors WHERE id = $1", [id]);
        
        if (deleteResult.rowCount === 0) {
            return res.status(404).json({ message: "Visitor not found." });
        }

        res.json({ success: true, message: "Visitor deleted successfully." });

    } catch (err) {
        console.error("Failed to delete visitor:", err);
        res.status(500).json({ message: "Failed to delete visitor." });
    }
});

// 4. Fetch Interview by 'custom_interview_id'
// (This entire route REPLACES your old one)
app.get("/api/interview/by-custom-id", async (req, res) => {
    // SECURITY: Check for viewer session
    if (!req.session.viewer) {
        return res.status(401).json({ message: "Not authenticated. Please log in as a viewer." });
    }

    // [FIX 1] Trim the input ID to remove any spaces
    const customId = req.query.id ? req.query.id.trim() : null;
    
    if (!customId) {
        return res.status(400).json({ message: "An 'id' query parameter is required." });
    }

    try {
        // 1. Fetch main interview data AND creator name
        const interviewQuery = `
            SELECT i.*, u.first_name, u.last_name
            FROM interviews i
            LEFT JOIN users u ON i.created_by_user_id = u.id
            /* [FIX 2] Use TRIM() on the database column to ignore saved spaces */
            WHERE TRIM(i.custom_interview_id) = $1
        `;
        const interviewResult = await pool.query(interviewQuery, [customId]);

        if (interviewResult.rows.length === 0) {
            return res.status(404).json({ message: "Interview not found. Please check the ID." });
        }
        
        const interviewData = interviewResult.rows[0];

        // 2. Fetch scheduler names (if any)
        let schedulers = [];
        if (interviewData.scheduler_ids && interviewData.scheduler_ids.length > 0) {
            const schedulersResult = await pool.query(
                "SELECT first_name, last_name, email FROM users WHERE id = ANY($1::uuid[])",
                [interviewData.scheduler_ids]
            );
            schedulers = schedulersResult.rows;
        }
        
        // 3. Combine and send the full payload
        // We add the fetched schedulers list to the data object
        const responseData = { ...interviewData, schedulers: schedulers };
        res.json(responseData);


    } catch(err) {
        console.error("Error fetching interview by custom_id:", err);
        res.status(500).json({ message: "An internal server error occurred." });
    }
});

app.get("/api/interview/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const interviewQuery = `
            SELECT i.*, u.first_name, u.last_name, u.email as creator_email
            FROM interviews i
            LEFT JOIN users u ON i.created_by_user_id = u.id
            WHERE i.id = $1
        `;

        const interviewResult = await pool.query(interviewQuery, [id]);

        if (interviewResult.rows.length === 0) {
            return res.status(404).json({ message: "Interview not found" });
        }

        const interviewData = interviewResult.rows[0];

        // ✅ UPDATED QUERY — returns first name, last name, email, status, code
        const candidatesResult = await pool.query(
            `SELECT 
                candidate_first_name,
                candidate_last_name,
                candidate_email,
                candidate_code,
                status
             FROM candidate_sessions 
             WHERE interview_id = $1
             ORDER BY created_at ASC`,
            [id]
        );

        let schedulers = [];
        if (interviewData.scheduler_ids && interviewData.scheduler_ids.length > 0) {
            const schedulersResult = await pool.query(
                "SELECT id, first_name, last_name, email FROM users WHERE id = ANY($1::uuid[])",
                [interviewData.scheduler_ids]
            );
            schedulers = schedulersResult.rows;
        }

        const responseData = {
            ...interviewData,
            candidates: candidatesResult.rows,
            schedulers: schedulers
        };

        res.json(responseData);

    } catch (err) {
        console.error("Error fetching full interview details:", err);
        res.status(500).json({ message: "An internal server error occurred." });
    }
});

app.post("/api/interview/:id/update", async (req, res) => {
    const { id: interviewId } = req.params;
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // Extract body params
        let { title, questions, timeLimits, visitorReviewerIds, candidates } = req.body;

        // -----------------------------
        // 1. Normalize questions & time limits ONLY IF PROVIDED
        // -----------------------------
        if (questions !== undefined) {
            if (!Array.isArray(questions)) {
                questions = [String(questions || "")];
            }
        }

        if (timeLimits !== undefined) {
            if (!Array.isArray(timeLimits)) {
                timeLimits = String(timeLimits || "")
                    .split(",")
                    .map(t => parseInt(t, 10) || 0);
            }

            if (questions && timeLimits.length < questions.length) {
                while (timeLimits.length < questions.length) {
                    timeLimits.push(0);
                }
            }
        }

        // -----------------------------
        // 2. Dynamic interview update
        //    Only update fields that are provided
        // -----------------------------
        let updateFields = [];
        let values = [];
        let idx = 1;

        if (title !== undefined) {
            updateFields.push(`title = $${idx++}`);
            values.push(title);
        }

        if (questions !== undefined) {
            updateFields.push(`questions = $${idx++}`);
            values.push(questions);
        }

        if (timeLimits !== undefined) {
            updateFields.push(`time_limits = $${idx++}`);
            values.push(timeLimits);
        }

        if (visitorReviewerIds !== undefined) {
            updateFields.push(`visitor_reviewer_ids = $${idx++}`);
            values.push(visitorReviewerIds);
        }

        if (updateFields.length > 0) {
            const updateQuery = `
                UPDATE interviews 
                SET ${updateFields.join(", ")}
                WHERE id = $${idx}
            `;
            values.push(interviewId);

            await client.query(updateQuery, values);
        }

        // -----------------------------
        // 3. Add NEW candidates (if provided)
        // -----------------------------
        if (Array.isArray(candidates) && candidates.length > 0) {

            const deptResult = await client.query(
                "SELECT department, title, date, time FROM interviews WHERE id=$1",
                [interviewId]
            );

            const interviewMeta = deptResult.rows[0];
            if (!interviewMeta) throw new Error("Interview not found.");

            const department     = interviewMeta.department;
            const interviewTitle = interviewMeta.title;
            const interviewDate  = interviewMeta.date;
            const interviewTime  = interviewMeta.time;

            for (const cand of candidates) {
                const { first, last, email } = cand;

                if (!first || !last || !email) {
                    throw new Error("Each candidate must include first, last, and email.");
                }

                // Candidate code
                const month = String(new Date().getMonth() + 1).padStart(2, "0");
                const year = String(new Date().getFullYear());
                const randomDigits = Math.floor(1000 + Math.random() * 9000);
                const initials = first[0].toUpperCase() + last[0].toUpperCase();
                const candidateCode = `${month}/${year}/${randomDigits}/${initials}`;
                const sessionId = uuidv4();

                await client.query(
                    `INSERT INTO candidate_sessions 
                    (session_id, interview_id, candidate_first_name, candidate_last_name, candidate_email, candidate_code, department, status)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, 'Invited')`,
                    [sessionId, interviewId, first, last, email, candidateCode, department]
                );

                await sendInterviewEmail(
                    email,
                    interviewId,
                    interviewTitle,
                    interviewDate,
                    interviewTime
                );
            }
        }
        await client.query("COMMIT");

        res.json({
            success: true,
            message: "Interview updated successfully."
        });

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ Update failed:", err);
        res.status(500).json({ success: false, message: err.message || "Update failed." });
    } finally {
        client.release();
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
        `SELECT session_id, candidate_email, status, candidate_code 
        FROM candidate_sessions 
        WHERE interview_id = $1 
        ORDER BY created_at DESC`, [id]);

        res.json(result.rows);
    } catch (err) {
        console.error(`Error fetching candidates for interview ID ${req.params.id}:`, err);
        res.status(500).json({ message: "Failed to fetch candidate list." });
    }
});

// --- FIXED: Allow BOTH users and viewers to resend invite ---
app.post("/api/resend-invite", async (req, res) => {
    const { interviewId, candidateEmail } = req.body;

    // 🔥 Allow: user OR viewer
    if (!req.session || (!req.session.user && !req.session.viewer)) {
        return res.status(401).json({ message: "You must be logged in." });
    }

    if (!interviewId || !candidateEmail) {
        return res.status(400).json({ message: "Interview ID and Candidate Email are required." });
    }

    try {
        // 1. Verify candidate session exists
        const sessionResult = await pool.query(
            `SELECT cs.session_id 
             FROM candidate_sessions cs
             WHERE cs.interview_id = $1 
             AND cs.candidate_email = $2`,
            [interviewId, candidateEmail]
        );

        if (sessionResult.rows.length === 0) {
            return res.status(404).json({ message: "Candidate not found for this interview." });
        }

        // 2. Fetch interview info
        const interviewResult = await pool.query(
            `SELECT title, date, time FROM interviews WHERE id = $1`,
            [interviewId]
        );

        if (interviewResult.rows.length === 0) {
            return res.status(404).json({ message: "Interview details not found." });
        }

        const interview = interviewResult.rows[0];

        // 3. Send email
        const emailResult = await sendInterviewEmail(
            candidateEmail,
            interviewId,
            interview.title,
            interview.date,
            interview.time
        );

        if (!emailResult.success) {
            console.error(`Failed to resend email:`, emailResult.error);
            return res.status(500).json({ message: "Failed to send email due to server error." });
        }

        return res.json({
            success: true,
            message: `Invite resent successfully to ${candidateEmail}.`
        });

    } catch (err) {
        console.error("Error in /api/resend-invite:", err);
        return res.status(500).json({ message: "Internal server error." });
    }
});

// 1. GET Route to fetch full details for the logged-in user
app.get("/api/me/details", async (req, res) => {
    if (!req.session.user || !req.session.user.id) {
        return res.status(401).json({ message: "Not authenticated" });
    }
    const userId = req.session.user.id;
    try {
        const result = await pool.query(
            "SELECT id, first_name, last_name, email FROM users WHERE id = $1",
            [userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }
        res.json(result.rows[0]); // Send user details
    } catch (error) {
        console.error("Error fetching user details:", error);
        res.status(500).json({ message: "Failed to fetch user details." });
    }
});

// [ADD THIS NEW ROUTE] to server.js
app.put("/api/visitors/:id", async (req, res) => {
    // SECURITY: Only Admins can edit visitors
    if (req.session.user?.activeDepartment !== 'Admin') {
        return res.status(403).json({ message: "Forbidden: Only admins can edit visitors." });
    }
    
    const { id } = req.params;
    const { firstName, lastName, email, departments, password } = req.body;

    if (!firstName || !lastName || !email) {
        return res.status(400).json({ message: "First name, last name, and email are required." });
    }

    try {
        if (password && password.trim() !== '') {
            // If a new password is provided, hash it
            const saltRounds = 10;
            const passwordHash = await bcrypt.hash(password, saltRounds);
            await pool.query(
                `UPDATE visitors SET first_name = $1, last_name = $2, email = $3, department = $4, password_hash = $5 WHERE id = $6`,
                [firstName, lastName, email, departments || [], passwordHash, id]
            );
        } else {
            // If no password, update without changing it
            await pool.query(
                `UPDATE visitors SET first_name = $1, last_name = $2, email = $3, department = $4 WHERE id = $5`,
                [firstName, lastName, email, departments || [], id]
            );
        }
        
        res.json({ success: true, message: "Visitor updated successfully." });

    } catch (error) {
        console.error("Error updating visitor:", error);
        if (error.code === '23505') { // Unique constraint (email)
            return res.status(409).json({ message: "A visitor with this email already exists." });
        }
        res.status(500).json({ message: "An internal server error occurred." });
    }
});

// 2. POST Route to update the logged-in user's profile
app.post("/api/me/update", async (req, res) => {
    if (!req.session.user || !req.session.user.id) {
        return res.status(401).json({ message: "Not authenticated" });
    }
    const userId = req.session.user.id;
    const { firstName, lastName, email, password } = req.body; // Password is optional

    // Basic validation
    if (!firstName || !lastName || !email) {
        return res.status(400).json({ message: "First name, last name, and email are required." });
    }

    try {
        let query;
        let queryParams;

        if (password && password.trim() !== '') {
            // If password is provided, hash it and update password_hash
            const saltRounds = 10;
            const passwordHash = await bcrypt.hash(password, saltRounds);
            query = `UPDATE users SET first_name = $1, last_name = $2, email = $3, password_hash = $4 WHERE id = $5`;
            queryParams = [firstName, lastName, email, passwordHash, userId];
        } else {
            // If password is not provided, update only name and email
            query = `UPDATE users SET first_name = $1, last_name = $2, email = $3 WHERE id = $4`;
            queryParams = [firstName, lastName, email, userId];
        }

        await pool.query(query, queryParams);

        // IMPORTANT: Update the email in the session if it changed
        if (req.session.user.email !== email) {
             req.session.user.email = email;
             // cookie-session saves automatically at response time
             return res.json({ success: true, message: "Profile updated successfully." });
        } else {
            return res.json({ success: true, message: "Profile updated successfully." });
        }

    } catch (error) {
        console.error("Error updating profile:", error);
        if (error.code === '23505') { // Handle unique constraint violation for email
            return res.status(409).json({ message: "This email address is already in use by another account." });
        }
        res.status(500).json({ message: "An internal server error occurred while updating profile." });
    }
});


// ========== VIEWER ROUTES ==========
app.post("/viewer/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        // Query the 'visitors' table
        const result = await pool.query("SELECT * FROM visitors WHERE email = $1", [email]);
        const viewer = result.rows[0];

        if (viewer) {
            const isMatch = await bcrypt.compare(password, viewer.password_hash);
            if (isMatch) {
                // Set a 'viewer' session, not a 'user' session
                req.session.viewer = {
                    id: viewer.id,
                    email: viewer.email,
                    name: `${viewer.first_name} ${viewer.last_name}`
                };
                // cookie-session auto-saves on response
                return res.json({
                    success: true,
                    email: viewer.email
                });
            } else {
                res.status(401).json({ message: "Invalid credentials." });
            }
        } else {
            res.status(401).json({ message: "Invalid credentials." });
        }
    } catch (error) {
        console.error("Viewer login error:", error);
        res.status(500).json({ message: "An internal server error occurred." });
    }
});

// ADD THIS NEW ROUTE to server.js
app.post("/api/reviewer-login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        const user = result.rows[0];

        if (user) {
            if (!user.is_active) {
                return res.status(403).json({ message: "Account disabled. Please contact admin." });
            }

            const isMatch = await bcrypt.compare(password, user.password_hash);
            if (isMatch) {
                // Create the standard user session
                req.session.user = {
                    id: user.id,
                    email: user.email,
                    departments: user.department,
                    activeDepartment: user.department[0] // Just pick the first department
                };
                
                // cookie-session auto-saves on response
                return res.json({
                    success: true,
                    id: user.id,
                    email: user.email
                });
            } else {
                 res.status(401).json({ message: "Invalid credentials." });
            }
        } else {
             res.status(401).json({ message: "Invalid credentials." });
        }
    } catch (error) {
        console.error("Reviewer login error:", error);
        res.status(500).json({ message: "An internal server error occurred." });
    }
});

// 2. Check Viewer Session Route
app.get("/viewer/me", (req, res) => {
    if (req.session.viewer) {
        res.json({
            id: req.session.viewer.id,
            email: req.session.viewer.email
        });
    } else {
        res.status(401).json({ message: "Not authenticated" });
    }
});

// 3. Viewer Logout Route
app.get("/viewer/logout", (req, res) => {
    if (req.session.viewer) {
        try {
            req.session = null;
        } catch (err) {
            console.error("Viewer logout error:", err);
            return res.status(500).send("Could not log out.");
        }
        res.clearCookie('session');
        return res.json({ success: true, message: "Logged out." });
    } else {
        res.json({ success: true, message: "No session to clear." });
    }
});


// --- NEW DATA ROUTE FOR VIEWERS ---

// 4. Fetch Interview by 'custom_interview_id'
// We use a query parameter ?id=... because custom IDs contain slashes
// which would break a URL path like /api/interview/by-custom-id/25/Oct/0001/Test



// --- Static Page Routes ---
app.get("/interview-view.html", (req, res) => res.sendFile(path.join(__dirname, "views", "interview-view.html")));
app.get("/interview-edit.html", (req, res) => res.sendFile(path.join(__dirname, "views", "interview-edit.html")));
app.get("/candidates.html", (req, res) => res.sendFile(path.join(__dirname, "views", "candidates.html")));
// Add this line
app.get("/settings.html", (req, res) => {
    // Ensure user is logged in before sending the page
    if (!req.session.user) {
        return res.redirect('/'); // Redirect to login if not authenticated
    }
    // Assuming settings.html is in the 'views' folder like the others
    res.sendFile(path.join(__dirname, "views", "settings.html"));
});

app.get("/visitor_management", (req, res) => {
    // Ensure user is logged in before sending the page
    if (!req.session.user) {
        return res.redirect('/'); // Redirect to login if not authenticated
    }
    // Assuming add_visitors.html is in the 'views' folder like the others
    res.sendFile(path.join(__dirname, "views", "add_visitors.html"));
});
app.get("/interview_viewer.html", (req, res) => {
    // This route just sends the file.
    // The JavaScript INSIDE the file will handle all auth.
    res.sendFile(path.join(__dirname, "views", "interview_viewer.html"));
});

// Add this to your "Static Page Routes" section in server.js

app.get("/candidate-review.html", (req, res) => {
  // Allow either an internal user (admin/staff) or a viewer (external reviewer)
  if (!req.session.user && !req.session.viewer) {
    return res.redirect('/'); // redirect if not authenticated at all
  }

  res.sendFile(path.join(__dirname, "views", "candidate-review.html"));
});

// --------------------------------------------
//  START BACKGROUND VIDEO COMPRESSION WORKER
// --------------------------------------------

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});