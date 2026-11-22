const argon2 = require('argon2');
const { Client } = require('pg');

async function resetPassword() {
  const newPassword = 'Admin123!';
  const hash = await argon2.hash(newPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
  console.log('Generated hash OK');

  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'skynode_control',
    user: 'postgres',
    password: 'postgres_dev_password',
  });
  await client.connect();

  // Check existing user
  const res = await client.query(
    `SELECT id, email, name, role, "failedLogins", "lockedUntil" FROM platform_users WHERE email = $1`,
    ['admin@skynode.dev']
  );

  if (res.rows.length === 0) {
    console.log('No user found with admin@skynode.dev');
  } else {
    console.log('User found:', JSON.stringify(res.rows[0]));

    // Reset password, unlock account, clear failed logins
    await client.query(
      `UPDATE platform_users SET "passwordHash" = $1, "failedLogins" = 0, "lockedUntil" = NULL WHERE email = $2`,
      [hash, 'admin@skynode.dev']
    );
    console.log('Password reset to:', newPassword);
  }

  await client.end();
}

resetPassword().catch((e) => console.error('Error:', e.message));
