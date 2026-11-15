import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'skynode_proj_px30ee1cp7or',
  user: 'postgres',
  password: 'postgres_dev_password',
});

await client.connect();

// Insert schools
const school1 = '39d9af82-6fb6-4100-8000-000000000001';
const school2 = 'e2651e61-4864-4100-8000-000000000002';

await client.query(`
  INSERT INTO schools (id, name, slug, city, country)
  VALUES 
    ($1, 'Al-Nour Academy', 'al-nour', 'Mogadishu', 'Somalia'),
    ($2, 'Banadir Primary School', 'banadir', 'Mogadishu', 'Somalia')
  ON CONFLICT (id) DO NOTHING;
`, [school1, school2]);

// Insert students matching Supabase screenshot
const students = [
  { id: '08e00c58-1d46-40fe-afc7-e21785000001', school_id: school1, admission_number: 'ALN-2026-0104', full_name: 'xusen cusman' },
  { id: '0b82fe1a-ee56-410c-b7bf-6120ae000002', school_id: school1, admission_number: 'ALN-2026-0103', full_name: 'Khaalid omar' },
  { id: '1459c64d-4572-4b90-961f-58b240000003', school_id: school2, admission_number: 'ALN-2026-0104', full_name: 'sahro ali' },
  { id: '1f64178e-2b6b-45b0-9328-18c1b5000004', school_id: school2, admission_number: 'ALN-2026-0102', full_name: 'Mohamed Ahmed' },
  { id: '3d24feeb-0505-419a-8790-22a850000005', school_id: school1, admission_number: 'ALN-2026-0104', full_name: 'xaliimo ahmed' },
  { id: '56a01d3d-8f57-41dd-a028-918bc0000006', school_id: school2, admission_number: 'ALN-2026-0106', full_name: 'sacdiyo aadan cabdi' },
  { id: '667b569d-8d1b-4472-96a7-d21290000007', school_id: school1, admission_number: 'ALN-2026-0102', full_name: 'hasan ali' },
  { id: '765cd92d-54e3-47e8-8300-2f6fb0000008', school_id: school2, admission_number: 'ALN-2026-0105', full_name: 'yacqub omar' },
  { id: '854cc4bd-129f-4856-a13f-15af11200009', school_id: school1, admission_number: 'ALN-2026-0101', full_name: 'mohamed ahmed' },
  { id: '8e9b17e4-ebc2-49a0-9ed9-bfb950000010', school_id: school2, admission_number: 'ALN-2026-0103', full_name: 'Ahmed Ali hassan' },
  { id: '9a1c23f1-fb34-40e1-897b-cf12a0000011', school_id: school1, admission_number: 'ALN-2026-0107', full_name: 'faadumo cismaan' },
];

for (const s of students) {
  await client.query(`
    INSERT INTO students (id, school_id, admission_number, full_name, status, attendance_rate, academic_average)
    VALUES ($1, $2, $3, $4, 'active', 98.50, 85.00)
    ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
  `, [s.id, s.school_id, s.admission_number, s.full_name]);
}

const countRes = await client.query('SELECT count(*) FROM students');
console.log(`Seeded students: ${countRes.rows[0].count} rows!`);

await client.end();
