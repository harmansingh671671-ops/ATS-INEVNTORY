const fs = require('fs');

async function test() {
  const envText = fs.readFileSync('.env', 'utf8');
  let url = '', key = '';
  envText.split('\n').forEach(line => {
    if (line.startsWith('SUPABASE_URL=')) url = line.split('=')[1].trim();
    if (line.startsWith('SUPABASE_ANON_KEY=')) key = line.split('=')[1].trim();
  });

  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

  console.log("Checking tables...");
  for (const table of ['items', 'requests', 'loans', 'profiles', 'inventory_logs', 'inventory_log']) {
    try {
      const res = await fetch(`${url}/rest/v1/${table}?select=*`, { headers });
      console.log(`Table '${table}': status = ${res.status}`);
      if (res.ok) {
        const data = await res.json();
        console.log(`  Count: ${data.length}`);
        if (data.length > 0) {
          console.log(`  Sample row:`, data[0]);
        }
      } else {
        const txt = await res.text();
        console.log(`  Error:`, txt);
      }
    } catch (e) {
      console.log(`Table '${table}' fetch error:`, e.message);
    }
  }
}

test();

