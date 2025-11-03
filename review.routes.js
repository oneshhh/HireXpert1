// review.routes.js
const express = require('express');
const router = express.Router();
// Assuming your supabase client is initialized in another file
const { supabase } = require('./supabaseClient'); // Adjust this path if needed

/**
 * Endpoint 1: GET /api/interview/:id/submissions
 * * Fetches all candidates from 'candidate_sessions' for a specific interview
 * and joins their 'answers' to determine an overall submission status.
 */
router.get('/interview/:id/submissions', async (req, res) => {
    const { id: interview_id } = req.params;

    if (!interview_id) {
        return res.status(400).json({ message: 'Interview ID is required.' });
    }

    try {
        // 1. Get all candidates for this interview from candidate_sessions
        const { data: candidates, error: candidatesError } = await supabase
            .from('candidate_sessions')
            .select('name, email, candidate_token, status') // 'status' is your reviewer_status
            .eq('interview_id', interview_id);

        if (candidatesError) throw candidatesError;
        
        // If no candidates, return an empty array
        if (!candidates || candidates.length === 0) {
            return res.json([]);
        }

        // 2. Get all 'answers' for all candidates in this interview
        const candidateTokens = candidates.map(c => c.candidate_token);
        const { data: answers, error: answersError } = await supabase
            .from('answers')
            .select('candidate_token, status') // 'status' here is the processing status
            .in('candidate_token', candidateTokens);

        if (answersError) throw answersError;

        // 3. Combine the data
        const submissions = candidates.map(candidate => {
            // Find all answers for this specific candidate
            const candidateAnswers = answers.filter(a => a.candidate_token === candidate.candidate_token);
            // Get just the list of processing statuses
            const answerStatuses = candidateAnswers.map(a => a.status);
            
            // Calculate the overall submission status
            const overallStatus = calculateOverallSubmissionStatus(answerStatuses);

            return {
                name: candidate.name,
                email: candidate.email,
                candidate_token: candidate.candidate_token,
                reviewer_status: candidate.status, // This is 'To Evaluate', 'Evaluated', etc.
                submission_status: overallStatus // This is 'Completed', 'Started', etc.
            };
        });

        res.json(submissions);

    } catch (error) {
        console.error('Error fetching submissions:', error);
        res.status(500).json({ message: error.message });
    }
});

// Helper function to determine the single "overall" submission status
// (queued -> Opened, processing -> Started, ready -> Completed)
function calculateOverallSubmissionStatus(statuses) {
    if (!statuses || statuses.length === 0) return 'Opened'; // No answers submitted yet

    if (statuses.includes('error')) return 'Error';
    if (statuses.includes('processing')) return 'Started'; // Your 'processing'
    if (statuses.every(s => s === 'ready')) return 'Completed'; // Your 'ready'
    if (statuses.every(s => s === 'queued')) return 'Opened'; // Your 'queued'
    
    // If it's a mix of 'queued' and 'ready' (i.e., in progress)
    return 'Started';
}


/**
 * Endpoint 2: POST /api/candidate/status
 * * Updates the 'status' column in the 'candidate_sessions' table.
 * This is for the REVIEWER'S action (To Evaluate, Discarded, etc.)
 */
router.post('/candidate/status', async (req, res) => {
    const { candidate_token, status } = req.body;

    if (!candidate_token || !status) {
        return res.status(400).json({ message: 'Candidate token and status are required.' });
    }

    try {
        const { error } = await supabase
            .from('candidate_sessions') // Update the correct table
            .update({ status: status }) // Update the correct column
            .eq('candidate_token', candidate_token);

        if (error) throw error;

        res.status(200).json({ message: 'Status updated successfully.' });
    } catch (error) {
        console.error('Error updating candidate status:', error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;