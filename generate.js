// js/generate.js

const generateBtn = document.getElementById('generate-questions-btn');
const jobDescriptionEl = document.getElementById('job-description');
const numQuestionsEl = document.getElementById('num-questions');
const questionsContainer = document.getElementById('questions-container');

// 🚨 IMPORTANT: Replace this placeholder with the API key you confirmed works in the tester.
const GEMINI_API_KEY = 'AIzaSyCXjVe1B-s5Yyakl5upyIHrErdbZ1h8pP0';

// A function to add a question to the form
function addQuestion(questionText = '') {
    const div = document.createElement("div");
    div.classList.add("flex", "items-start", "gap-4", "mt-4"); // Added margin-top for spacing
    div.innerHTML = `
        <textarea class="form-input min-h-24 flex-1 resize-y" name="questions[]" placeholder="Enter your question here" required>${questionText}</textarea>
        <input type="number" min="0" name="timeLimits[]" placeholder="Time (sec)" class="form-input w-24 !p-2 text-sm">
        <button type="button" class="btn btn-secondary h-12 w-12 flex-shrink-0 !p-0">
            <span class="material-symbols-outlined text-xl">delete</span>
        </button>
    `;
    // Add event listener to the delete button instead of using inline onclick
    div.querySelector('button').addEventListener('click', () => div.remove());
    questionsContainer.appendChild(div);
}

// Function to set the loading/disabled state for the form
function setFormState(isLoading) {
    generateBtn.disabled = isLoading;
    jobDescriptionEl.disabled = isLoading;
    numQuestionsEl.disabled = isLoading;
    generateBtn.textContent = isLoading ? 'Generating...' : 'Generate Questions';
}

// Event listener for the "Generate" button
generateBtn.addEventListener('click', async () => {
    const jobDescription = jobDescriptionEl.value.trim();
    const numQuestions = numQuestionsEl.value;

    // Use a custom modal/message instead of alert()
    if (!jobDescription || numQuestions < 1) {
        questionsContainer.innerHTML = `<p class="text-red-500">Please enter a job description and a valid number of questions.</p>`;
        return;
    }

    setFormState(true); // Disable form and show loading state
    questionsContainer.innerHTML = '<p class="text-gray-500">Generating questions, please wait...</p>';

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `Based on the following job description, generate ${numQuestions} technical interview questions. Return ONLY a valid JSON array of strings, with each string being a question. Do not include any other text, formatting, or markdown backticks. \n\nJob Description: ${jobDescription}`
                    }]
                }]
            })
        });

        if (!response.ok) {
            // Handle HTTP errors like 400, 404 or 500
            const errorData = await response.json();
            throw new Error(`HTTP error! Status: ${response.status} - ${errorData.error.message}`);
        }

        const data = await response.json();

        // Handle API errors embedded in a 200 OK response
        if (data.error || !data.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error('Invalid API response format. The model may have returned an unexpected result.');
        }

        // Extract and parse the questions from the response
        // Added a cleanup step to handle potential markdown backticks from the model
        const responseText = data.candidates[0].content.parts[0].text.trim().replace(/^```json\n?/, '').replace(/```$/, '');
        const questionsArray = JSON.parse(responseText); 

        questionsContainer.innerHTML = ''; // Clear loading message
        questionsArray.forEach(question => {
            addQuestion(question);
        });

    } catch (error) {
        // Catch network errors and other exceptions
        questionsContainer.innerHTML = `<p class="text-red-500">An error occurred: ${error.message}. Please check the console for details.</p>`;
        console.error('Generation Error:', error);
    } finally {
        setFormState(false); // Re-enable the form in all cases
    }
});