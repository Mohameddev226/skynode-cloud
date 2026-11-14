import { Command } from 'commander';
import { apiRequest } from '../lib/api-client';

export const projectsCommand = new Command('projects')
  .description('Manage SkyNode Cloud projects');

projectsCommand
  .command('list')
  .alias('ls')
  .description('List all projects')
  .action(async () => {
    const res = await apiRequest('GET', '/projects');
    if (!res.ok) {
      console.error(`✗ ${res.error}`);
      process.exit(1);
    }

    const projects = res.data ?? [];
    if (projects.length === 0) {
      console.log('No projects yet. Create one with: skynode projects create <name>');
      return;
    }

    console.log(`\n  ${'NAME'.padEnd(25)} ${'SLUG'.padEnd(25)} ${'STATUS'.padEnd(10)} REF`);
    console.log('  ' + '─'.repeat(80));
    for (const p of projects) {
      console.log(`  ${p.name.padEnd(25)} ${p.slug.padEnd(25)} ${p.status.padEnd(10)} ${p.ref}`);
    }
    console.log(`\n  ${projects.length} project(s)\n`);
  });

projectsCommand
  .command('create <name>')
  .description('Create a new project')
  .option('-d, --description <desc>', 'Project description')
  .option('-r, --region <region>', 'Region', 'default')
  .action(async (name, opts) => {
    console.log(`Creating project "${name}"...`);
    const res = await apiRequest('POST', '/projects', {
      name,
      description: opts.description,
      region: opts.region,
    });

    if (!res.ok) {
      console.error(`✗ ${res.error}`);
      process.exit(1);
    }

    console.log(`✓ Project created`);
    console.log(`  Name: ${res.data.name}`);
    console.log(`  Slug: ${res.data.slug}`);
    console.log(`  Ref:  ${res.data.ref}`);
    if (res.data.anonKey) {
      console.log(`\n  Anon Key:    ${res.data.anonKey}`);
      console.log(`  Service Key: ${res.data.serviceKey}`);
      console.log('\n  ⚠  Save these keys now — the service key will not be shown again.');
    }
  });

projectsCommand
  .command('delete <identifier>')
  .description('Delete a project by slug, ref, or ID')
  .action(async (identifier) => {
    const res = await apiRequest('DELETE', `/projects/${identifier}`);
    if (!res.ok) {
      console.error(`✗ ${res.error}`);
      process.exit(1);
    }
    console.log(`✓ ${res.data?.message ?? 'Project deleted'}`);
  });

projectsCommand
  .command('info <identifier>')
  .description('Show project details')
  .action(async (identifier) => {
    const res = await apiRequest('GET', `/projects/${identifier}`);
    if (!res.ok) {
      console.error(`✗ ${res.error}`);
      process.exit(1);
    }

    const p = res.data;
    console.log(`\n  Project: ${p.name}`);
    console.log(`  Slug:    ${p.slug}`);
    console.log(`  Ref:     ${p.ref}`);
    console.log(`  Status:  ${p.status}`);
    console.log(`  Region:  ${p.region}`);
    console.log(`  DB:      ${p.databaseName}`);
    console.log(`  Created: ${new Date(p.createdAt).toLocaleDateString()}`);
    if (p.apiKeys?.length) {
      console.log(`\n  API Keys (${p.apiKeys.length}):`);
      for (const k of p.apiKeys) {
        console.log(`    - ${k.name} [${k.type}] ${k.keyPrefix}...`);
      }
    }
    console.log();
  });
