import { Command } from 'commander';
import { createInterface } from 'readline/promises';
import { apiRequest, saveConfig, loadConfig } from '../lib/api-client';

export const loginCommand = new Command('login')
  .description('Authenticate with SkyNode Cloud')
  .option('-e, --email <email>', 'Email address')
  .action(async (opts) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    const email = opts.email || await rl.question('Email: ');
    const password = await rl.question('Password: ');
    rl.close();

    console.log('\nAuthenticating...');
    const res = await apiRequest('POST', '/auth/login', { email, password });

    if (!res.ok) {
      console.error(`✗ Login failed: ${res.error}`);
      process.exit(1);
    }

    const config = loadConfig();
    config.sessionToken = res.data?.token;
    config.email = email;
    saveConfig(config);

    console.log(`✓ Logged in as ${email}`);
  });

export const logoutCommand = new Command('logout')
  .description('Log out and clear session')
  .action(async () => {
    const config = loadConfig();
    if (config.sessionToken) {
      await apiRequest('POST', '/auth/logout');
    }
    config.sessionToken = undefined;
    config.email = undefined;
    saveConfig(config);
    console.log('✓ Logged out');
  });

export const whoamiCommand = new Command('whoami')
  .description('Show current authenticated user')
  .action(async () => {
    const config = loadConfig();
    if (!config.sessionToken) {
      console.log('Not logged in. Run: skynode login');
      process.exit(1);
    }

    const res = await apiRequest('GET', '/auth/profile');
    if (!res.ok) {
      console.error('Session expired. Run: skynode login');
      process.exit(1);
    }

    console.log(`Email:  ${res.data.email}`);
    console.log(`Name:   ${res.data.fullName}`);
    console.log(`Role:   ${res.data.role}`);
  });
