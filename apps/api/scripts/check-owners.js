const { Client } = require('pg');

async function checkOwners() {
  const c = new Client({
    host: 'localhost',
    port: 5432,
    database: 'skynode_control',
    user: 'postgres',
    password: 'postgres_dev_password',
  });
  await c.connect();
  const res = await c.query('SELECT name, slug, "ownerId" FROM projects');
  console.table(res.rows);
  await c.end();
}

checkOwners().catch(console.error);
