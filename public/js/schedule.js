document.addEventListener("DOMContentLoaded", () => {
  // --- Dynamic Redirect Logic ---
  const urlParams = new URLSearchParams(window.location.search);
  const originDashboard = urlParams.get('from');
  const redirectUrl = originDashboard ? `/${originDashboard}` : '/HR_Dashboard.html';
  const backLink = document.getElementById('back-to-dashboard-link');
  if (backLink) {
      backLink.href = redirectUrl;
  }

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
  handleDateChange(); // Initial check
  manageAddQuestionButton(); // Initial check for the add button

  // --- "Apply Time to All" Logic ---
  const applyTimeButton = document.getElementById('apply-time-to-all');
  if (applyTimeButton) {
      applyTimeButton.addEventListener('click', () => {
          const timeLimitSelects = document.querySelectorAll('select[name="timeLimits[]"]');
          if (timeLimitSelects.length > 1) {
              if (confirm('Apply the time limit from the first question to all other questions?')) {
                  const firstTimeLimit = timeLimitSelects[0].value;
                  for (let i = 1; i < timeLimitSelects.length; i++) {
                      timeLimitSelects[i].value = firstTimeLimit;
                  }
              }
          } else {
              showNotification('Cannot Apply Time', 'Please add at least two questions to use this feature.', true);
          }
      });
  }

  // --- Form Submission Logic ---
  const form = document.getElementById("scheduleForm");
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const formData = new FormData(form);
    const data = {
      title: formData.get("title"),
      questions: formData.getAll("questions[]"),
      timeLimits: formData.getAll("timeLimits[]").map(t => parseInt(t, 10) || 0),
      date: formData.get("date"),
      time: formData.get("time"),
      emails: formData.get("emails"),
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
            false, 
            () => { window.location.href = redirectUrl; }
        );
      } else {
        showNotification('Error', result.message || "Something went wrong", true);
      }
    } catch (err) {
      console.error("Critical Error:", err);
      showNotification('Network Error', "Failed to schedule interview.", true);
    }
  });
});

