const generateBtn = document.getElementById('generate-questions-btn');
const jobDescriptionEl = document.getElementById('job-description');
const numQuestionsEl = document.getElementById('num-questions');
const questionsContainer = document.getElementById('questions-container');
const difficultyEl = document.getElementById('difficulty'); // Added for completeness

// This is the hardcoded API key from your file.
const GEMINI_API_KEY = 'AIzaSyBonRjkMwCmh5kxIOgrDLrcNFYdT7h2h9U';

// =================================================================
// ===========        THIS IS THE CORRECTED FUNCTION        ===========
// =================================================================
// This function now correctly creates the time limit dropdown, matching the main page.
function addQuestion(questionText = '') {
  if (questionsContainer.children.length >= 10) return;

  const div = document.createElement("div");
  div.classList.add("flex", "items-start", "gap-4");
  div.innerHTML = `
    <textarea class="w-full rounded-md border border-gray-300 bg-white p-3 text-base text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--primary-color)] focus:ring-1 focus:ring-[var(--primary-color)] min-h-24 flex-1 resize-y" name="questions[]" placeholder="Enter your question here" required>${questionText}</textarea>
    <select name="timeLimits[]" class="w-28 rounded-md border-gray-300 bg-white p-2 text-sm text-[var(--text-primary)] focus:border-[var(--primary-color)] focus:ring-1 focus:ring-[var(--primary-color)] h-12">
        <option value="0">Untimed</option>
        <option value="30">30s</option>
        <option value="60">60s</option>
        <option value="90">90s</option>
        <option value="120">120s</option>
    </select>
    <button type="button" onclick="this.parentElement.remove(); manageAddQuestionButton();" class="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-md px-4 text-sm font-medium leading-normal tracking-wide bg-[var(--secondary-color)] text-[var(--text-primary)] hover:bg-gray-200 !p-0">
      <span class="material-symbols-outlined text-xl">delete</span>
    </button>
  `;
  questionsContainer.appendChild(div);
  // This function is defined in your schedule.html and will be available to this script
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
        alert("Please enter a job description and a valid number of questions.");
        return;
    }

    setFormState(true);
    // Don't clear the container here, show a more subtle loading state
    const originalButtonText = generateBtn.textContent;
    generateBtn.textContent = 'Generating...';


    try {
        // NOTE: Your generate.js file had a typo in the model name. It should be gemini-1.5-flash-latest.
        // I have corrected it here.
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`, {
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
            throw new Error('Invalid API response format. The model may have returned an unexpected result.');
        }

        const responseText = data.candidates[0].content.parts[0].text;
        const cleanJsonString = responseText
            .trim()
            .replace(/^```json\n?/, '')
            .replace(/```$/, '');

        const questionsArray = JSON.parse(cleanJsonString);

        questionsContainer.innerHTML = ''; // Now we clear the container
        questionsArray.forEach(question => {
            addQuestion(question);
        });

    } catch (error) {
        alert(`An error occurred: ${error.message}. Please check the console for details.`);
        console.error('Generation Error:', error);
    } finally {
        setFormState(false);
        generateBtn.textContent = originalButtonText;
    }
});

