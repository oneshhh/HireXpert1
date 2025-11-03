// review.routes.js
const express = require('express');
const router = express.Router();
const pool = require('./db'); // <-- Your pg Pool from db.js
const { supabase_second_db } = require('./supabaseClient'); // <-- Client for 2nd DB

/**
 * Endpoint 1: GET /api/interview/:id/submissions
 * This is the complex query that uses both databases.
 */
router.get('/interview/:id/submissions', async (req, res) => {
    const { id: interview_id } = req.params;

    if (!interview_id) {
        return res.status(400).json({ message: 'Interview ID is required.' });
    }

    try {
        // 1. Get candidate sessions from your MAIN database (DB_A)
        const { rows: sessions } = await pool.query(
            `SELECT candidate_email, status, session_id FROM candidate_sessions WHERE interview_id = $1`,
            [interview_id]
        );

        if (!sessions || sessions.length === 0) {
            return res.json([]);
        }

        // 2. Get emails to find candidates in the SECOND database (DB_B)
        const emails = sessions.map(s => s.candidate_email);

        // 3. Get candidate details (name, token) from SECOND database (DB_B)
        const { data: candidates, error: candidatesError } = await supabase_second_db
            .from('candidates')
            .select('name, email, candidate_token')
            .in('email', emails);

        if (candidatesError) throw candidatesError;

        // 4. Get answer statuses from SECOND database (DB_B)
        const candidateTokens = candidates.map(c => c.candidate_token);
        if (candidateTokens.length === 0) {
            return res.json([]); // No matching candidates found in 2nd DB
        }

        const { data: answers, error: answersError } = await supabase_second_db
            .from('answers')
            .select('candidate_token, status')
            .in('candidate_token', candidateTokens);

        if (answersError) throw answersError;

        // 5. Combine all data in JavaScript
        const submissions = sessions.map(session => {
            // Find the matching candidate from DB_B
            const candidate = candidates.find(c => c.email === session.candidate_email);
            
            if (!candidate) {
                return null; // Should not happen if data is in sync
            }

            // Find all answers for this candidate
            const candidateAnswers = answers.filter(a => a.candidate_token === candidate.candidate_token);
            const answerStatuses = candidateAnswers.map(a => a.status);
            const overallStatus = calculateOverallSubmissionStatus(answerStatuses);

            return {
                name: candidate.name,
                email: session.candidate_email,
                // We pass the candidate_token from DB_B, as it's needed for reviews
                candidate_token: candidate.candidate_token, 
                // We pass the session_id from DB_A, in case we need to update status
                session_id: session.session_id, 
                reviewer_status: session.status, // 'To Evaluate', etc. from DB_A
                submission_status: overallStatus // 'Completed', 'Started', etc. from DB_B
            };
        }).filter(Boolean); // Filter out any nulls

        res.json(submissions);

    } catch (error) {
        console.error('Error fetching submissions:', error);
        res.status(500).json({ message: error.message });
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
 * Endpoint 1: GET /api/interview/:id/submissions
 * This is the complex query that uses both databases.
 */
router.get('/interview/:id/submissions', async (req, res) => {
    const { id: interview_id } = req.params;

    if (!interview_id) {
        return res.status(400).json({ message: 'Interview ID is required.' });
    }

    try {
        // 1. Get candidate sessions from your MAIN database (DB_A)
        const { rows: sessions } = await pool.query(
            `SELECT candidate_email, status, session_id FROM candidate_sessions WHERE interview_id = $1`,
            [interview_id]
        );

        if (!sessions || sessions.length === 0) {
            return res.json([]);
        }

        // 2. Get emails to find candidates in the SECOND database (DB_B)
        const emails = sessions.map(s => s.candidate_email);

        // 3. Get candidate details (name, token) from SECOND database (DB_B)
        //    (*** THIS IS THE FIXED QUERY ***)
        const { data: candidates, error: candidatesError } = await supabase_second_db
            .from('candidates')
            .select('name, email, candidate_token')
            .in('email', emails) // Email must be in our list
            .eq('interview_id', interview_id); // AND interview_id MUST match

        if (candidatesError) throw candidatesError;

        // 4. Get answer statuses from SECOND database (DB_B)
        const candidateTokens = candidates.map(c => c.candidate_token);
        if (candidateTokens.length === 0) {
            return res.json([]); // No matching candidates found in 2nd DB
        }

        const { data: answers, error: answersError } = await supabase_second_db
            .from('answers')
            .select('candidate_token, status')
            .in('candidate_token', candidateTokens);

        if (answersError) throw answersError;

        // 5. Combine all data in JavaScript (no changes here)
        const submissions = sessions.map(session => {
            const candidate = candidates.find(c => c.email === session.candidate_email);
            if (!candidate) return null; 

            const candidateAnswers = answers.filter(a => a.candidate_token === candidate.candidate_token);
            const answerStatuses = candidateAnswers.map(a => a.status);
            const overallStatus = calculateOverallSubmissionStatus(answerStatuses);

            return {
                name: candidate.name,
                email: session.candidate_email,
                candidate_token: candidate.candidate_token,
                session_id: session.session_id,
                reviewer_status: session.status,
                submission_status: overallStatus
            };
        }).filter(Boolean); 

        res.json(submissions);

    } catch (error) {
        console.error('Error fetching submissions:', error);
        res.status(500).json({ message: error.message });
    }
});

/**
 * Endpoint 2: POST /api/candidate/status
 * Updates the reviewer status in your MAIN database (DB_A).
 */
router.post('/candidate/status', async (req, res) => {
    // We will use candidate_email to update the status, as token is not in this table
    const { candidate_email, status, interview_id } = req.body;

    if (!candidate_email || !status || !interview_id) {
        return res.status(400).json({ message: 'Email, status, and interview ID are required.' });
    }

    try {
        // Update 'candidate_sessions' in your FIRST database (DB_A)
        await pool.query(
            `UPDATE candidate_sessions SET status = $1 WHERE candidate_email = $2 AND interview_id = $3`,
            [status, candidate_email, interview_id]
        );
        res.status(200).json({ message: 'Status updated successfully.' });
    } catch (error) {
        console.error('Error updating candidate status:', error);
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

                return { ...answer, question_text, time_limit, video_url, transcript_text };
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


module.exports = router;