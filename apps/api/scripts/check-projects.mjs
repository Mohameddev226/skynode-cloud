import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://skynode_api:skynode_api_dev_password@localhost:5432/skynode_control',
});

await client.connect();
const res = await client.query(
  `SELECT name, slug, "dbHost", "dbPort", "dbName", "dbUser", "dbPasswordEnc" FROM projects`
);
console.log('Projects:', JSON.stringify(res.rows, null, 2));
await client.end();
