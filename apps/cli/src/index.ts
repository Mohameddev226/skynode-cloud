#!/usr/bin/env node

import { Command } from 'commander';
import { loginCommand, logoutCommand, whoamiCommand } from './commands/login';
import { projectsCommand } from './commands/projects';
import { dbCommand } from './commands/db';
import { loadConfig, saveConfig } from './lib/api-client';

const program = new Command();

program
  .name('skynode')
  .description('SkyNode Cloud CLI — Control Plane and Database Management')
  .version('0.1.0');

// Config command
program
  .command('config')
  .description('Show or set CLI configuration')
  .option('--api-url <url>', 'Set the API base URL')
  .action((opts) => {
    const config = loadConfig();
    if (opts.apiUrl) {
      config.apiUrl = opts.apiUrl;
      saveConfig(config);
      console.log(`✓ API URL set to ${opts.apiUrl}`);
    } else {
      console.log(`\n  API URL: ${config.apiUrl}`);
      console.log(`  Email:   ${config.email ?? '(not logged in)'}\n`);
    }
  });

// Auth commands
program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(whoamiCommand);

// Resource commands
program.addCommand(projectsCommand);
program.addCommand(dbCommand);

// Status
program
  .command('status')
  .description('Check SkyNode Cloud platform status')
  .action(async () => {
    const { apiRequest } = await import('./lib/api-client');
    const res = await apiRequest('GET', '/health');
    if (!res.ok) {
      console.error(`✗ Cannot reach API: ${res.error}`);
      process.exit(1);
    }

    const h = res.data;
    console.log(`\n  SkyNode Cloud ${h.version}`);
    console.log(`  Status: ${h.status}`);
    console.log(`  Uptime: ${h.uptime}s`);
    console.log(`\n  Database: ${h.services?.database?.status ?? 'unknown'}`);
    console.log(`  Redis:    ${h.services?.redis?.status ?? 'unknown'}`);
    console.log(`  MinIO:    ${h.services?.minio?.status ?? 'unknown'}\n`);
  });

program.parse(process.argv);
