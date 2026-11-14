# SkyNode Cloud — Architecture

## Overview

SkyNode Cloud is a modular monolith with two architectural layers:

1. **Control Plane** — Manages the platform itself (users, projects, provisioning)
2. **Data Plane** — Per-project backend resources (database, auth, APIs, storage, realtime)

## Database Architecture

### Two-Layer Model

| Database | Purpose | Accessed By |
|----------|---------|-------------|
| `skynode_control` | Platform metadata, users, projects, audit logs | NestJS API via Prisma |
| `skynode_proj_{ref}` | Application data, app users, app tables | API Gateway via `pg` client |

### Role Hierarchy

```
PostgreSQL Cluster
├── postgres (superuser — Docker init only)
├── skynode_api (control plane — limited to skynode_control)
├── skynode_provisioner (creates databases/roles — never used at runtime)
├── skynode_proj_{ref}_admin (DDL: schema changes per project)
└── skynode_proj_{ref}_app (DML: runtime queries, subject to RLS)
```

### Project Provisioning Flow

1. Generate unique 8-char alphanumeric `project_ref`
2. `CREATE DATABASE skynode_proj_{ref}`
3. Create `skynode_proj_{ref}_admin` role (owns DB, DDL)
4. Create `skynode_proj_{ref}_app` role (runtime, RLS-enforced)
5. Initialize `auth` and `storage` schemas
6. Enable RLS on default tables
7. Store encrypted credentials in control DB
8. Generate API keys (publishable + secret, stored hashed)

## Authentication Separation

| Aspect | Platform Auth | Application Auth |
|--------|--------------|-----------------|
| Purpose | SkyNode dashboard access | Project API access |
| Users | Platform admins | App end-users |
| Storage | `skynode_control.platform_users` | `skynode_proj_{ref}.auth.users` |
| Mechanism | Argon2id + HttpOnly cookies | Argon2id + JWT + refresh tokens |
| Session | Redis server-side sessions | Stateless JWT (15min) + DB refresh tokens |

## Module Architecture

```
AppModule
├── ConfigModule (global)
├── ThrottlerModule (rate limiting)
├── HealthModule
├── AuditModule
├── AuthModule (platform auth)
├── ProjectsModule
├── ProvisioningModule
├── DatabasesModule (table editor, SQL editor)
├── ApiGatewayModule (auto-generated REST)
├── AppAuthModule (per-project auth)
├── StorageModule (MinIO)
├── RealtimeModule (WebSocket)
├── BackupsModule
├── MonitoringModule
└── AdminModule
```

## Key Design Decisions

1. **Separate databases per project** (not schemas) for strong isolation
2. **Prisma for control plane** (type-safe ORM) + **pg for data plane** (dynamic connections)
3. **Modular monolith** over microservices (appropriate for current scale)
4. **HttpOnly cookies** for dashboard (CSRF-protected) + **JWT** for project APIs
5. **Never expose provisioner credentials** at runtime
