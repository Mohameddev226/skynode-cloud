const http = require('http');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  console.log('1. Logging in...');
  const loginRes = await request(
    {
      hostname: 'localhost',
      port: 4000,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    { email: 'admin@skynode.dev', password: 'Admin123!' }
  );
  console.log('Login status:', loginRes.status);
  const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0];
  if (!cookie) throw new Error('No cookie');

  console.log('2. Creating temporary test project...');
  const createRes = await request(
    {
      hostname: 'localhost',
      port: 4000,
      path: '/api/v1/projects',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
    },
    { name: 'Temp Delete Project', description: 'Testing deletion' }
  );
  console.log('Create status:', createRes.status);
  const proj = createRes.body?.data;
  console.log('Created project slug:', proj?.slug, 'ref:', proj?.ref);

  if (!proj?.slug) throw new Error('Project not created');

  console.log('3. Deleting project via DELETE /api/v1/projects/' + proj.slug);
  const delRes = await request({
    hostname: 'localhost',
    port: 4000,
    path: `/api/v1/projects/${proj.slug}`,
    method: 'DELETE',
    headers: { Cookie: cookie },
  });
  console.log('Delete status:', delRes.status);
  console.log('Delete response:', delRes.body);

  console.log('4. Verifying project is gone...');
  const getRes = await request({
    hostname: 'localhost',
    port: 4000,
    path: `/api/v1/projects/${proj.slug}`,
    method: 'GET',
    headers: { Cookie: cookie },
  });
  console.log('Get status after delete (expect 404):', getRes.status);

  if (delRes.status === 200 && getRes.status === 404) {
    console.log('SUCCESS: Project creation and deletion verified 100%!');
  } else {
    console.error('FAILURE: Unexpected status code');
  }
}

run().catch(console.error);
