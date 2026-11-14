import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.skynode');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface SkyNodeConfig {
  apiUrl: string;
  sessionToken?: string;
  email?: string;
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): SkyNodeConfig {
  ensureConfigDir();
  if (!existsSync(CONFIG_FILE)) {
    return { apiUrl: 'http://localhost:4000' };
  }
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return { apiUrl: 'http://localhost:4000' };
  }
}

export function saveConfig(config: SkyNodeConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function apiRequest<T = any>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  const config = loadConfig();
  const url = `${config.apiUrl}/api/v1${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.sessionToken) {
    headers['Cookie'] = `session=${config.sessionToken}`;
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: json?.message ?? `HTTP ${res.status}`,
      };
    }
    return { ok: true, status: res.status, data: json?.data ?? json };
  } catch (err: any) {
    return { ok: false, status: 0, error: err.message };
  }
}
