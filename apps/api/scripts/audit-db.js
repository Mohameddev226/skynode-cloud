const { Client } = require('pg');

async function check() {
  const c = new Client({
    host: 'localhost',
    port: 5432,
    database: 'skynode_control',
    user: 'postgres',
    password: 'postgres_dev_password',
  });
  await c.connect();

  console.log('=== SKYNODE CONTROL DB AUDIT ===');

  const users = await c.query(
    'SELECT id, email, name, role, "createdAt" FROM platform_users'
  );
  console.log('\n--- Platform Users ---');
  console.table(users.rows);

  const projs = await c.query(
    'SELECT id, ref, slug, name, status, "dbName", "dbUser", "createdAt" FROM projects'
  );
  console.log('\n--- Projects ---');
  console.table(projs.rows);

  const apiKeys = await c.query(
    'SELECT id, "projectId", name, type, "keyPrefix", revoked, "createdAt" FROM api_keys'
  );
  console.log('\n--- API Keys ---');
  console.table(apiKeys.rows);

  // Check each project database
  for (const p of projs.rows) {
    console.log(`\n--- Inspecting Project DB: ${p.dbName} (${p.name}) ---`);
    const pc = new Client({
      host: 'localhost',
      port: 5432,
      database: p.dbName,
      user: 'postgres',
      password: 'postgres_dev_password',
    });
    try {
      await pc.connect();
      const tables = await pc.query(`
        SELECT table_schema, table_name 
        FROM information_schema.tables 
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name;
      `);
      console.log(`Tables in ${p.dbName}:`);
      console.table(tables.rows);
      await pc.end();
    } catch (err) {
      console.error(`Failed to connect to ${p.dbName}:`, err.message);
    }
  }

  await c.end();
}

check().catch(console.error);
