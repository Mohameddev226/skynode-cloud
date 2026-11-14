// ============================================================
// @skynode/sdk — SkyNode Cloud Client SDK (Skeleton)
// Full implementation in Phase 6
// ============================================================

export interface SkyNodeClientOptions {
  url: string;
  publishableKey: string;
}

export function createClient(url: string, publishableKey: string) {
  return new SkyNodeClient({ url, publishableKey });
}

class SkyNodeClient {
  private readonly url: string;
  private readonly key: string;

  constructor(options: SkyNodeClientOptions) {
    this.url = options.url.replace(/\/$/, '');
    this.key = options.publishableKey;
  }

  get baseUrl() {
    return this.url;
  }

  // Placeholder methods — implemented in Phase 6
  get db() {
    return {
      from: (table: string) => ({
        select: () => Promise.resolve({ data: [], error: null }),
        insert: (_data: unknown) => Promise.resolve({ data: null, error: null }),
        update: (_data: unknown) => Promise.resolve({ data: null, error: null }),
        delete: () => Promise.resolve({ data: null, error: null }),
      }),
    };
  }

  get auth() {
    return {
      signUp: (_credentials: { email: string; password: string }) =>
        Promise.resolve({ data: null, error: null }),
      signIn: (_credentials: { email: string; password: string }) =>
        Promise.resolve({ data: null, error: null }),
      signOut: () => Promise.resolve({ error: null }),
      getSession: () => Promise.resolve({ data: null, error: null }),
    };
  }

  get storage() {
    return {
      from: (bucket: string) => ({
        upload: (_path: string, _file: unknown) => Promise.resolve({ data: null, error: null }),
        download: (_path: string) => Promise.resolve({ data: null, error: null }),
        remove: (_paths: string[]) => Promise.resolve({ data: null, error: null }),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `${this.url}/storage/${bucket}/${path}` } }),
      }),
    };
  }
}

export default SkyNodeClient;
