// This is a simple script to test the new endpoint for fetching candidates.

// 1. --- IMPORTANT ---
//    Replace this placeholder with a REAL 'interview_id' from your 'interviews' table in the database.
const INTERVIEW_ID_TO_TEST = 'e26a7b7f-f127-4e3e-8111-8d5e2f26a20c'; // <-- PUT A REAL ID HERE

// 2. This async function will call the API
async function testGetCandidatesApi() {
  console.log(`Fetching candidates for interview ID: ${INTERVIEW_ID_TO_TEST}`);

  try {
    const response = await fetch(`/api/interview/${INTERVIEW_ID_TO_TEST}/candidates`);
    
    // Check if the server responded with an error code (like 404 or 500)
    if (!response.ok) {
      const errorResult = await response.json();
      console.error(`❌ API Error: ${response.status} - ${errorResult.message}`);
      return;
    }

    // If the response is successful, parse the JSON
    const candidates = await response.json();

    console.log('✅ API Call Successful! Response:');
    console.table(candidates); // .table() provides a nice, clean output for arrays of objects

  } catch (error) {
    console.error('❌ Critical Error: Failed to fetch data. Is the server running?', error);
  }
}

// 3. Run the test function
testGetCandidatesApi();
