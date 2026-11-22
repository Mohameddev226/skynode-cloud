const { Client } = require('pg');
const c = new Client({
  host: 'localhost',
  port: 5432,
  database: 'skynode_control',
  user: 'postgres',
  password: 'postgres_dev_password',
});

async function main() {
  await c.connect();
  const res = await c.query(`
    SELECT
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      rc.delete_rule
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    JOIN information_schema.referential_constraints AS rc
      ON rc.constraint_name = tc.constraint_name
    WHERE ccu.table_name = 'projects';
  `);
  console.log('FK Constraints referencing projects:');
  console.log(res.rows);

  const projects = await c.query(`SELECT id, name, slug, ref, status, "ownerId" FROM projects;`);
  console.log('Existing projects:');
  console.log(projects.rows);

  await c.end();
}

main().catch(console.error);
