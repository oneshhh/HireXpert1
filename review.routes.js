// review.routes.js
const express = require('express');
const router = express.Router();
const pool = require('./db'); // <-- Your pg Pool from db.js
const { supabase_second_db } = require('./supabaseClient'); // <-- Client for 2nd DB

// Allow both user and viewer for GETs.
// For POSTs, allow user, but also allow viewer only for /api/evaluations.
// --- Allow viewers to use evaluation routes safely ---
function allowViewerForGets(req, res, next) {
  // ✅ Viewers can access these paths fully (GET/POST/PUT/DELETE)
  const viewerAllowedPaths = ['/evaluations'];

  const isViewerAllowedPath = viewerAllowedPaths.some(p => req.path.startsWith(p));

  // 1. Allow GET for any logged-in session (user or viewer)
  if (req.method === 'GET') {
    if (req.session?.user || req.session?.viewer) return next();
    return res.status(401).json({ message: 'You must be logged in.' });
  }

  // 2. Allow POST/PUT/DELETE for /evaluations if viewer logged in
  if (isViewerAllowedPath) {
    if (req.session?.user || req.session?.viewer) return next();
    return res.status(401).json({ message: 'You must be logged in.' });
  }

  // 3. For all other modifying routes, only internal user allowed
  if (req.session?.user) return next();

  return res.status(401).json({ message: 'You must be logged in.' });
}

router.use(allowViewerForGets);


/**
 * Endpoint 1: GET /api/interview/:id/submissions
 * This is the complex query that uses both databases.
 */
router.get("/interview/:id/submissions", async (req, res) => {
  const interview_id = req.params.id;

  try {
    // DB_A sessions
    const { rows: sessions } = await pool.query(
      `SELECT candidate_email, candidate_code, status, session_id
       FROM candidate_sessions
       WHERE interview_id = $1
       ORDER BY created_at DESC`,
       [interview_id]
    );

    if (sessions.length === 0) return res.json([]);

    const emails = sessions.map(s => s.candidate_email);

    // DB_B candidate names for this interview
    const { data: candidatesMeta } = await supabase_second_db
      .from("candidates")
      .select("email, interview_id, name")
      .eq("interview_id", interview_id)
      .in("email", emails);

    // DB_B answers for this interview
    const { data: answers } = await supabase_second_db
      .from("answers")
      .select("email, interview_id, status")
      .eq("interview_id", interview_id)
      .in("email", emails);

    function combine(statuses) {
      if (statuses.includes("Completed")) return "Completed";
      if (statuses.includes("Started")) return "Started";
      if (statuses.includes("Opened")) return "Opened";
      return "Invited";
    }

    const submissions = sessions.map(session => {
      const meta = (candidatesMeta || []).find(
        c => c.email === session.candidate_email && c.interview_id === interview_id
      );

      const answerRows = (answers || []).filter(
        a => a.email === session.candidate_email && a.interview_id === interview_id
      );

      const submission_status = combine(answerRows.map(a => a.status));

      return {
        name: meta?.name || null,
        email: session.candidate_email,
        candidate_token: session.candidate_code,   // your own token for review page
        reviewer_status: session.status,
        submission_status,
        session_id: session.session_id
      };
    });

    res.json(submissions);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch submissions" });
  }
});




// Helper function (no changes)
function calculateOverallSubmissionStatus(statuses) {
    if (!statuses || statuses.length === 0) return 'Opened';
    if (statuses.includes('error')) return 'Error';
    if (statuses.includes('processing')) return 'Started';
    if (statuses.every(s => s === 'ready')) return 'Completed';
    if (statuses.every(s => s === 'queued')) return 'Opened';
    return 'Started';
}/**

/**
 * Endpoint 2:
 * POST /api/candidate/status
 * Updates candidate status in MAIN database (DB_A)
 * Works for both logged-in USERS and REVIEWERS (viewers)
 */
router.post("/candidate/status", async (req, res) => {
  try {
    // ✅ Normalize: treat both users and viewers the same
    const sessionUser = req.session.user || req.session.viewer || req.session.visitor;

    if (!sessionUser) {
      return res.status(401).json({ message: "You must be logged in." });
    }

    const { candidate_email, status, interview_id } = req.body;

    if (!candidate_email || !status || !interview_id) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    // ✅ Identify actor for logging
    const actorType = req.session.user
      ? "USER"
      : req.session.viewer
      ? "VIEWER"
      : "VISITOR";

    console.log(
      `[Candidate Status Update] ${actorType} ${
        sessionUser.email || "unknown"
      } is changing ${candidate_email} to "${status}" for interview ${interview_id}`
    );

    // ✅ Update the candidate_sessions table (no updated_at)
    const query = `
      UPDATE candidate_sessions
      SET status = $1
      WHERE candidate_email = $2 AND interview_id = $3
      RETURNING candidate_email, status, interview_id;
    `;

    const result = await pool.query(query, [status, candidate_email, interview_id]);

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ message: "Candidate session not found for this interview." });
    }

    res.status(200).json({
      message: "Status updated successfully.",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating candidate status:", error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Endpoint 3: GET /api/candidate/review/:token
 * Fetches data from BOTH databases for the review page.
 */
router.get('/candidate/review/:token', async (req, res) => {
    const { token } = req.params; // This is the candidate_token
    if (!token) {
        return res.status(400).json({ message: 'Candidate token is required.' });
    }

    try {
        // 1. Get Candidate details from SECOND database (DB_B)
        const { data: candidate, error: candidateError } = await supabase_second_db
            .from('candidates')
            .select('name, email, resume_path, interview_id')
            .eq('candidate_token', token)
            .single();

        if (candidateError) throw candidateError;
        if (!candidate) return res.status(404).json({ message: 'Candidate not found.' });

        // 2. Get the Interview questions from FIRST database (DB_A)
        const { rows: interviews } = await pool.query(
            `SELECT questions, time_limits FROM interviews WHERE id = $1`,
            [candidate.interview_id]
        );
        if (!interviews || interviews.length === 0) {
            return res.status(404).json({ message: 'Interview data not found.' });
        }
        const interview = interviews[0]; // Get the first row

        // 3. Get all Answers from SECOND database (DB_B)
        const { data: answers, error: answersError } = await supabase_second_db
        .from('answers')
        .select('*')
        .eq('candidate_token', token)
        .eq('interview_id', candidate.interview_id) // ✅ NEW
        .order('question_id');

        if (answersError) throw answersError;
        
        // 4. Get the Reviewer Status from FIRST database (DB_A)
        const { rows: sessions } = await pool.query(
            `SELECT status FROM candidate_sessions WHERE candidate_email = $1 AND interview_id = $2`,
            [candidate.email, candidate.interview_id]
        );
        const reviewer_status = (sessions && sessions.length > 0) ? sessions[0].status : 'N/A';
        
        // 5. Combine and create Signed URLs (uses Client 2's storage)
        const enrichedAnswers = await Promise.all(
            answers.map(async (answer) => {
                const questionIndex = parseInt(answer.question_id.replace('q', '')) - 1;
                const question_text = interview.questions[questionIndex] || 'Question text not found';
                const time_limit = interview.time_limits[questionIndex] || 0;

                let videoUrl = null;
                if (answer.raw_path && answer.status === 'ready') {
                    const { data, error } = await supabase_second_db.storage
                        .from('raw') // <-- Make sure 'raw' is the bucket name in DB_B
                        .createSignedUrl(answer.raw_path, 3600);
                    
                    if (error) console.error('Error creating signed URL:', error.message);
                    else videoUrl = data.signedUrl;
                }
                
                const transcript_text = "Transcript processing is " + answer.status;

                return { ...answer, question_text, time_limit, video_url: videoUrl, transcript_text };

            })
        );
        
        // Add the reviewer_status to the candidate object
        const fullCandidateData = { ...candidate, reviewer_status: reviewer_status };

        res.json({ candidate: fullCandidateData, answers: enrichedAnswers });

    } catch (error) {
        console.error('Error fetching candidate review details:', error);
        res.status(500).json({ message: error.message });
    }
});


/**
 * Endpoint 4: POST /api/answer/review
 * Saves the rating and notes to the SECOND database (DB_B).
 */
router.post('/answer/review', async (req, res) => {
    const { answer_id, rating, notes } = req.body;

    if (!answer_id) {
        return res.status(400).json({ message: 'Answer ID is required.' });
    }

    try {
        // Update the 'answers' table in your SECOND database
        const { error } = await supabase_second_db
            .from('answers')
            .update({ rating: rating, notes: notes })
            .eq('id', answer_id);

        if (error) throw error;
        res.status(200).json({ message: 'Review saved successfully.' });
    } catch (error) {
        console.error('Error saving review:', error);
        res.status(500).json({ message: error.message });
    }
});

// --- API for SAVING an individual review (supports both user + viewer) ---
router.post("/evaluations", async (req, res) => {
  try {
    // require viewer OR user in session
    if (!req.session.user && !req.session.viewer) {
      return res.status(401).json({ message: "You must be logged in." });
    }

    const isViewer = !!req.session.viewer;
    const user_id = req.session.user ? req.session.user.id : null;
    const viewer_id = req.session.viewer ? req.session.viewer.id : null;

    const { interview_id, candidate_email, status, rating, notes, summary } = req.body;

    if (!interview_id || !candidate_email) {
      return res.status(400).json({ message: "Missing required fields: interview_id, candidate_email" });
    }

    // Normalize inputs
    const effectiveStatus = status || "To Evaluate";
    const numericRating = (rating !== undefined && rating !== null && rating !== "") ? parseInt(rating, 10) : null;
    const safeNotes = notes || "";
    const safeSummary = summary || "";

    // Use the correct ON CONFLICT target depending on viewer vs user (you have those unique constraints)
    if (isViewer) {
      const q = `
        INSERT INTO reviewer_evaluations
          (interview_id, candidate_email, viewer_id, status, rating, notes, summary, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
        ON CONFLICT (interview_id, candidate_email, viewer_id)
        DO UPDATE SET
          status = EXCLUDED.status,
          rating = EXCLUDED.rating,
          notes = EXCLUDED.notes,
          summary = EXCLUDED.summary,
          updated_at = NOW()
        RETURNING *;
      `;
      const { rows } = await pool.query(q, [
        interview_id, candidate_email, viewer_id, effectiveStatus, numericRating, safeNotes, safeSummary
      ]);
      return res.json({ message: "Evaluation saved (viewer).", evaluation: rows[0] });
    } else {
      const q = `
        INSERT INTO reviewer_evaluations
          (interview_id, candidate_email, user_id, status, rating, notes, summary, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
        ON CONFLICT (interview_id, candidate_email, user_id)
        DO UPDATE SET
          status = EXCLUDED.status,
          rating = EXCLUDED.rating,
          notes = EXCLUDED.notes,
          summary = EXCLUDED.summary,
          updated_at = NOW()
        RETURNING *;
      `;
      const { rows } = await pool.query(q, [
        interview_id, candidate_email, user_id, effectiveStatus, numericRating, safeNotes, safeSummary
      ]);
      return res.json({ message: "Evaluation saved (user).", evaluation: rows[0] });
    }
  } catch (error) {
    console.error("Error saving evaluation:", error);
    // if it's a FK constraint failure, give a clearer message
    if (error.code === "23503") {
      return res.status(400).json({ message: "Foreign key constraint failed: check interview/user/viewer exists" });
    }
    // if ON CONFLICT target mismatch (42P10) — that indicates unique index missing — give hint
    if (error.code === "42P10") {
      return res.status(500).json({ message: "ON CONFLICT target error (42P10). Please ensure unique indexes on reviewer_evaluations exist for (interview_id,candidate_email,user_id) and (interview_id,candidate_email,viewer_id)." });
    }
    res.status(500).json({ message: error.message });
  }
});

/**
 * PUT /api/evaluations
 * Updates an existing evaluation (review) for a candidate by the current user/viewer.
 */
router.put('/evaluations', async (req, res) => {
  const { interview_id, candidate_email, rating, notes, summary, status } = req.body;

  if (!interview_id || !candidate_email) {
    return res.status(400).json({ message: 'Interview ID and candidate email are required.' });
  }

  try {
    // Identify who’s logged in (user or viewer)
    let userId = null;
    let isViewer = false;

    if (req.session && req.session.user) {
      userId = req.session.user.id;
    } else if (req.session && req.session.viewer) {
      userId = req.session.viewer.id;
      isViewer = true;
    } else {
      return res.status(401).json({ message: 'You must be logged in to edit an evaluation.' });
    }

    // Check if evaluation exists
    const checkQuery = `
      SELECT id FROM reviewer_evaluations
      WHERE interview_id = $1
        AND candidate_email = $2
        AND (${isViewer ? 'viewer_id' : 'user_id'}) = $3
      LIMIT 1;
    `;
    const existing = await pool.query(checkQuery, [interview_id, candidate_email, userId]);
    if (existing.rowCount === 0) {
      return res.status(404).json({ message: 'No existing evaluation found to update.' });
    }

    // Update evaluation fields
    const updateQuery = `
      UPDATE reviewer_evaluations
      SET 
        rating = COALESCE($4, rating),
        notes = COALESCE($5, notes),
        summary = COALESCE($6, summary),
        status = COALESCE($7, status),
        updated_at = NOW()
      WHERE interview_id = $1
        AND candidate_email = $2
        AND (${isViewer ? 'viewer_id' : 'user_id'}) = $3
      RETURNING *;
    `;

    const result = await pool.query(updateQuery, [
      interview_id,
      candidate_email,
      userId,
      rating,
      notes,
      summary,
      status
    ]);

    if (result.rowCount === 0) {
      return res.status(400).json({ message: 'Evaluation update failed.' });
    }

    console.log(`Evaluation updated for ${candidate_email} by ${isViewer ? 'viewer' : 'user'} ${userId}`);
    res.status(200).json({ message: 'Evaluation updated successfully.', evaluation: result.rows[0] });
  } catch (error) {
    console.error('Error updating evaluation:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * DELETE /api/evaluations
 * Deletes an evaluation (review) for the given interview_id and candidate_email
 * Works for both users and viewers.
 */
router.delete('/evaluations', async (req, res) => {
  const { interview_id, candidate_email } = req.body;

  // Validate
  if (!interview_id || !candidate_email) {
    return res.status(400).json({ message: 'Interview ID and candidate email are required.' });
  }

  try {
    // Determine current user or viewer identity from session
    let userId = null;
    let isViewer = false;

    if (req.session && req.session.user) {
      userId = req.session.user.id;
    } else if (req.session && req.session.viewer) {
      userId = req.session.viewer.id;
      isViewer = true;
    } else {
      return res.status(401).json({ message: 'You must be logged in to delete an evaluation.' });
    }

    // Delete the matching record
    const deleteQuery = `
      DELETE FROM reviewer_evaluations
      WHERE interview_id = $1
        AND candidate_email = $2
        AND (${isViewer ? 'viewer_id' : 'user_id'}) = $3
      RETURNING *;
    `;

    const result = await pool.query(deleteQuery, [interview_id, candidate_email, userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Evaluation not found or you are not authorized to delete it.' });
    }

    console.log(`Evaluation deleted for ${candidate_email} (interview: ${interview_id}) by ${isViewer ? 'viewer' : 'user'} ${userId}`);
    return res.status(200).json({ message: 'Evaluation deleted successfully.' });
  } catch (error) {
    console.error('Error deleting evaluation:', error);
    return res.status(500).json({ message: error.message });
  }
});


// --- API for the "My Interviews" Dashboard (FOR VISITORS) ---
// (Path becomes: GET /api/viewer/assigned-interviews)
router.get("/viewer/assigned-interviews", async (req, res) => {
    // Check for the *viewer* session, not the *user* session
    if (!req.session.viewer || !req.session.viewer.id) {
        return res.status(401).json({ message: "Not authenticated" });
    }
    // Get the ID from the viewer session
    const user_id = req.session.viewer.id;

    try {
        // 1. Get all stats (this query is the same)
        const statsResult = await pool.query(`
            SELECT interview_id, status, COUNT(*) as count 
            FROM candidate_sessions 
            GROUP BY interview_id, status
        `);
        
        const stats = {};
        for (const row of statsResult.rows) {
            if (!stats[row.interview_id]) {
                stats[row.interview_id] = {};
            }
            stats[row.interview_id][row.status] = parseInt(row.count);
        }

        // 2. Get all interviews assigned to this user (this query is the same)
        const interviewQuery = `
                    SELECT i.*, u.first_name, u.last_name 
                    FROM interviews i
                    LEFT JOIN users u ON i.created_by_user_id = u.id
                    WHERE $1 = ANY(i.visitor_reviewer_ids)
                    ORDER BY i.created_at DESC
                `;
        // Use the user_id from the viewer session
        const { rows: interviews } = await pool.query(interviewQuery, [user_id]);

        // 3. Combine the interviews with their stats (this is the same)
        const response = interviews.map(interview => {
            const interviewStats = stats[interview.id] || {};
            return {
                ...interview,
                stats: { 
                    invited: interviewStats['Invited'] || 0,
                    toEvaluate: interviewStats['To Evaluate'] || 0,
                    evaluated: interviewStats['Evaluated'] || 0,
                    discarded: interviewStats['Discarded'] || 0
                }
            };
        });

        res.json(response);
    } catch (err) {
        console.error("Error fetching assigned interviews for viewer:", err);
        res.status(500).json({ error: "Database error" });
    }
});
// --- API for the "My Interviews" Dashboard ---
// (Path becomes: GET /api/me/assigned-interviews)
router.get("/me/assigned-interviews", async (req, res) => {
    if (!req.session.user || !req.session.user.id) {
        return res.status(401).json({ message: "Not authenticated" });
    }
    const user_id = req.session.user.id;

    try {
        // 1. Get all stats from candidate_sessions first (for our dashboard counts)
        const statsResult = await pool.query(`
            SELECT interview_id, status, COUNT(*) as count 
            FROM candidate_sessions 
            GROUP BY interview_id, status
        `);
        
        // Re-format stats for easy lookup: { 'interview-id-123': { 'Evaluated': 2 } }
        const stats = {};
        for (const row of statsResult.rows) {
            if (!stats[row.interview_id]) {
                stats[row.interview_id] = {};
            }
            stats[row.interview_id][row.status] = parseInt(row.count);
        }

        // 2. Get all interviews assigned to this user
        const interviewQuery = `
                    SELECT i.*, u.first_name, u.last_name 
                    FROM interviews i
                    LEFT JOIN users u ON i.created_by_user_id = u.id
                    WHERE $1 = ANY(i.visitor_reviewer_ids)
                    ORDER BY i.created_at DESC
                `;
        const { rows: interviews } = await pool.query(interviewQuery, [user_id]);

        // 3. Combine the interviews with their stats
        const response = interviews.map(interview => {
            const interviewStats = stats[interview.id] || {};
            return {
                ...interview,
                stats: { // Add the stats under a 'stats' key
                    invited: interviewStats['Invited'] || 0,
                    toEvaluate: interviewStats['To Evaluate'] || 0,
                    evaluated: interviewStats['Evaluated'] || 0,
                    discarded: interviewStats['Discarded'] || 0
                }
            };
        });

        res.json(response);
    } catch (err) {
        console.error("Error fetching assigned interviews:", err);
        res.status(500).json({ error: "Database error" });
    }
});

// GET /api/evaluations?interview_id=...&candidate_email=...
router.get("/evaluations", async (req, res) => {
  try {
    const { interview_id, candidate_email } = req.query;
    if (!interview_id || !candidate_email) {
      return res.status(400).json({ message: "interview_id and candidate_email are required" });
    }

    const query = `
      SELECT e.*,
             COALESCE(u.first_name, v.first_name) AS first_name,
             COALESCE(u.last_name, v.last_name)   AS last_name,
             COALESCE(u.email, v.email)           AS reviewer_email
      FROM reviewer_evaluations e
      LEFT JOIN users u     ON e.user_id   = u.id
      LEFT JOIN visitors v  ON e.viewer_id = v.id
      WHERE e.interview_id = $1
        AND e.candidate_email = $2
      ORDER BY e.updated_at DESC;
    `;

    const { rows } = await pool.query(query, [interview_id, candidate_email]);
    res.json(rows);
  } catch (err) {
    console.error("Error fetching evaluations:", err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;