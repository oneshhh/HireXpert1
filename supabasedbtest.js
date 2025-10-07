async function getSupabaseData() {
  const projectUrl = 'https://mytoggimxxnqlirfvtci.supabase.co';
  const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15dG9nZ2lteHhucWxpcmZ2dGNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc0MTI0NTksImV4cCI6MjA3Mjk4ODQ1OX0.dgpNz1A05TSHWmF15cYUMBw9_d_DHospZgSVA4dxtUI';
  const tableName = 'answers'; 

  // The URL now includes the '?select=*' parameter
  const apiUrl = `${projectUrl}/rest/v1/${tableName}?select=*`;

  const headers = {
    'apikey': anonKey,
    'Authorization': `Bearer ${anonKey}`,
  };

  try {
    console.log(`Fetching data from: ${apiUrl}`);
    const response = await fetch(apiUrl, { headers });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} - ${await response.text()}`);
    }

    const data = await response.json();
    console.log('✅ Success! Full Data Received:');
    console.log(JSON.stringify(data, null, 2)); // Using JSON.stringify for pretty printing

  } catch (error) {
    console.error('❌ Failed to fetch data:', error);
  }
}

getSupabaseData();
