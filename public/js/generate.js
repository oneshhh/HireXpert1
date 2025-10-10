const generateBtn = document.getElementById('generate-questions-btn');
const jobDescriptionEl = document.getElementById('job-description');
const numQuestionsEl = document.getElementById('num-questions');
const questionsContainer = document.getElementById('questions-container');
const difficultyEl = document.getElementById('difficulty');

// This is the hardcoded API key from your file.
const GEMINI_API_KEY = 'AIzaSyBonRjkMwCmh5kxIOgrDLrcNFYdT7h2h9U';

// =================================================================
// ===========        THIS IS THE CORRECTED FUNCTION        ===========
// =================================================================
// This function now correctly creates the time limit dropdown.
function addQuestion(questionText = '') {
  if (questionsContainer.children.length >= 15) return;

  const div = document.createElement("div");
  div.classList.add("flex", "items-start", "gap-4");
  div.innerHTML = `
    <textarea class="w-full rounded-md border border-gray-300 bg-white p-3 text-base text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--primary-color)] focus:ring-1 focus:ring-[var(--primary-color)] min-h-24 flex-1 resize-y" name="questions[]" placeholder="Enter your question here" required>${questionText}</textarea>
    <select name="timeLimits[]" class="w-28 rounded-md border-gray-300 bg-white p-2 text-sm text-[var(--text-primary)] focus:border-[var(--primary-color)] focus:ring-1 focus:ring-[var(--primary-color)] h-12">
        <option value="0">Untimed</option>
        <option value="60">60s</option>
        <option value="90">90s</option>
        <option value="120">120s</option>
        <option value="150">150s</option>
        <option value="180">180s</option>
    </select>
    <button type="button" onclick="this.parentElement.remove(); manageAddQuestionButton();" class="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-md px-4 text-sm font-medium leading-normal tracking-wide bg-[var(--secondary-color)] text-[var(--text-primary)] hover:bg-gray-200 !p-0">
      <span class="material-symbols-outlined text-xl">delete</span>
    </button>
  `;
  questionsContainer.appendChild(div);
  
  if (typeof manageAddQuestionButton === 'function') {
    manageAddQuestionButton();
  }
}
// =================================================================


// Function to set the loading/disabled state for the form
function setFormState(isLoading) {
    generateBtn.disabled = isLoading;
    jobDescriptionEl.disabled = isLoading;
    numQuestionsEl.disabled = isLoading;
    difficultyEl.disabled = isLoading;
    generateBtn.textContent = isLoading ? 'Generating...' : 'Generate';
}

// Event listener for the "Generate" button
generateBtn.addEventListener('click', async () => {
    const jobDescription = jobDescriptionEl.value.trim();
    const numQuestions = numQuestionsEl.value;
    const difficulty = difficultyEl.value;


    if (!jobDescription || numQuestions < 1) {
        // UPDATED: Use the custom pop-up
        showNotification('Input Required', 'Please enter a job description and select the number of questions.', true);
        return;
    }

    setFormState(true);

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `Based on the following job description, generate ${numQuestions} technical interview questions at a "${difficulty}" difficulty level. Return ONLY a valid JSON array of strings, with each string being a question. Do not include any other text, formatting, or markdown backticks. \n\nJob Description: ${jobDescription}`
                    }]
                }]
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`HTTP error! Status: ${response.status} - ${errorData.error.message}`);
        }

        const data = await response.json();

        if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error('Invalid API response format from the AI model.');
        }

        const responseText = data.candidates[0].content.parts[0].text;
        const cleanJsonString = responseText
            .trim()
            .replace(/^```json\n?/, '')
            .replace(/```$/, '');

        const questionsArray = JSON.parse(cleanJsonString);

        questionsContainer.innerHTML = '';
        questionsArray.forEach(question => {
            addQuestion(question);
        });

    } catch (error) {
        // UPDATED: Use the custom pop-up for errors
        showNotification('Generation Error', error.message, true);
        console.error('Generation Error:', error);
    } finally {
        setFormState(false);
    }
});

