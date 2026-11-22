async function testFullFlow() {
  const loginRes = await fetch('http://localhost:4000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@skynode.dev', password: 'Admin123!' }),
  });

  console.log('1. Login status:', loginRes.status);
  const cookie = loginRes.headers.get('set-cookie');
  console.log('   Cookie:', cookie?.split(';')[0]);

  const headers = {
    Cookie: cookie || '',
    'Content-Type': 'application/json',
  };

  // 2. /auth/me
  const meRes = await fetch('http://localhost:4000/api/v1/auth/me', { headers });
  const meData = await meRes.json();
  console.log('2. /auth/me:', meRes.status, meData.data?.email, meData.data?.fullName);

  // 3. /projects
  const projRes = await fetch('http://localhost:4000/api/v1/projects', { headers });
  const projData = await projRes.json();
  console.log('3. /projects:', projRes.status, 'Count:', projData.data?.length);
  projData.data?.forEach(p => console.log(`   - ${p.name} (slug: ${p.slug}, ref: ${p.ref})`));

  // 4. /database/tables for mohamed-ahmed
  const tablesRes = await fetch('http://localhost:4000/api/v1/projects/mohamed-ahmed/database/tables', { headers });
  const tablesData = await tablesRes.json();
  console.log('4. /database/tables:', tablesRes.status, 'Tables count:', tablesData.data?.length);

  // 5. /records for students
  const recordsRes = await fetch('http://localhost:4000/api/v1/projects/mohamed-ahmed/database/tables/students/records', { headers });
  const recordsData = await recordsRes.json();
  console.log('5. /records (students):', recordsRes.status, 'Rows:', recordsData.data?.rows?.length, 'Total:', recordsData.data?.total);

  // 6. /policies for students (Phase 4 endpoint)
  const policiesRes = await fetch('http://localhost:4000/api/v1/projects/mohamed-ahmed/database/tables/students/policies', { headers });
  const policiesData = await policiesRes.json();
  console.log('6. /policies (students):', policiesRes.status, 'Policies:', policiesData.data?.length);

  // 7. REST Gateway (Phase 2 endpoint)
  const restRes = await fetch('http://localhost:4000/api/v1/projects/px30ee1cp7or/rest/v1/students?limit=2');
  const restData = await restRes.json();
  console.log('7. REST Gateway (/rest/v1/students):', restRes.status, 'Returned:', restData.data?.length);

  // 8. Health
  const healthRes = await fetch('http://localhost:4000/api/v1/health');
  const healthData = await healthRes.json();
  console.log('8. Health:', healthRes.status, healthData.data?.status, healthData.data?.services);
}

testFullFlow().catch(console.error);
