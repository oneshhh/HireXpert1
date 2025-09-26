// This is a simple script to test the new endpoint for fetching candidates.

// =================================================================
// =========== THIS IS THE CORRECTED SECTION ===========
// =================================================================

// 1. --- CONFIGURE YOUR SERVER'S BASE URL ---
//    Uncomment the line for the server you are testing against.

// For your local development server:

// For your live server on Render:
 const BASE_URL = 'https://hirexpert-1ecv.onrender.com';

// 2. --- IMPORTANT ---
//    Replace this placeholder with a REAL 'interview_id' from your 'interviews' table.
const INTERVIEW_ID_TO_TEST = 'e26a7b7f-f127-4e3e-8111-8d5e2f26a20c'; // <-- PUT A REAL ID HERE

// 3. This async function will now call the API using the full URL
async function testGetCandidatesApi() {
  const fullApiUrl = `${BASE_URL}/api/interview/${INTERVIEW_ID_TO_TEST}/candidates`;
  console.log(`Fetching from full URL: ${fullApiUrl}`);

  try {
    // The fetch call now uses the complete URL
    const response = await fetch(fullApiUrl);
    
    // Check if the server responded with an error code (like 404 or 500)
    if (!response.ok) {
      const errorResult = await response.json();
      console.error(`❌ API Error: ${response.status} - ${errorResult.message}`);
      return;
    }

    // If the response is successful, parse the JSON
    const candidates = await response.json();

    console.log('✅ API Call Successful! Response:');
    console.table(candidates);

  } catch (error) {
    console.error('❌ Critical Error: Failed to fetch data. Is the server running and accessible?', error.cause || error);
  }
}

// 4. Run the test function
testGetCandidatesApi();

