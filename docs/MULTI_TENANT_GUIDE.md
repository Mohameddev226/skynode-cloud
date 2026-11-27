# SkyNode Cloud — Universal Multi-Tenant Developer Guide

SkyNode Cloud provides native, database-enforced **multi-tenancy** out of the box without hardcoding any application-specific domain logic. Whether you are building a **Fuel Station Management System (PetroManage)**, **School ERP**, **Hospital System**, or **B2B SaaS**, your customer organizations ("tenants") share the same scalable PostgreSQL infrastructure while remaining cryptographically and database-level isolated via **Row Level Security (RLS)**.

---

## 1. Platform Hierarchy

```
SkyNode Cloud Platform
└── Developer Account (You)
    └── Project (Dedicated DB, Isolated Roles & API Keys)
        └── Application Tenants (Companies, Schools, Clinics, Orgs)
            └── Tenant Memberships, Dynamic Roles & App Tables
```

---

## 2. Database Schema & PostgreSQL RLS Helpers

Every project database automatically includes the following universal primitives in the `auth` schema:

### Core Tenant Tables
- `auth.tenants` — Organizations (`id`, `slug`, `name`, `status`: `ACTIVE | SUSPENDED | ARCHIVED`, `plan`, `metadata`)
- `auth.tenant_roles` — Global or per-tenant custom roles (`owner`, `admin`, `member`, `viewer`, plus your custom roles)
- `auth.tenant_permissions` — Granular permissions (`role_id`, `resource`, `action`)
- `auth.tenant_users` — Memberships connecting `auth.users` to `auth.tenants` (`custom_attributes` JSONB for branch/station assignment)
- `auth.tenant_invitations` — Tokenized email invitations

### Built-In PostgreSQL RLS Functions
When querying through the SkyNode REST API or SDK, SkyNode executes every request inside a transaction using the unprivileged `authenticated` or `anon` database role and injects transaction-local claims:

- `auth.uid()` $\rightarrow$ `UUID` of the authenticated user
- `auth.tenant_id()` $\rightarrow$ `UUID` of the user's validated active tenant
- `auth.role()` $\rightarrow$ Active tenant role name (e.g. `'owner'`, `'station_manager'`, `'teacher'`)
- `auth.has_permission(resource, action)` $\rightarrow$ `BOOLEAN` validating active tenant + role permission
- `auth.is_tenant_member(tenant_uuid)` $\rightarrow$ `BOOLEAN` verifying active membership
- `auth.tenant_attribute(key)` $\rightarrow$ `TEXT` reading `custom_attributes->>key` from `auth.tenant_users`
- `auth.is_service_role()` $\rightarrow$ `BOOLEAN` true only for trusted server-side `service_role` keys

---

## 3. SQL Schema Examples (App Domain Agnostic)

### Example A: Fuel Station Management (PetroManage)

```sql
-- 1. Fuel Stations belonging to a company (tenant)
CREATE TABLE public.stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT auth.tenant_id(),
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_stations_tenant ON public.stations(tenant_id);

-- 2. Fuel Sales scoped to company AND station
CREATE TABLE public.fuel_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT auth.tenant_id(),
  station_id UUID NOT NULL REFERENCES public.stations(id) ON DELETE CASCADE,
  liters_sold NUMERIC NOT NULL,
  total_amount NUMERIC NOT NULL,
  recorded_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_fuel_sales_tenant_station ON public.fuel_sales(tenant_id, station_id);

-- Enable PostgreSQL Row Level Security
ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_sales ENABLE ROW LEVEL SECURITY;

-- Company Owner/Admin can access all company stations; Station Managers see only their assigned station
CREATE POLICY "company_and_branch_sales_select" ON public.fuel_sales
  FOR SELECT USING (
    auth.is_service_role() OR (
      tenant_id = auth.tenant_id()
      AND auth.is_tenant_member()
      AND (
        auth.role() IN ('owner', 'admin')
        OR station_id = auth.tenant_attribute('assigned_station_id')::UUID
      )
    )
  );

CREATE POLICY "company_sales_insert" ON public.fuel_sales
  FOR INSERT WITH CHECK (
    auth.is_service_role() OR (
      tenant_id = auth.tenant_id()
      AND auth.has_permission('fuel_sales', 'create')
    )
  );
```

> **Tip for PetroManage:** To prevent public users from creating companies themselves, lock tenant creation to your platform backend (`service_role` key):
> ```http
> PATCH /api/v1/projects/:ref/tenants/settings
> { "allow_self_serve_tenants": false, "require_tenant_for_api": true }
> ```

---

### Example B: School Management System

```sql
CREATE TABLE public.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT auth.tenant_id(),
  full_name TEXT NOT NULL,
  grade TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_students_tenant ON public.students(tenant_id);

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "school_students_isolation" ON public.students
  FOR ALL
  USING (auth.is_service_role() OR (tenant_id = auth.tenant_id() AND auth.has_permission('students', 'read')))
  WITH CHECK (auth.is_service_role() OR (tenant_id = auth.tenant_id() AND auth.has_permission('students', 'create')));
```

---

### Example C: Global Reference Tables (Shared Across All Tenants)

Tables without a `tenant_id` column are supported natively:

```sql
CREATE TABLE public.countries (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_countries" ON public.countries FOR SELECT USING (true);
```

---

## 4. Using `@skynode/sdk`

```typescript
import { createClient } from '@skynode/sdk';

const skynode = createClient(
  'https://skynode-cloud.onrender.com/api/v1/projects/YOUR_PROJECT_REF',
  'YOUR_ANON_KEY',
);

// 1. Register / Sign In
const { data: session, error } = await skynode.auth.signIn({
  email: 'manager@company-a.com',
  password: 'Password123!',
});

// 2. List user's authorized organizations
const { data: myTenants } = await skynode.auth.getUserTenants();

// 3. Switch active tenant (verified server-side against auth.tenant_users)
await skynode.setTenant(myTenants![0].tenant_id);

// 4. Query tenant-isolated records (RLS enforces company boundaries automatically)
const { data: sales } = await skynode
  .from('fuel_sales')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(25);

// 5. Insert record (`tenant_id` defaults to `auth.tenant_id()`)
const { data: created } = await skynode
  .from('fuel_sales')
  .insert({
    station_id: 'station-uuid',
    liters_sold: 40,
    total_amount: 52.00,
  });

// 6. Subscribe to Realtime WebSocket events (strictly scoped to active tenant)
const sub = skynode
  .from('fuel_sales')
  .on('INSERT', (event) => {
    console.log('New sale for active company:', event.new);
  })
  .subscribe();
```

---

## 5. REST & Tenant API Reference

| Category | Endpoint | Description |
|---|---|---|
| **Auth** | `POST /api/v1/projects/:ref/auth/register` | Register a project user |
| **Auth** | `POST /api/v1/projects/:ref/auth/login` | Login (`tenant_id` optional) |
| **Auth** | `POST /api/v1/projects/:ref/auth/token/refresh` | Rotate refresh token preserving active tenant |
| **Auth** | `GET /api/v1/projects/:ref/auth/tenants` | List tenants current user belongs to |
| **Auth** | `POST /api/v1/projects/:ref/auth/tenant/switch` | Switch active tenant and issue scoped JWT |
| **Auth** | `POST /api/v1/projects/:ref/auth/recover` | Request password reset email/token |
| **Auth** | `POST /api/v1/projects/:ref/auth/reset-password` | Reset password with token |
| **Auth** | `POST /api/v1/projects/:ref/auth/verify-email` | Confirm email verification token |
| **Tenants** | `POST /api/v1/projects/:ref/tenants` | Create tenant & assign owner |
| **Tenants** | `GET /api/v1/projects/:ref/tenants` | List tenants (all for `service_role`, memberships for user) |
| **Tenants** | `PATCH /api/v1/projects/:ref/tenants/:id/status` | Suspend / activate tenant (`service_role` only) |
| **RBAC** | `POST /api/v1/projects/:ref/tenants/roles` | Create global custom role & permission matrix |
| **RBAC** | `POST /api/v1/projects/:ref/tenants/:id/roles` | Create tenant-scoped custom role |
| **Members** | `POST /api/v1/projects/:ref/tenants/:id/members` | Assign user + role + `custom_attributes` |
| **Invites** | `POST /api/v1/projects/:ref/tenants/:id/invitations` | Send tenant invitation token |
| **Invites** | `POST /api/v1/projects/:ref/tenants/invitations/accept` | Accept invitation as authenticated user |
| **REST** | `GET/POST/PATCH/DELETE /api/v1/projects/:ref/rest/v1/:table` | RLS-enforced CRUD (supports `X-Tenant-ID`) |
| **Realtime** | `WS /realtime/v1?project=:ref&apikey=:key&token=:jwt` | Tenant-isolated WebSocket change streams |
