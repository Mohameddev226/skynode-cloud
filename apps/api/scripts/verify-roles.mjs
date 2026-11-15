// Verify the anon/authenticated roles work in a project DB
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: 'localhost', port: 5432,
  database: 'skynode_proj_px30ee1cp7or',  // mohamed-ahmed project
  user: 'postgres', password: 'postgres_dev_password',
});
await client.connect();

// Test: Create a policy that references anon role (the failing query from screenshot)
await client.query(`CREATE TABLE IF NOT EXISTS public.test_rls (id TEXT PRIMARY KEY, data TEXT)`);
await client.query(`ALTER TABLE public.test_rls ENABLE ROW LEVEL SECURITY`);
await client.query(`DROP POLICY IF EXISTS "allow_anon_all_test_rls" ON public.test_rls`);
await client.query(`CREATE POLICY "allow_anon_all_test_rls" ON public.test_rls FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)`);

console.log('✅ Policy with "anon" and "authenticated" roles created successfully!');
console.log('The error "role anon does not exist" is now FIXED.');

await client.query(`DROP TABLE public.test_rls`);
await client.end();
