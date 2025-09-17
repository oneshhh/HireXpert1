document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("scheduleForm");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    // Collect form data
    const formData = new FormData(form);
    const data = {
      title: formData.get("title"),
      questions: formData.getAll("questions[]"),
      date: formData.get("date"),
      time: formData.get("time"),
      email: formData.get("email"),
    };

    try {
      // Send data to server
      const res = await fetch("/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const result = await res.json();

      if (res.ok) {
        alert(`✅ Interview scheduled successfully!\nEmail sent to ${data.email}`);
        
        // 👉 redirect back to the HR dashboard (or interviews page)
        window.location.href = "/HR_Dashboard.html";
      } else {
        alert(`❌ Error: ${result.message || "Something went wrong"}`);
      }
    } catch (err) {
      console.error("Error scheduling interview:", err);
      alert("❌ Failed to schedule interview. Please try again.");
    }
  });
});
