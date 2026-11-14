#!/usr/bin/env node

import { Command } from 'commander';

const program = new Command();

program
  .name('skynode')
  .description('SkyNode Cloud CLI — Control Plane and Database Management')
  .version('0.1.0');

program
  .command('status')
  .description('Check SkyNode Cloud platform status')
  .action(() => {
    console.log('SkyNode Cloud CLI v0.1.0');
    console.log('Platform status: Ready (Phase 1 initialized)');
  });

program.parse(process.argv);
