// js/generate.js

const generateBtn = document.getElementById('generate-questions-btn');
const jobDescriptionEl = document.getElementById('job-description');
const numQuestionsEl = document.getElementById('num-questions');
const questionsContainer = document.getElementById('questions-container');

// 🚨 CRITICAL SECURITY WARNING: This key is exposed to anyone visiting your website.
// It should NOT be used in production. Please use the server.js solution for deployment.
const GEMINI_API_KEY = 'AIzaSyBonRjkMwCmh5kxIOgrDLrcNFYdT7h2h9U';

// A function to add a question to the form
function addQuestion(questionText = '') {
    const div = document.createElement("div");
    div.classList.add("flex", "items-start", "gap-4", "mt-4");
    div.innerHTML = `
        <textarea class="form-input min-h-24 flex-1 resize-y" name="questions[]" placeholder="Enter your question here" required>${questionText}</textarea>
        <input type="number" min="0" name="timeLimits[]" placeholder="Time (sec)" class="form-input w-24 !p-2 text-sm">
        <button type="button" class="btn btn-secondary h-12 w-12 flex-shrink-0 !p-0">
            <span class="material-symbols-outlined text-xl">delete</span>
        </button>
    `;
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

    if (!jobDescription || numQuestions < 1) {
        questionsContainer.innerHTML = `<p class="text-red-500">Please enter a job description and a valid number of questions.</p>`;
        return;
    }

    setFormState(true);
    questionsContainer.innerHTML = '<p class="text-gray-500">Generating questions, please wait...</p>';

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-8b-latest:generateContent?key=${GEMINI_API_KEY}`, {
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
            const errorData = await response.json();
            throw new Error(`HTTP error! Status: ${response.status} - ${errorData.error.message}`);
        }

        const data = await response.json();

        if (data.error || !data.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error('Invalid API response format. The model may have returned an unexpected result.');
        }

        // ⭐ FIX APPLIED HERE: Clean the string before parsing to remove whitespace and markdown backticks.
        const responseText = data.candidates[0].content.parts[0].text;
        const cleanJsonString = responseText
            .trim()
            .replace(/^```json\n?/, '') // Remove starting markdown fence
            .replace(/```$/, '');      // Remove ending markdown fence

        const questionsArray = JSON.parse(cleanJsonString);

        questionsContainer.innerHTML = '';
        questionsArray.forEach(question => {
            addQuestion(question);
        });

    } catch (error) {
        questionsContainer.innerHTML = `<p class="text-red-500">An error occurred: ${error.message}. Please check the console for details.</p>`;
        console.error('Generation Error:', error);
        console.log(API_URL);
    } finally {
        setFormState(false);
    }
});

