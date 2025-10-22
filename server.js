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
const bcrypt = require('bcrypt');
const pgSession = require('connect-pg-simple')(session);


const PORT = process.env.PORT || 3000;
const app = express();

// Middleware
app.use(express.json());
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(cors({ origin: "*" }));
app.use(session({
    store: new pgSession({
        pool: pool,                // Use your existing database pool
        tableName: 'user_sessions' // Name of the table to store sessions
    }),
    secret: process.env.SESSION_SECRET || "a-default-secret-for-development",
    resave: false,
    saveUninitialized: true,
    cookie: {
        // Set cookie maxAge to 30 days in milliseconds (previous value was incorrect)
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
}));

// Helper functions
function parseQuestionsField(q) {
    if (!q) return [];
    if (Array.isArray(q)) return q;
    return [String(q)];
}

async function sendInterviewEmail(to, interviewId, title, date, time) {
    const verifiedSenderEmail = process.env.EMAIL_USER || "vanshu2004sabharwal@gmail.com";
    const link = `https://candidateportal1.onrender.com/setup?id=${interviewId}`;
    const msg = {
        to: to,
        from: verifiedSenderEmail,
        subject: `Interview Scheduled: ${title}`,
        html: `<p>Dear Candidate,</p><p>You have an interview scheduled for <b>${title}</b>.</p><p><b>Date:</b> ${date}<br><b>Time:</b> ${time}</p><p>Click <a href="${link}">here</a> to join your interview.</p><p>Regards,<br>HireXpert Team</p>`,
    };
    try {
        await sgMail.send(msg);
        console.log(`✅ Email sent successfully to: ${to} via SendGrid`);
        return { success: true };
    } catch (err) {
        console.error(`❌ CRITICAL: Error sending email via SendGrid:`, err);
        if (err.response) { console.error(err.response.body) }
        return { success: false, error: err };
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

                // Explicitly save the session before redirecting
                req.session.save((err) => {
                    if (err) {
                        console.error("Error saving session before redirect:", err);
                        // Make sure to RETURN here to stop execution
                        return res.status(500).send("Login failed due to session save error.");
                    }

                    console.log('Session saved successfully, redirecting...');
                    if (department === 'Admin') {
                        // Make sure to RETURN here
                        return res.redirect('/admin_Dashboard.html');
                    }
                    // Make sure to RETURN here
                    return res.redirect(`/${department}_Dashboard.html`);
                    // --- END OF REDIRECTS ---
                });

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
    if (req.session.user) {
        // Only send necessary, non-sensitive info
        res.json({
            id: req.session.user.id,
            email: req.session.user.email,
            activeDepartment: req.session.user.activeDepartment
            // You could add first_name, last_name if needed later
        });
    } else {
        // Not logged in
        res.status(401).json({ message: "Not authenticated" });
    }
});

app.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Logout error:", err);
            return res.status(500).send("Could not log out.");
        }
        // Clear the cookie (optional but good practice)
        res.clearCookie('connect.sid'); // Use the default cookie name, adjust if you changed it
        // Redirect to the login page
        res.redirect('/');
    });
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

// ========== CORRECTED: /schedule route to use activeDepartment ==========
app.post("/schedule", async (req, res) => {
    const client = await pool.connect();
    try {
        if (!req.session.user || !req.session.user.activeDepartment || !req.session.user.id) {
            return res.status(401).json({ message: "Unauthorized." });
        }
        const department = req.session.user.activeDepartment;
        const createdByUserId = req.session.user.id;
        
        await client.query('BEGIN');
        let { title, questions, timeLimits, date, time, emails, schedulerEmail, customIdText, jobDescription, schedulerIds } = req.body;

        if (!customIdText) throw new Error("The custom Interview ID text is required.");
        if (!schedulerEmail) throw new Error("Your email for confirmation is required.");
        if (!schedulerIds || schedulerIds.length === 0) throw new Error("At least one scheduler must be assigned.");
        
        const now = new Date();
        const year = now.getFullYear().toString().slice(-2);
        const month = now.toLocaleString('en-US', { month: 'short' });
        const serialResult = await client.query(`SELECT COUNT(*) FROM interviews WHERE EXTRACT(YEAR FROM created_at) = $1 AND EXTRACT(MONTH FROM created_at) = $2`, [now.getFullYear(), now.getMonth() + 1]);
        const serialNumber = parseInt(serialResult.rows[0].count) + 1;
        const paddedSerialNumber = serialNumber.toString().padStart(4, '0');
        const customInterviewId = `${year}/${month}/${paddedSerialNumber}/${customIdText}`;
        
        if (!Array.isArray(questions)) questions = [String(questions || '')];
        if (!Array.isArray(timeLimits)) timeLimits = (String(timeLimits || '').split(',')).map(t => parseInt(t, 10) || 0);
        while (timeLimits.length < questions.length) timeLimits.push(0);
        
        const interviewId = uuidv4();
        await client.query(
          `INSERT INTO interviews (id, custom_interview_id, title, questions, time_limits, date, time, department, created_at, position_status, job_description, created_by_user_id, scheduler_ids)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), 'open', $9, $10, $11)`,
          [interviewId, customInterviewId, title, questions, timeLimits, date, time, department, jobDescription, createdByUserId, schedulerIds]
        );
        
        const candidateEmails = (emails || '').split(',').map(email => email.trim()).filter(email => email);
        for (const email of candidateEmails) {
            const sessionId = uuidv4();
            await client.query(`INSERT INTO candidate_sessions (session_id, interview_id, candidate_email, department) VALUES ($1, $2, $3, $4)`, [sessionId, interviewId, email, department]);
            const emailResult = await sendInterviewEmail(email, interviewId, title, date, time);
            if (!emailResult.success) throw new Error(`Failed to send email to candidate ${email}.`);
        }
        
        const schedulerEmailResult = await sendSchedulerConfirmationEmail(schedulerEmail, title, date, time, candidateEmails);
        if (!schedulerEmailResult.success) { throw new Error("Failed to send confirmation email to scheduler."); }
        
        await client.query('COMMIT');
        res.json({ success: true, message: `Interview scheduled for ${candidateEmails.length} candidate(s).` });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Error in /schedule route:", err.message);
        if (err.code === '23505' && err.constraint === 'interviews_custom_interview_id_key') {
            return res.status(409).json({ message: "An interview with this custom ID text already exists for this month/year. Please use a different text." });
        }
        res.status(500).json({ message: err.message || "Failed to schedule interview." });
    } finally {
        client.release();
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

app.post("/api/interviews/bulk-delete", async (req, res) => {
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
        let baseQuery = ` SELECT cs.session_id, cs.candidate_email, cs.status, cs.created_at, i.title AS interview_title, cs.department, cs.review_url FROM candidate_sessions cs JOIN interviews i ON cs.interview_id = i.id `;
        if (department) { queryParams.push(department); whereClauses.push(`cs.department = $${queryParams.length}`); }
        if (search) { queryParams.push(`%${search}%`); whereClauses.push(`(cs.candidate_email ILIKE $${queryParams.length} OR i.title ILIKE $${queryParams.length})`); }
        if (whereClauses.length > 0) { baseQuery += " WHERE " + whereClauses.join(" AND "); }
        baseQuery += " ORDER BY cs.created_at DESC";
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
        const candidatesResult = await pool.query("SELECT candidate_email, status FROM candidate_sessions WHERE interview_id = $1", [id]);
        let schedulers = [];
        if (interviewData.scheduler_ids && interviewData.scheduler_ids.length > 0) {
            const schedulersResult = await pool.query("SELECT id, first_name, last_name, email FROM users WHERE id = ANY($1::uuid[])", [interviewData.scheduler_ids]);
            schedulers = schedulersResult.rows;
        }
        const responseData = { ...interviewData, candidates: candidatesResult.rows, schedulers: schedulers };
        res.json(responseData);
    } catch(err) {
        console.error("Error fetching full interview details:", err);
        res.status(500).json({ message: "An internal server error occurred." });
    }
});

app.post("/api/interview/:id/update", async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Destructure all expected data from the request body
        let { title, questions, timeLimits, schedulerIds, newEmails } = req.body;
        
        // 2. Data validation and cleanup
        if (!Array.isArray(questions)) questions = [String(questions || '')];
        if (!Array.isArray(timeLimits)) timeLimits = (String(timeLimits || '').split(',')).map(t => parseInt(t, 10) || 0);
        while (timeLimits.length < questions.length) timeLimits.push(0);

        // 3. Update the main interview details
        await client.query(
            `UPDATE interviews SET title=$1, questions=$2, time_limits=$3, scheduler_ids=$4 WHERE id=$5`,
            [title, questions, timeLimits, schedulerIds, id]
        );

        // 4. Handle adding and emailing new candidates
        const candidateEmails = (newEmails || '').split(',').map(email => email.trim()).filter(email => email);
        if (candidateEmails.length > 0) {
            // Fetch interview details needed for the email
            const interviewResult = await client.query('SELECT title, date, time, department FROM interviews WHERE id = $1', [id]);
            const interview = interviewResult.rows[0];

            for (const email of candidateEmails) {
                const sessionId = uuidv4();
                // Add new candidate to the sessions table
                await client.query(
                    `INSERT INTO candidate_sessions (session_id, interview_id, candidate_email, department) VALUES ($1, $2, $3, $4)`,
                    [sessionId, id, email, interview.department]
                );
                // Send them an invitation email
                await sendInterviewEmail(email, id, interview.title, interview.date, interview.time);
            }
        }
        
        // 5. If all steps succeed, commit the transaction
        await client.query('COMMIT');
        res.json({ message: "Interview updated successfully." });

    } catch (err) {
        // If any step fails, roll back the entire transaction
        await client.query('ROLLBACK');
        console.error("Update failed:", err);
        res.status(500).json({ message: "Update failed due to an internal error." });
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
        const result = await pool.query(`SELECT session_id, candidate_email, status FROM candidate_sessions WHERE interview_id = $1 ORDER BY created_at DESC`, [id]);
        res.json(result.rows);
    } catch (err) {
        console.error(`Error fetching candidates for interview ID ${req.params.id}:`, err);
        res.status(500).json({ message: "Failed to fetch candidate list." });
    }
});

// --- NEW ROUTE for Resending Invites ---
app.post("/api/resend-invite", async (req, res) => {
    const { interviewId, candidateEmail } = req.body;

    if (!interviewId || !candidateEmail) {
        return res.status(400).json({ message: "Interview ID and Candidate Email are required." });
    }

    try {
        // 1. Verify the candidate session exists for this interview
        const sessionResult = await pool.query(
            `SELECT cs.session_id FROM candidate_sessions cs
             WHERE cs.interview_id = $1 AND cs.candidate_email = $2`,
            [interviewId, candidateEmail]
        );

        if (sessionResult.rows.length === 0) {
            return res.status(404).json({ message: "Candidate not found for this interview." });
        }

        // 2. Fetch the interview details needed for the email
        const interviewResult = await pool.query(
            `SELECT title, date, time FROM interviews WHERE id = $1`,
            [interviewId]
        );

        if (interviewResult.rows.length === 0) {
            return res.status(404).json({ message: "Interview details not found." });
        }
        const interview = interviewResult.rows[0];

        // 3. Call the existing email function
        const emailResult = await sendInterviewEmail(
            candidateEmail,
            interviewId, // Pass the interview ID itself, not the session ID for the generic link
            interview.title,
            interview.date,
            interview.time
        );

        if (!emailResult.success) {
            // Log the detailed error on the server but send a generic message to the client
            console.error(`Failed to resend email to ${candidateEmail} for interview ${interviewId}:`, emailResult.error);
            return res.status(500).json({ message: "Failed to send email due to a server error." });
        }

        // 4. Send success response
        res.json({ success: true, message: `Invite resent successfully to ${candidateEmail}.` });

    } catch (err) {
        console.error("Error in /api/resend-invite route:", err);
        res.status(500).json({ message: "An internal server error occurred." });
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