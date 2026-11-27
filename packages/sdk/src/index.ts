// ============================================================================
// @skynode/sdk — SkyNode Cloud Universal Multi-Tenant Client SDK
// ============================================================================

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SkyNodeClientOptions {
  url: string;
  publishableKey: string;
  tenantId?: string | null;
  persistSession?: boolean;
  storage?: StorageAdapter;
  realtimeUrl?: string;
}

export interface SkyNodeError {
  message: string;
  statusCode?: number;
  error?: string;
  details?: unknown;
}

export interface SkyNodeResult<T> {
  data: T | null;
  error: SkyNodeError | null;
  count?: number;
}

export interface TenantMembership {
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  tenant_status: string;
  role_id: string;
  role_name: string;
  membership_status: string;
  custom_attributes: Record<string, unknown>;
  permissions: string[];
}

export interface AppUser {
  id: string;
  email: string;
  full_name: string | null;
  email_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  last_sign_in_at: string | null;
}

export interface AuthSessionResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number;
  user: AppUser;
  active_tenant: TenantMembership | null;
  tenants: TenantMembership[];
}

export function createClient(
  url: string,
  publishableKey: string,
  options?: Omit<SkyNodeClientOptions, 'url' | 'publishableKey'>,
): SkyNodeClient {
  return new SkyNodeClient({ url, publishableKey, ...options });
}

class QueryBuilder<T = Record<string, any>> implements PromiseLike<SkyNodeResult<T[]>> {
  private operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' = 'SELECT';
  private targetSchema = 'public';
  private selectCols = '*';
  private payloadBody: unknown = undefined;
  private readonly filters: Array<[string, string]> = [];
  private orderParam: string | undefined;
  private limitVal: number | undefined;
  private offsetVal: number | undefined;
  private isSingle = false;
  private isMaybeSingle = false;
  private overrideTenantId: string | null | undefined = undefined;

  constructor(
    private readonly client: SkyNodeClient,
    private readonly tableName: string,
  ) {}

  schema(schemaName: string): this {
    this.targetSchema = schemaName;
    return this;
  }

  tenant(tenantId: string | null): this {
    this.overrideTenantId = tenantId;
    return this;
  }

  select(columns = '*'): this {
    if (this.operation === 'SELECT') {
      this.selectCols = columns;
    }
    return this;
  }

  insert(payload: Record<string, any> | Record<string, any>[]): this {
    this.operation = 'INSERT';
    this.payloadBody = payload;
    return this;
  }

  update(data: Record<string, any>): this {
    this.operation = 'UPDATE';
    this.payloadBody = data;
    return this;
  }

  delete(): this {
    this.operation = 'DELETE';
    return this;
  }

  eq(column: string, value: string | number | boolean): this {
    this.filters.push([column, `eq.${value}`]);
    return this;
  }

  neq(column: string, value: string | number | boolean): this {
    this.filters.push([column, `neq.${value}`]);
    return this;
  }

  gt(column: string, value: string | number): this {
    this.filters.push([column, `gt.${value}`]);
    return this;
  }

  gte(column: string, value: string | number): this {
    this.filters.push([column, `gte.${value}`]);
    return this;
  }

  lt(column: string, value: string | number): this {
    this.filters.push([column, `lt.${value}`]);
    return this;
  }

  lte(column: string, value: string | number): this {
    this.filters.push([column, `lte.${value}`]);
    return this;
  }

  like(column: string, pattern: string): this {
    this.filters.push([column, `like.${pattern}`]);
    return this;
  }

  ilike(column: string, pattern: string): this {
    this.filters.push([column, `ilike.${pattern}`]);
    return this;
  }

  in(column: string, values: Array<string | number>): this {
    this.filters.push([column, `in.(${values.join(',')})`]);
    return this;
  }

  is(column: string, value: 'null' | 'not.null' | null): this {
    this.filters.push([column, value === 'not.null' ? 'is.not.null' : 'is.null']);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    const dir = options?.ascending === false ? 'desc' : 'asc';
    this.orderParam = `${column}.${dir}`;
    return this;
  }

  limit(count: number): this {
    this.limitVal = count;
    return this;
  }

  range(from: number, to: number): this {
    this.offsetVal = from;
    this.limitVal = Math.max(1, to - from + 1);
    return this;
  }

  single(): PromiseLike<SkyNodeResult<T>> {
    this.isSingle = true;
    return this as unknown as PromiseLike<SkyNodeResult<T>>;
  }

  maybeSingle(): PromiseLike<SkyNodeResult<T>> {
    this.isMaybeSingle = true;
    return this as unknown as PromiseLike<SkyNodeResult<T>>;
  }

  /**
   * Subscribe to realtime changes on this table scoped to the active tenant.
   */
  on(
    eventType: 'INSERT' | 'UPDATE' | 'DELETE' | '*',
    callback: (payload: {
      eventType: 'INSERT' | 'UPDATE' | 'DELETE';
      new: T;
      old: T | null;
      tenantId: string | null;
      table: string;
    }) => void,
  ) {
    return this.client.realtime.table(this.tableName, eventType, callback);
  }

  private async execute(): Promise<SkyNodeResult<any>> {
    const query = new URLSearchParams();
    if (this.targetSchema !== 'public') {
      query.set('schema', this.targetSchema);
    }

    if (this.operation === 'SELECT') {
      if (this.selectCols && this.selectCols !== '*') {
        query.set('select', this.selectCols.replace(/\s+/g, ''));
      }
      if (this.orderParam) query.set('order', this.orderParam);
      if (this.limitVal !== undefined) query.set('limit', String(this.limitVal));
      if (this.offsetVal !== undefined) query.set('offset', String(this.offsetVal));
    }

    for (const [col, expr] of this.filters) {
      query.set(col, expr);
    }

    const qs = query.toString();
    const path = `/rest/v1/${encodeURIComponent(this.tableName)}${qs ? `?${qs}` : ''}`;
    const headers: Record<string, string> = {};
    if (this.overrideTenantId !== undefined) {
      if (this.overrideTenantId) headers['X-Tenant-ID'] = this.overrideTenantId;
    }

    const method =
      this.operation === 'SELECT'
        ? 'GET'
        : this.operation === 'INSERT'
          ? 'POST'
          : this.operation === 'UPDATE'
            ? 'PATCH'
            : 'DELETE';

    const res = await this.client.request<any>(method, path, this.payloadBody, headers);
    if (res.error) return res;

    // Unwrap list pagination shape `{ data: [...], total, limit, offset }`
    let payloadData = res.data;
    let totalCount: number | undefined;
    if (
      this.operation === 'SELECT' &&
      payloadData &&
      !Array.isArray(payloadData) &&
      Array.isArray(payloadData.data)
    ) {
      totalCount = typeof payloadData.total === 'number' ? payloadData.total : undefined;
      payloadData = payloadData.data;
    }

    if (this.isSingle || this.isMaybeSingle) {
      const list = Array.isArray(payloadData) ? payloadData : payloadData ? [payloadData] : [];
      if (this.isSingle && list.length === 0) {
        return {
          data: null,
          error: { message: 'Record not found', statusCode: 404 },
        };
      }
      return { data: list[0] ?? null, error: null, count: totalCount };
    }

    return { data: payloadData, error: null, count: totalCount };
  }

  then<TResult1 = SkyNodeResult<T[]>, TResult2 = never>(
    onfulfilled?: ((value: SkyNodeResult<T[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export class SkyNodeRealtimeSubscription {
  private ws: WebSocket | null = null;
  private closedManually = false;

  constructor(
    private readonly client: SkyNodeClient,
    private readonly channel: string,
    private readonly eventType: 'INSERT' | 'UPDATE' | 'DELETE' | '*',
    private readonly callback: (payload: any) => void,
  ) {}

  subscribe(): this {
    this.closedManually = false;
    const wsUrl = this.client.getRealtimeUrl();
    const WsCtor = typeof WebSocket !== 'undefined' ? WebSocket : null;
    if (!WsCtor) {
      throw new Error('WebSocket implementation is not available in this runtime');
    }

    const params = new URLSearchParams();
    params.set('project', this.client.projectRef);
    params.set('apikey', this.client.publishableKey);
    const token = this.client.getAccessToken();
    if (token) params.set('token', token);
    const tenantId = this.client.getActiveTenantId();
    if (tenantId) params.set('tenant_id', tenantId);

    this.ws = new WsCtor(`${wsUrl}?${params.toString()}`);

    this.ws.addEventListener('open', () => {
      const targetChannel = this.resolveChannelName();
      this.ws?.send(JSON.stringify({ type: 'subscribe', channel: targetChannel }));
    });

    this.ws.addEventListener('message', (ev: any) => {
      try {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
        if (msg.type === 'event') {
          if (this.eventType === '*' || msg.eventType === this.eventType) {
            this.callback({
              eventType: msg.eventType,
              new: msg.record,
              old: msg.oldRecord ?? null,
              tenantId: msg.tenantId ?? null,
              table: msg.table,
            });
          }
        }
      } catch {
        // ignore malformed frames
      }
    });

    return this;
  }

  private resolveChannelName(): string {
    const tenantId = this.client.getActiveTenantId();
    if (this.channel.startsWith('project:')) return this.channel;
    if (tenantId) {
      return `project:${this.client.projectRef}:tenant:${tenantId}:table:${this.channel}`;
    }
    return `project:${this.client.projectRef}:table:${this.channel}`;
  }

  unsubscribe(): void {
    this.closedManually = true;
    if (this.ws) {
      try {
        const targetChannel = this.resolveChannelName();
        if (this.ws.readyState === 1) {
          this.ws.send(JSON.stringify({ type: 'unsubscribe', channel: targetChannel }));
        }
        this.ws.close();
      } catch {
        // ignore close error
      }
      this.ws = null;
    }
    void this.closedManually;
  }
}

export class SkyNodeClient {
  private readonly url: string;
  readonly publishableKey: string;
  readonly projectRef: string;
  private readonly realtimeBaseUrl: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private activeTenantId: string | null = null;
  private currentUser: AppUser | null = null;
  private storageAdapter: StorageAdapter | null = null;

  constructor(options: SkyNodeClientOptions) {
    // Normalize base project URL (supports passing .../rest or .../projects/:ref)
    const stripped = options.url.replace(/\/+$/, '').replace(/\/rest(\/v1)?$/, '');
    this.url = stripped;
    this.publishableKey = options.publishableKey;
    this.activeTenantId = options.tenantId ?? null;

    const parts = stripped.split('/');
    this.projectRef = parts[parts.length - 1] || '';

    if (options.realtimeUrl) {
      this.realtimeBaseUrl = options.realtimeUrl.replace(/\/+$/, '');
    } else {
      const originMatch = stripped.match(/^(https?:\/\/[^/]+)/i);
      const origin = originMatch?.[1] || stripped;
      const wsOrigin = origin.replace(/^http/i, 'ws');
      this.realtimeBaseUrl = `${wsOrigin}/realtime/v1`;
    }

    if (options.storage) {
      this.storageAdapter = options.storage;
    } else if (
      options.persistSession !== false &&
      typeof globalThis !== 'undefined' &&
      'localStorage' in globalThis &&
      globalThis.localStorage
    ) {
      this.storageAdapter = globalThis.localStorage;
    }

    this.restoreSession();
  }

  private get storageKey(): string {
    return `skynode.session.${this.projectRef}`;
  }

  private restoreSession() {
    if (!this.storageAdapter) return;
    try {
      const raw = this.storageAdapter.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      this.accessToken = parsed.access_token ?? null;
      this.refreshToken = parsed.refresh_token ?? null;
      this.currentUser = parsed.user ?? null;
      if (!this.activeTenantId && parsed.tenant_id) {
        this.activeTenantId = parsed.tenant_id;
      }
    } catch {
      // ignore corrupted storage
    }
  }

  private persistSession() {
    if (!this.storageAdapter) return;
    try {
      if (!this.accessToken) {
        this.storageAdapter.removeItem(this.storageKey);
        return;
      }
      this.storageAdapter.setItem(
        this.storageKey,
        JSON.stringify({
          access_token: this.accessToken,
          refresh_token: this.refreshToken,
          user: this.currentUser,
          tenant_id: this.activeTenantId,
        }),
      );
    } catch {
      // ignore storage quota errors
    }
  }

  get baseUrl() {
    return this.url;
  }

  getRealtimeUrl() {
    return this.realtimeBaseUrl;
  }

  getAccessToken() {
    return this.accessToken;
  }

  getActiveTenantId() {
    return this.activeTenantId;
  }

  setAccessToken(token: string | null) {
    this.accessToken = token;
    this.persistSession();
  }

  /**
   * Sets or switches active tenant context.
   * When signed in as an application user, calls the server to verify tenant membership and mint a tenant-scoped JWT.
   */
  async setTenant(tenantIdOrSlug: string | null): Promise<SkyNodeResult<AuthSessionResponse | null>> {
    if (!tenantIdOrSlug) {
      this.activeTenantId = null;
      this.persistSession();
      return { data: null, error: null };
    }

    if (this.accessToken && !this.publishableKey.startsWith('sky_service_role_')) {
      const res = await this.auth.switchTenant(tenantIdOrSlug);
      if (res.error) return res;
      return res;
    }

    this.activeTenantId = tenantIdOrSlug;
    this.persistSession();
    return { data: null, error: null };
  }

  async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<SkyNodeResult<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.publishableKey,
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    if (this.activeTenantId) {
      headers['X-Tenant-ID'] = this.activeTenantId;
    }
    if (extraHeaders) {
      Object.assign(headers, extraHeaders);
    }

    try {
      const response = await fetch(`${this.url}${path}`, {
        method,
        headers,
        body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined,
      });

      const text = await response.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!response.ok || (json && json.success === false)) {
        return {
          data: null,
          error: {
            message: json?.message || response.statusText || 'Request failed',
            statusCode: json?.statusCode ?? response.status,
            error: json?.error,
            details: json?.details,
          },
        };
      }

      // Unwrap TransformInterceptor envelope `{ success: true, data, statusCode }`
      const data =
        json && typeof json === 'object' && 'success' in json && 'data' in json
          ? json.data
          : json;

      return { data: data as T, error: null };
    } catch (err: any) {
      return {
        data: null,
        error: {
          message: err?.message || 'Network request failed',
        },
      };
    }
  }

  /**
   * Direct PostgREST table query builder (e.g. `skynode.from('students').select('*')`)
   */
  from<T = Record<string, any>>(tableName: string): QueryBuilder<T> {
    return new QueryBuilder<T>(this, tableName);
  }

  /**
   * Backward-compatible database namespace alias (`skynode.db.from(...)`)
   */
  get db() {
    return {
      from: <T = Record<string, any>>(tableName: string) => new QueryBuilder<T>(this, tableName),
    };
  }

  get auth() {
    return {
      signUp: async (credentials: {
        email: string;
        password: string;
        full_name?: string;
      }): Promise<SkyNodeResult<AuthSessionResponse>> => {
        const res = await this.request<AuthSessionResponse>('POST', '/auth/register', credentials);
        if (res.data) {
          this.accessToken = res.data.access_token;
          this.refreshToken = res.data.refresh_token;
          this.currentUser = res.data.user;
          this.activeTenantId = res.data.active_tenant?.tenant_id ?? this.activeTenantId;
          this.persistSession();
        }
        return res;
      },

      signIn: async (credentials: {
        email: string;
        password: string;
        tenant_id?: string;
      }): Promise<SkyNodeResult<AuthSessionResponse>> => {
        const res = await this.request<AuthSessionResponse>('POST', '/auth/login', credentials);
        if (res.data) {
          this.accessToken = res.data.access_token;
          this.refreshToken = res.data.refresh_token;
          this.currentUser = res.data.user;
          this.activeTenantId = res.data.active_tenant?.tenant_id ?? null;
          this.persistSession();
        }
        return res;
      },

      refreshSession: async (token?: string): Promise<SkyNodeResult<AuthSessionResponse>> => {
        const rt = token ?? this.refreshToken;
        if (!rt) {
          return { data: null, error: { message: 'No refresh token available', statusCode: 401 } };
        }
        const res = await this.request<AuthSessionResponse>('POST', '/auth/token/refresh', {
          refresh_token: rt,
        });
        if (res.data) {
          this.accessToken = res.data.access_token;
          this.refreshToken = res.data.refresh_token;
          this.currentUser = res.data.user;
          this.activeTenantId = res.data.active_tenant?.tenant_id ?? this.activeTenantId;
          this.persistSession();
        }
        return res;
      },

      signOut: async (): Promise<{ error: SkyNodeError | null }> => {
        const rt = this.refreshToken;
        this.accessToken = null;
        this.refreshToken = null;
        this.currentUser = null;
        this.activeTenantId = null;
        this.persistSession();

        if (rt) {
          const res = await this.request('POST', '/auth/logout', { refresh_token: rt });
          return { error: res.error };
        }
        return { error: null };
      },

      getSession: async () => ({
        data: this.accessToken
          ? {
              access_token: this.accessToken,
              refresh_token: this.refreshToken,
              user: this.currentUser,
              tenant_id: this.activeTenantId,
            }
          : null,
        error: null,
      }),

      getUser: () => this.request<AppUser & { tenants: TenantMembership[] }>('GET', '/auth/user'),

      updateUser: (data: { full_name?: string; email?: string }) =>
        this.request<AppUser>('PUT', '/auth/user', data),

      changePassword: (data: { current_password: string; new_password: string }) =>
        this.request('POST', '/auth/user/change-password', data),

      getUserTenants: () => this.request<TenantMembership[]>('GET', '/auth/tenants'),

      switchTenant: async (tenantIdOrSlug: string): Promise<SkyNodeResult<AuthSessionResponse>> => {
        const res = await this.request<AuthSessionResponse>('POST', '/auth/tenant/switch', {
          tenant_id: tenantIdOrSlug,
        });
        if (res.data) {
          this.accessToken = res.data.access_token;
          this.refreshToken = res.data.refresh_token;
          this.currentUser = res.data.user;
          this.activeTenantId = res.data.active_tenant?.tenant_id ?? tenantIdOrSlug;
          this.persistSession();
        }
        return res;
      },

      resetPasswordForEmail: (email: string) =>
        this.request<{ message: string; recovery_token?: string }>('POST', '/auth/recover', {
          email,
        }),

      resetPassword: (token: string, newPassword: string) =>
        this.request<{ message: string }>('POST', '/auth/reset-password', {
          token,
          new_password: newPassword,
        }),

      verifyEmail: (token: string) =>
        this.request<{ message: string }>('POST', '/auth/verify-email', { token }),
    };
  }

  get tenants() {
    return {
      create: (dto: {
        name: string;
        slug?: string;
        plan?: string;
        metadata?: Record<string, unknown>;
        owner_user_id?: string;
      }) => this.request('POST', '/tenants', dto),

      list: (params?: { page?: number; limit?: number; status?: string; search?: string }) => {
        const qs = new URLSearchParams();
        if (params?.page) qs.set('page', String(params.page));
        if (params?.limit) qs.set('limit', String(params.limit));
        if (params?.status) qs.set('status', params.status);
        if (params?.search) qs.set('search', params.search);
        const s = qs.toString();
        return this.request('GET', `/tenants${s ? `?${s}` : ''}`);
      },

      get: (tenantIdOrSlug: string) =>
        this.request('GET', `/tenants/${encodeURIComponent(tenantIdOrSlug)}`),

      update: (
        tenantIdOrSlug: string,
        dto: { name?: string; slug?: string; plan?: string; metadata?: Record<string, unknown> },
      ) => this.request('PATCH', `/tenants/${encodeURIComponent(tenantIdOrSlug)}`, dto),

      updateStatus: (tenantIdOrSlug: string, status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED') =>
        this.request('PATCH', `/tenants/${encodeURIComponent(tenantIdOrSlug)}/status`, { status }),

      delete: (tenantIdOrSlug: string) =>
        this.request('DELETE', `/tenants/${encodeURIComponent(tenantIdOrSlug)}`),

      listRoles: (tenantIdOrSlug?: string) =>
        this.request(
          'GET',
          tenantIdOrSlug ? `/tenants/${encodeURIComponent(tenantIdOrSlug)}/roles` : '/tenants/roles',
        ),

      createRole: (
        dto: {
          name: string;
          description?: string;
          permissions?: Array<{ resource: string; action: string }>;
        },
        tenantIdOrSlug?: string,
      ) =>
        this.request(
          'POST',
          tenantIdOrSlug ? `/tenants/${encodeURIComponent(tenantIdOrSlug)}/roles` : '/tenants/roles',
          dto,
        ),

      listMembers: (tenantIdOrSlug: string) =>
        this.request('GET', `/tenants/${encodeURIComponent(tenantIdOrSlug)}/members`),

      addMember: (
        tenantIdOrSlug: string,
        dto: {
          user_id?: string;
          email?: string;
          role_id?: string;
          role?: string;
          custom_attributes?: Record<string, unknown>;
        },
      ) => this.request('POST', `/tenants/${encodeURIComponent(tenantIdOrSlug)}/members`, dto),

      updateMember: (
        tenantIdOrSlug: string,
        userId: string,
        dto: {
          role_id?: string;
          role?: string;
          status?: 'ACTIVE' | 'SUSPENDED';
          custom_attributes?: Record<string, unknown>;
        },
      ) =>
        this.request(
          'PATCH',
          `/tenants/${encodeURIComponent(tenantIdOrSlug)}/members/${encodeURIComponent(userId)}`,
          dto,
        ),

      removeMember: (tenantIdOrSlug: string, userId: string) =>
        this.request(
          'DELETE',
          `/tenants/${encodeURIComponent(tenantIdOrSlug)}/members/${encodeURIComponent(userId)}`,
        ),

      invite: (
        tenantIdOrSlug: string,
        dto: {
          email: string;
          role_id?: string;
          role?: string;
          custom_attributes?: Record<string, unknown>;
        },
      ) =>
        this.request('POST', `/tenants/${encodeURIComponent(tenantIdOrSlug)}/invitations`, dto),

      listInvitations: (tenantIdOrSlug: string) =>
        this.request('GET', `/tenants/${encodeURIComponent(tenantIdOrSlug)}/invitations`),

      acceptInvitation: (token: string) =>
        this.request('POST', '/tenants/invitations/accept', { token }),
    };
  }

  get realtime() {
    return {
      table: <T = Record<string, any>>(
        tableName: string,
        eventType: 'INSERT' | 'UPDATE' | 'DELETE' | '*',
        callback: (payload: {
          eventType: 'INSERT' | 'UPDATE' | 'DELETE';
          new: T;
          old: T | null;
          tenantId: string | null;
          table: string;
        }) => void,
      ) => new SkyNodeRealtimeSubscription(this, tableName, eventType, callback),

      channel: (channelName: string) => ({
        on: <T = Record<string, any>>(
          eventType: 'INSERT' | 'UPDATE' | 'DELETE' | '*',
          callback: (payload: {
            eventType: 'INSERT' | 'UPDATE' | 'DELETE';
            new: T;
            old: T | null;
            tenantId: string | null;
            table: string;
          }) => void,
        ) => new SkyNodeRealtimeSubscription(this, channelName, eventType, callback),
      }),
    };
  }

  get storage() {
    return {
      from: (bucket: string) => ({
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl: `${this.url}/storage/buckets/${encodeURIComponent(bucket)}/objects/${path}`,
          },
        }),
        list: () =>
          this.request('GET', `/storage/buckets/${encodeURIComponent(bucket)}/objects`),
        remove: (paths: string[]) =>
          this.request('DELETE', `/storage/buckets/${encodeURIComponent(bucket)}/objects`, {
            paths,
          }),
      }),
    };
  }
}

export default SkyNodeClient;
