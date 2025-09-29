document.addEventListener("DOMContentLoaded", () => {
  // =================================================================
  // ===========        DYNAMIC REDIRECT LOGIC         ===========
  // =================================================================
  // 1. Read the 'from' parameter from the page's URL
  const urlParams = new URLSearchParams(window.location.search);
  const originDashboard = urlParams.get('from');
  
  // 2. Determine the correct URL to redirect back to. Default to HR if it's missing.
  const redirectUrl = originDashboard ? `/${originDashboard}` : '/HR_Dashboard.html';

  // 3. Find the "Dashboard" link in the header and update its destination
  const backLink = document.getElementById('back-to-dashboard-link');
  if (backLink) {
      backLink.href = redirectUrl;
  }
  // =================================================================


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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const result = await res.json();

      if (res.ok) {
        console.log(`✅ Interview scheduled! Response:`, result.message);
        
        // 4. Use the dynamic redirectUrl we created above
        window.location.href = redirectUrl;
      } else {
        console.error(`❌ Error: ${result.message || "Something went wrong"}`);
        alert(`❌ Error: ${result.message || "Something went wrong"}`);
      }
    } catch (err) {
      console.error("❌ Critical Error: Failed to schedule interview:", err);
      alert("❌ Failed to schedule interview. Check the console for details.");
    }
  });
});

