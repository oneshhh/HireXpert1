document.addEventListener('DOMContentLoaded', () => {
    const generateBtn = document.getElementById('generate-questions-btn');
    const jobDescriptionEl = document.getElementById('job-description');
    const numQuestionsEl = document.getElementById('num-questions');
    const questionsContainer = document.getElementById('questions-container');
    const difficultyEl = document.getElementById('difficulty');

    function setFormState(isLoading) {
        generateBtn.disabled = isLoading;
        jobDescriptionEl.disabled = isLoading;
        numQuestionsEl.disabled = isLoading;
        difficultyEl.disabled = isLoading;
        generateBtn.textContent = isLoading ? 'Generating...' : 'Generate';
    }

    generateBtn.addEventListener('click', async () => {
        const jobDescription = jobDescriptionEl.value.trim();
        const numQuestions = numQuestionsEl.value;
        const difficulty = difficultyEl.value;

        if (!jobDescription || !numQuestions || numQuestions < 1) {
            // Use the new custom notification pop-up
            showNotification('Input Required', 'Please enter a job description and select the number of questions.', true);
            return;
        }

        setFormState(true);
        const originalButtonText = generateBtn.textContent;
        generateBtn.textContent = 'Generating...';

        try {
            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobDescription, numQuestions, difficulty })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to generate questions');
            }
            
            const data = await response.json();
            
            if (!data.candidates || !data.candidates[0].content) {
                throw new Error("Invalid response format from the AI model.");
            }

            const responseText = data.candidates[0].content.parts[0].text;
            const cleanJsonString = responseText.trim().replace(/^```json\n?/, '').replace(/```$/, '');
            const questionsArray = JSON.parse(cleanJsonString);
            
            questionsContainer.innerHTML = '';
            questionsArray.forEach(question => {
                // Assuming addQuestion is a global function from schedule.html
                if (typeof addQuestion === 'function') {
                    addQuestion(question);
                }
            });

        } catch (error) {
            console.error('Generation Error:', error);
            // Use the new custom notification pop-up for errors
            showNotification('Generation Error', error.message, true);
        } finally {
            setFormState(false);
            generateBtn.textContent = 'Generate'; // Reset to original text, not a variable
        }
    });
});

