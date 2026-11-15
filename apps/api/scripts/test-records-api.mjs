// global fetch in Node 24

async function test() {
  const loginRes = await fetch('http://localhost:4000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@skynode.dev', password: 'SkyNode123!' }),
  });

  const cookie = loginRes.headers.get('set-cookie');
  console.log('Login cookie received:', !!cookie);

  const tablesRes = await fetch('http://localhost:4000/api/v1/projects/mohamed-ahmed/database/tables', {
    headers: { cookie: cookie || '' },
  });
  const tables = await tablesRes.json();
  console.log('Tables count:', tables.data?.length);

  const studentsRes = await fetch('http://localhost:4000/api/v1/projects/mohamed-ahmed/database/tables/students/records?schema=public&page=1&limit=100', {
    headers: { cookie: cookie || '' },
  });
  const students = await studentsRes.json();
  console.log('Students response:', JSON.stringify(students, null, 2));
}

test();
