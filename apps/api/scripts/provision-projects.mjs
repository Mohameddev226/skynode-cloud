import pg from 'pg';
import { createDecipheriv } from 'crypto';

const { Client } = pg;

const ENCRYPTION_KEY = 'a7f3c8e2b1d94f6a3c8e2b1d94f6a3c8e2b1d94f6a3c8e2b1d94f6a3c8e2b1d0';

function decrypt(encryptedHex) {
  const [ivHex, authTagHex, ciphertextHex] = encryptedHex.split(':');
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

const controlClient = new Client({
  connectionString: 'postgresql://skynode_api:skynode_api_dev_password@localhost:5432/skynode_control',
});
const superClient = new Client({
  connectionString: 'postgresql://postgres:postgres_dev_password@localhost:5432/postgres',
});

await controlClient.connect();
await superClient.connect();

const { rows: projects } = await controlClient.query(
  `SELECT id, name, slug, ref, "dbName", "dbUser", "dbPasswordEnc" FROM projects`
);

console.log(`Found ${projects.length} projects to provision...\n`);

for (const project of projects) {
  const { name, slug, ref, dbName, dbUser, dbPasswordEnc } = project;
  let dbPassword;
  try {
    dbPassword = decrypt(dbPasswordEnc);
  } catch (err) {
    console.error(`  ❌ ${name}: Failed to decrypt password: ${err.message}`);
    continue;
  }

  // Derive the 3 role names
  const adminRole  = dbUser;                      // proj_<ref>_admin
  const authRole   = `proj_${ref}_authenticated`;
  const anonRole   = `proj_${ref}_anon`;

  console.log(`Provisioning: ${name} (${slug})`);

  try {
    // Create roles
    for (const [role, login, pw] of [
      [adminRole, true,  dbPassword],
      [authRole,  false, null],
      [anonRole,  false, null],
    ]) {
      const exists = await superClient.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [role]);
      if (exists.rowCount === 0) {
        if (login) {
          await superClient.query(`CREATE ROLE "${role}" WITH LOGIN PASSWORD '${pw.replace(/'/g,"''")}'`);
        } else {
          await superClient.query(`CREATE ROLE "${role}" NOLOGIN`);
        }
        console.log(`  ✓ Created role: ${role}`);
      } else {
        if (login) {
          await superClient.query(`ALTER ROLE "${role}" WITH PASSWORD '${pw.replace(/'/g,"''")}'`);
        }
        console.log(`  ✓ Role exists: ${role}`);
      }
    }

    // Create database
    const dbExists = await superClient.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
    if (dbExists.rowCount === 0) {
      await superClient.query(`CREATE DATABASE "${dbName}" OWNER "${adminRole}"`);
      console.log(`  ✓ Created database: ${dbName}`);
    } else {
      console.log(`  ✓ Database exists: ${dbName}`);
    }

    await superClient.query(`GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "${adminRole}"`);

    // Connect to project DB and set up schemas + grants
    const projClient = new Client({
      host: 'localhost', port: 5432,
      database: dbName, user: 'postgres', password: 'postgres_dev_password',
    });
    await projClient.connect();

    // Extensions
    for (const ext of ['uuid-ossp', 'pgcrypto']) {
      await projClient.query(`CREATE EXTENSION IF NOT EXISTS "${ext}"`).catch(() => {});
    }

    // Schemas
    for (const schema of ['public', 'auth', 'storage']) {
      await projClient.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    }

    // Admin grants
    await projClient.query(`GRANT ALL ON SCHEMA public, auth, storage TO "${adminRole}"`);
    await projClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public, auth, storage GRANT ALL ON TABLES TO "${adminRole}"`);
    await projClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public, auth, storage GRANT ALL ON SEQUENCES TO "${adminRole}"`);

    // Authenticated & anon grants
    await projClient.query(`GRANT USAGE ON SCHEMA public TO "${authRole}", "${anonRole}"`);
    await projClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${authRole}"`);
    await projClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO "${anonRole}"`);

    await projClient.end();
    console.log(`  ✓ Schemas & grants applied`);

    // Mark active
    await controlClient.query(`UPDATE projects SET status = 'ACTIVE' WHERE slug = $1`, [slug]);
    console.log(`  ✓ Status → ACTIVE\n`);

  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}\n`);
  }
}

await controlClient.end();
await superClient.end();
console.log('✅ Provisioning complete!');
