/**
 * Create Supabase-compatible global PostgreSQL roles:
 *   anon, authenticated, service_role, supabase_admin
 * 
 * These are cluster-level roles that Supabase pre-creates.
 * Without them, SQL like `GRANT SELECT TO anon` or 
 * `CREATE POLICY ... TO anon` fails with "role does not exist".
 * 
 * Also grants these roles into every project database.
 */
import pg from 'pg';
const { Client } = pg;

const superClient = new Client({
  connectionString: 'postgresql://postgres:postgres_dev_password@localhost:5432/postgres',
});
await superClient.connect();

const GLOBAL_ROLES = [
  { name: 'anon',           login: false, bypassRls: false },
  { name: 'authenticated',  login: false, bypassRls: false },
  { name: 'service_role',   login: false, bypassRls: true  },
  { name: 'supabase_admin', login: false, bypassRls: false },
];

console.log('Creating global Supabase-compatible roles...\n');

for (const role of GLOBAL_ROLES) {
  const exists = await superClient.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role.name]);
  if (exists.rowCount === 0) {
    const bypassStr = role.bypassRls ? 'BYPASSRLS' : '';
    await superClient.query(`CREATE ROLE "${role.name}" NOLOGIN NOINHERIT ${bypassStr}`);
    console.log(`  ✓ Created: ${role.name}`);
  } else {
    console.log(`  ✓ Already exists: ${role.name}`);
  }
}

// Now grant these roles into every project database
const controlClient = new Client({
  connectionString: 'postgresql://skynode_api:skynode_api_dev_password@localhost:5432/skynode_control',
});
await controlClient.connect();

const { rows: projects } = await controlClient.query(
  'SELECT name, slug, "dbName" FROM projects'
);

console.log(`\nGranting roles to ${projects.length} project database(s)...\n`);

for (const project of projects) {
  const { name, dbName } = project;
  try {
    const projClient = new Client({
      host: 'localhost', port: 5432,
      database: dbName, user: 'postgres', password: 'postgres_dev_password',
    });
    await projClient.connect();

    // Grant usage on public schema to global anon/authenticated roles
    await projClient.query(`GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role`);
    await projClient.query(`GRANT ALL ON SCHEMA public TO service_role`);
    
    // Allow anon to SELECT from all existing tables
    await projClient.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon`);
    // Allow authenticated full CRUD
    await projClient.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated`);
    // Allow service_role everything
    await projClient.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role`);
    await projClient.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role`);

    // Default privileges for future tables
    await projClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon`);
    await projClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated`);
    await projClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role`);
    await projClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role`);

    await projClient.end();
    console.log(`  ✓ ${name} (${dbName})`);
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

await controlClient.end();
await superClient.end();

console.log('\n✅ Global roles created and granted to all project databases!');
console.log('\nSQL like this will now work:');
console.log('  GRANT SELECT ON TABLE foo TO anon;');
console.log('  CREATE POLICY "allow_anon" ON public.foo FOR SELECT TO anon USING (true);');
