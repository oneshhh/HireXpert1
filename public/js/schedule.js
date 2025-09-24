document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("scheduleForm");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    const formData = new FormData(form);
    
    // This 'data' object is now correctly aligned with the form and the server.
    const data = {
      title: formData.get("title"),
      questions: formData.getAll("questions[]"),
      timeLimits: formData.getAll("timeLimits[]").map(t => parseInt(t) || 0),
      date: formData.get("date"),
      time: formData.get("time"),
      // =================================================================
      // =========== THIS IS THE CORRECTED LINE ===========
      // =================================================================
      emails: formData.get("emails"), // Changed from "email" to "emails"
    };

    try {
      // Send data to the server
      const res = await fetch("/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const result = await res.json();

      if (res.ok) {
        // We can't use alert() because it might be blocked. A console log is safer for now.
        console.log(`✅ Interview scheduled successfully! Response:`, result.message);
        
        // Redirect back to the HR dashboard
        window.location.href = "/HR_Dashboard.html";
      } else {
        // Use console.error for errors
        console.error(`❌ Error: ${result.message || "Something went wrong"}`);
        alert(`❌ Error: ${result.message || "Something went wrong"}`);
      }
    } catch (err) {
      console.error("❌ Critical Error: Failed to schedule interview:", err);
      alert("❌ Failed to schedule interview. Check the console for details.");
    }
  });
});
