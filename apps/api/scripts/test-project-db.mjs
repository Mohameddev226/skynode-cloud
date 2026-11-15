import pg from 'pg';
const { Client } = pg;

// Test connecting to the mohamed-ahmed project DB and running a query
// First decrypt its password
import { createDecipheriv } from 'crypto';

const ENCRYPTION_KEY = 'a7f3c8e2b1d94f6a3c8e2b1d94f6a3c8e2b1d94f6a3c8e2b1d94f6a3c8e2b1d0';
const dbPasswordEnc = '9f983c7a19b61b7dce9d91d3e99b1c47:b09eb3c44a8eb0f48001ddaf1ea150cd:20943cee88debc105c2ae550922ad7462fd4622c1b0c595d2759a1f97f437a8e';

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

const password = decrypt(dbPasswordEnc);
console.log('Password decrypted OK');

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'skynode_proj_px30ee1cp7or',
  user: 'proj_px30ee1cp7or_admin',
  password,
});

await client.connect();
console.log('Connected to project DB!');

const res = await client.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' LIMIT 10
`);
console.log('Tables:', res.rows.length === 0 ? '(empty - no tables yet)' : res.rows.map(r => r.table_name).join(', '));

// Try the CREATE TABLE query from the user's screenshot
const createRes = await client.query(`
  CREATE TABLE IF NOT EXISTS public.schools (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT, logo TEXT, city TEXT DEFAULT 'Mogadishu',
    country TEXT DEFAULT 'Somalia', curriculum TEXT DEFAULT 'Somali National Curriculum',
    principal_name TEXT DEFAULT 'Principal', email TEXT, phone TEXT, address TEXT,
    academic_year TEXT DEFAULT '2025/2026', current_term TEXT DEFAULT 'Term 2',
    student_count INT DEFAULT 0, teacher_count INT DEFAULT 0, subscription_plan TEXT DEFAULT 'professional',
    subscription_status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW()
  )
`);
console.log('CREATE TABLE schools: OK');

await client.end();
console.log('✅ Project DB test passed!');
