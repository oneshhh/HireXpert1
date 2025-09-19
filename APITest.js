

const API_URL = "https://hirexpert-1ecv.onrender.com/api/interviews";

async function testAPI() {
  try {
    const res = await fetch(API_URL);
    const data = await res.json();
    console.log("✅ API Response:");
    console.log(data);
  } catch (err) {
    console.error("❌ Error fetching API:", err);
  }
}

testAPI();
