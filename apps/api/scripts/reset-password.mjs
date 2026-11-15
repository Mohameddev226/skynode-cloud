import argon2 from 'argon2';
import pg from 'pg';

const { Client } = pg;

const hash = await argon2.hash('SkyNode123!', {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
});

console.log('Hash:', hash);

const client = new Client({
  connectionString: 'postgresql://skynode_api:skynode_api_dev_password@localhost:5432/skynode_control',
});

await client.connect();
const res = await client.query(
  'UPDATE platform_users SET "passwordHash" = $1 WHERE email = $2 RETURNING email',
  [hash, 'admin@skynode.dev']
);
console.log('Updated:', res.rows);
await client.end();
