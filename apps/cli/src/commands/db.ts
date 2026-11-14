import { Command } from 'commander';
import { apiRequest } from '../lib/api-client';

export const dbCommand = new Command('db')
  .description('Database management commands');

dbCommand
  .command('config <project>')
  .description('Show database connection details for a project')
  .action(async (project) => {
    const res = await apiRequest('GET', `/projects/${project}/database/config`);
    if (!res.ok) {
      console.error(`✗ ${res.error}`);
      process.exit(1);
    }

    const c = res.data;
    console.log(`\n  Host:     ${c.host}`);
    console.log(`  Port:     ${c.port}`);
    console.log(`  Database: ${c.database}`);
    console.log(`  User:     ${c.user}`);
    console.log(`  Password: ${c.password}`);
    console.log(`\n  URI: ${c.connectionUri}\n`);
  });

dbCommand
  .command('tables <project>')
  .description('List tables in a project database')
  .action(async (project) => {
    const res = await apiRequest('GET', `/projects/${project}/database/tables`);
    if (!res.ok) {
      console.error(`✗ ${res.error}`);
      process.exit(1);
    }

    const tables = res.data ?? [];
    if (tables.length === 0) {
      console.log('No tables found.');
      return;
    }

    console.log(`\n  ${'TABLE'.padEnd(30)} ${'SCHEMA'.padEnd(15)} ROWS`);
    console.log('  ' + '─'.repeat(55));
    for (const t of tables) {
      console.log(`  ${t.name.padEnd(30)} ${(t.schema ?? 'public').padEnd(15)} ${t.estimatedRows ?? '?'}`);
    }
    console.log(`\n  ${tables.length} table(s)\n`);
  });

dbCommand
  .command('sql <project> <query>')
  .description('Execute SQL against a project database')
  .action(async (project, query) => {
    const res = await apiRequest('POST', `/projects/${project}/database/sql`, { sql: query });
    if (!res.ok) {
      console.error(`✗ ${res.error}`);
      process.exit(1);
    }

    const { rows, rowCount, fields } = res.data;
    if (!rows || rows.length === 0) {
      console.log(`Query OK. ${rowCount ?? 0} row(s) affected.`);
      return;
    }

    // Simple table output
    const cols = fields ?? Object.keys(rows[0]);
    const widths = cols.map((c: string) =>
      Math.max(c.length, ...rows.map((r: any) => String(r[c] ?? '').length)),
    );

    const header = cols.map((c: string, i: number) => c.padEnd(widths[i])).join(' | ');
    console.log(`\n  ${header}`);
    console.log('  ' + widths.map((w: number) => '─'.repeat(w)).join('─┼─'));
    for (const row of rows) {
      const line = cols.map((c: string, i: number) => String(row[c] ?? '').padEnd(widths[i])).join(' | ');
      console.log(`  ${line}`);
    }
    console.log(`\n  ${rows.length} row(s)\n`);
  });
