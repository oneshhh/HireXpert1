// This function is defined globally so it can be used by other scripts.
function showNotification(title, text, options = {}) {
    const { isError = false, onConfirm = null, confirmText = 'Confirm', cancelText = 'Cancel', onClose = null } = options;

    const modal = document.getElementById('notification-modal');
    // ... (rest of showNotification function is unchanged) ...
    const modalTitle = document.getElementById('notification-modal-title');
    const modalText = document.getElementById('notification-modal-text');
    const modalIcon = document.getElementById('notification-modal-icon');
    const btnContainer = document.getElementById('notification-modal-buttons');
    
    if (!modal) {
        if (onConfirm) {
            if (confirm(`${title}\n${text}`)) {
                onConfirm();
            }
        } else {
            alert(`${title}: ${text}`);
        }
        return;
    }

    modalTitle.textContent = title;
    modalText.textContent = text;
    
    if (isError) {
        modalIcon.innerHTML = `<span class="material-symbols-outlined text-3xl text-red-600">error</span>`;
        modalIcon.className = "mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100";
    } else {
        modalIcon.innerHTML = `<span class="material-symbols-outlined text-3xl text-green-600">check_circle</span>`;
        modalIcon.className = "mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100";
    }

    btnContainer.innerHTML = '';
    
    if (onConfirm) {
        btnContainer.className = 'mt-5 sm:mt-6 sm:grid sm:grid-flow-row-dense sm:grid-cols-2 sm:gap-3';
        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'inline-flex w-full justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 sm:col-start-2';
        confirmBtn.textContent = confirmText;
        confirmBtn.onclick = () => {
            modal.classList.add('hidden');
            onConfirm();
        };
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:col-start-1 sm:mt-0';
        cancelBtn.textContent = cancelText;
        cancelBtn.onclick = () => {
            modal.classList.add('hidden');
        };
        btnContainer.appendChild(cancelBtn);
        btnContainer.appendChild(confirmBtn);
    } else {
        btnContainer.className = 'mt-5 sm:mt-6';
        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = 'inline-flex w-full justify-center rounded-md bg-[var(--primary-color)] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-opacity-90';
        okBtn.textContent = 'Got it';
        okBtn.onclick = () => {
            modal.classList.add('hidden');
            if(typeof onClose === 'function'){
                onClose();
            }
        };
        btnContainer.appendChild(okBtn);
    }
    
    modal.classList.remove('hidden');
}

// ... (manageAddQuestionButton and addQuestion functions are unchanged) ...
function manageAddQuestionButton() {
    const container = document.getElementById("questions-container");
    const addButton = document.querySelector('button[onclick="addQuestion()"]');
    if (container.children.length >= 15) {
        addButton.disabled = true;
        addButton.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
        addButton.disabled = false;
        addButton.classList.remove('opacity-50', 'cursor-not-allowed');
    }
}

function addQuestion(questionText = '') {
  const container = document.getElementById("questions-container");
  if (container.children.length >= 15) return;
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
  container.appendChild(div);
  manageAddQuestionButton();
}

// --- [NEW] ---
// This function now fetches VISITORS based on the selected department
async function loadSchedulers(department) {
    const schedulerSelect = document.getElementById('schedulerIds');
    schedulerSelect.innerHTML = '<option disabled>Loading reviewers...</option>'; // Update text

    if (!department) {
        schedulerSelect.innerHTML = '<option disabled>Please select an interview department first.</option>';
        return;
    }

    try {
        // Call the new API endpoint
        const response = await fetch(`/api/visitors/by-dept?department=${department}`);
        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Your session may have expired. Please log in again.');
            }
            throw new Error('Failed to load reviewers for this department.');
        }
        
        const visitors = await response.json();
        schedulerSelect.innerHTML = ''; // Clear "Loading..."

        if (visitors.length === 0) {
            schedulerSelect.innerHTML = `<option disabled>No reviewers found for ${department}.</option>`;
        } else {
            visitors.forEach(visitor => {
                const option = document.createElement('option');
                option.value = visitor.id; // Use visitor ID
                option.textContent = `${visitor.first_name} ${visitor.last_name} (${visitor.email})`; // Show visitor info
                schedulerSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading schedulers:', error);
        schedulerSelect.innerHTML = `<option disabled>Error loading reviewers.</option>`;
        showNotification(
            'Error', 
            error.message, 
            { isError: true }
        );
    }
}


document.addEventListener("DOMContentLoaded", () => {
  // --- Back Link and Form Data Setup ---
  const urlParams = new URLSearchParams(window.location.search);
  const originDashboard = urlParams.get('from');
  const redirectUrl = originDashboard ? `/${originDashboard}` : '/HR_Dashboard.html';

  const backLink = document.getElementById('back-to-dashboard-link');
  if (backLink) {
      backLink.href = redirectUrl;
  }
  
  // --- Custom ID Prefix Setup ---
  const prefixSpan = document.getElementById('custom-id-prefix');
  if (prefixSpan) {
      const now = new Date();
      const year = now.getFullYear().toString().slice(-2);
      const month = now.toLocaleString('en-US', { month: 'short' });
      prefixSpan.textContent = `${year}/${month}/----/`;
  }
    addCandidateRow();

    document.getElementById("add-candidate-row").onclick = () => {
        addCandidateRow();
};



// --- Candidate Table Logic ---

function addCandidateRow(first = "", last = "", email = "") {
    const tbody = document.querySelector("#candidate-table tbody");

    const row = document.createElement("tr");

    row.innerHTML = `
        <td class="p-2">
            <input value="${first}" type="text" class="first-name w-full border border-gray-300 rounded-md p-2" placeholder="First Name" required>
        </td>
        <td class="p-2">
            <input value="${last}" type="text" class="last-name w-full border border-gray-300 rounded-md p-2" placeholder="Last Name" required>
        </td>
        <td class="p-2">
            <input value="${email}" type="email" class="email w-full border border-gray-300 rounded-md p-2" placeholder="Email" required>
        </td>
        <td class="p-2 text-center">
            <button type="button" class="text-red-500 hover:text-red-700 remove-row">
                <span class="material-symbols-outlined">delete</span>
            </button>
        </td>
    `;

    row.querySelector(".remove-row").onclick = () => row.remove();

    tbody.appendChild(row);
}

  // --- [NEW] ---
  // We need to find the interview department dropdown to add a listener
  // Since it's not in the HTML, I'll assume you'll add it.
  // For now, let's load reviewers for a *default* department.
  // We need the *user's* department to load the initial list.
  
  // [NEW] Get the user's department to filter by default
  async function getActiveDepartmentAndLoadReviewers() {
      try {
          const res = await fetch('/api/me'); // Get logged-in user's info
          if (!res.ok) throw new Error("Could not get user session.");
          const user = await res.json();
          
          const activeDept = user.activeDepartment;
          if (activeDept) {
              loadSchedulers(activeDept); // Load reviewers for the user's dept
          } else {
              throw new Error("No active department found for user.");
          }
      } catch (err) {
          console.error(err);
          showNotification('Error', 'Could not load reviewers. Please log in and try again.', { isError: true });
      }
  }

  getActiveDepartmentAndLoadReviewers();

  // --- Refresh schedulers button ---
    const refreshBtn = document.getElementById("refresh-schedulers");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            try {
                refreshBtn.classList.add("animate-spin");
                refreshBtn.disabled = true;

                // Get department again
                const res = await fetch("/api/me");
                const user = await res.json();
                const dept = user.activeDepartment;

                await loadSchedulers(dept);

            } catch (err) {
                showNotification("Error", "Failed to refresh schedulers.", { isError: true });
            } finally {
                refreshBtn.disabled = false;
                refreshBtn.classList.remove("animate-spin");
            }
        });
    }

  // --- Event Listener for "Apply Time" Button (Unchanged) ---
  const applyTimeButton = document.getElementById('apply-time-to-all');
  if (applyTimeButton) {
  // ... (rest of applyTimeButton listener is unchanged) ...
      applyTimeButton.addEventListener('click', () => {
          const timeLimitSelects = document.querySelectorAll('select[name="timeLimits[]"]');
          if (timeLimitSelects.length > 1) {
              showNotification(
                  'Apply Time to All?',
                  "This will apply the time limit from the first question to all other questions.",
                  { 
                      isError: false,
                      onConfirm: () => {
                          const firstTimeLimit = timeLimitSelects[0].value;
                          for (let i = 1; i < timeLimitSelects.length; i++) {
                              timeLimitSelects[i].value = firstTimeLimit;
                          }
                      },
                      confirmText: 'Yes',
                      cancelText: 'No'
                  }
              );
          } else {
              showNotification('Cannot Apply Time', 'Please add at least two questions to use this feature.', { isError: true });
          }
      });
  }

  // --- Main Form Submission Logic (Unchanged by name, but data is now visitors) ---
    const form = document.getElementById("scheduleForm");
    form.addEventListener("submit", async function (e) {
        e.preventDefault();
        const formData = new FormData(form);

        // This 'schedulerIds' now contains VISITOR IDs
        const visitorReviewerIds = Array.from(
            document.getElementById('schedulerIds').selectedOptions
        ).map(opt => opt.value);

        // ---------------------------
        // FIX: generate candidateCodes BEFORE using them
        // ---------------------------

        function generateCandidateCode(fullName) {
            const now = new Date();
            const year = now.getFullYear().toString().slice(-2);
            const month = now.toLocaleString('en-US', { month: 'short' });

            let initials = "XX";
            if (fullName && fullName.includes(" ")) {
                const [first, last] = fullName.split(" ");
                initials = first.charAt(0).toUpperCase() + last.charAt(0).toUpperCase();
            }

            const uniqueNum = Math.floor(1000 + Math.random() * 9000);
            return `${year}/${month}/${uniqueNum}/${initials}`;
        }

    // ---- NEW CANDIDATE TABLE EXTRACTION ----
    function getCandidatesFromTable() {
        const rows = document.querySelectorAll("#candidate-table tbody tr");
        const candidates = [];

        rows.forEach(row => {
            const first = row.querySelector(".first-name").value.trim();
            const last = row.querySelector(".last-name").value.trim();
            const email = row.querySelector(".email").value.trim();

            if (first && last && email) {
                candidates.push({ first, last, email });
            }
        });

        return candidates;
    }

    const candidates = getCandidatesFromTable();

    // Generate Candidate Codes
    const candidateCodes = candidates.map(c =>
        generateCandidateCode(c.first + " " + c.last)
    );


        // ---------------------------
        // Now build your data object
        // ---------------------------

        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');

        const data = {
            title: formData.get("title"),
            customIdText: formData.get("customIdText"),
            questions: formData.getAll("questions[]"),
            timeLimits: formData.getAll("timeLimits[]").map(t => parseInt(t, 10) || 0),
            date: `${yyyy}-${mm}-${dd}`,
            time: `${hh}:${min}`,
            candidates: candidates,      // <-- now contains first, last, email
            candidateCodes: candidateCodes,
            schedulerEmail: formData.get("schedulerEmail"),
            jobDescription: document.getElementById('job-description').value,
            schedulerIds: visitorReviewerIds
        };

        try {
            const res = await fetch("/schedule", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });

            const result = await res.json();
            if (res.ok) {
                showNotification(
                    'Interview Scheduled!',
                    result.message,
                    { isError: false, onClose: () => { window.location.href = redirectUrl; } }
                );
            } else {
                showNotification('Error', result.message || "Something went wrong", { isError: true });
            }
        } catch (err) {
            console.error("❌ Critical Error: Failed to schedule interview:", err);
            showNotification('Network Error', "Failed to schedule interview. Please try again.", { isError: true });
        }
    });

  
  // --- Initial UI Management (Unchanged) ---
  manageAddQuestionButton();
});
