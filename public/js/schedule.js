// This function is defined globally so it can be used by other scripts.
function showNotification(title, text, options = {}) {
    const { isError = false, onConfirm = null, confirmText = 'Confirm', cancelText = 'Cancel', onClose = null } = options;

    const modal = document.getElementById('notification-modal');
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

async function loadSchedulers() {
    const schedulerSelect = document.getElementById('schedulerIds');
    try {
        const response = await fetch('/api/users-by-dept');
        if (!response.ok) throw new Error('Failed to load users. Your session may have expired.');
        
        const users = await response.json();
        schedulerSelect.innerHTML = ''; 

        if (users.length === 0) {
            schedulerSelect.innerHTML = '<option disabled>No users found in your department.</option>';
        } else {
            users.forEach(user => {
                const option = document.createElement('option');
                option.value = user.id;
                option.textContent = `${user.first_name} ${user.last_name}`;
                schedulerSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading schedulers:', error);
        schedulerSelect.innerHTML = '<option disabled>Error loading users.</option>';
        // Show a user-friendly notification about the error
        showNotification(
            'Authentication Error', 
            'Could not load user data. Please log in again and retry.', 
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

  // --- Initial Data Loading ---
  loadSchedulers();
  
  // --- Event Listener for "Apply Time" Button ---
  const applyTimeButton = document.getElementById('apply-time-to-all');
  if (applyTimeButton) {
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

  // --- Main Form Submission Logic ---
  const form = document.getElementById("scheduleForm");
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const formData = new FormData(form);
    const data = {
      title: formData.get("title"),
      customIdText: formData.get("customIdText"),
      questions: formData.getAll("questions[]"),
      timeLimits: formData.getAll("timeLimits[]").map(t => parseInt(t, 10) || 0),
      date: formData.get("date"),
      time: formData.get("time"),
      emails: formData.get("emails"),
      schedulerEmail: formData.get("schedulerEmail"),
      jobDescription: document.getElementById('job-description').value,
      schedulerIds: Array.from(document.getElementById('schedulerIds').selectedOptions).map(opt => opt.value)
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
            {
                isError: false, 
                onClose: () => { window.location.href = redirectUrl; }
            }
        );
      } else {
        showNotification('Error', result.message || "Something went wrong", { isError: true });
      }
    } catch (err) {
      console.error("❌ Critical Error: Failed to schedule interview:", err);
      showNotification('Network Error', "Failed to schedule interview. Please try again.", { isError: true });
    }
  });

  // --- Date/Time Restriction Logic ---
  const dateInput = document.getElementById('interview-date');
  const timeInput = document.getElementById('interview-time');
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  const todayString = today.toISOString().split('T')[0];
  dateInput.min = todayString;

  function handleDateChange() {
      const selectedDate = dateInput.value;
      const todayForCheck = new Date();
      todayForCheck.setMinutes(todayForCheck.getMinutes() - todayForCheck.getTimezoneOffset());
      const todayStringForCheck = todayForCheck.toISOString().split('T')[0];

      if (selectedDate === todayStringForCheck) {
          const now = new Date();
          const hours = String(now.getHours()).padStart(2, '0');
          const minutes = String(now.getMinutes()).padStart(2, '0');
          const currentTime = `${hours}:${minutes}`;
          timeInput.min = currentTime;
          if (timeInput.value < currentTime) {
              timeInput.value = currentTime;
          }
      } else {
          timeInput.min = '';
      }
  }
  dateInput.addEventListener('change', handleDateChange);
  handleDateChange();
  
  // --- Initial UI Management ---
  manageAddQuestionButton();
});