# SkyNode Cloud

**Private Backend-as-a-Service (BaaS) Platform**

SkyNode Cloud is a Supabase-inspired platform that provides isolated backend infrastructure for your applications — each project gets its own PostgreSQL database, authentication, REST APIs, file storage, and realtime capabilities.

## Architecture

```
SkyNode Cloud
├── Control Plane (platform management)
│   ├── Platform Authentication
│   ├── Project Manager
│   ├── Provisioning Engine
│   └── Platform Administration
│
└── Data Plane (per-project resources)
    ├── PostgreSQL Database (isolated per project)
    ├── Application Authentication
    ├── Auto-generated REST API
    ├── File Storage (MinIO)
    └── Realtime (WebSocket)
```

## Quick Start

### Prerequisites

- **Node.js** >= 20.0.0
- **npm** >= 10.0.0
- **Docker Desktop** (for PostgreSQL, Redis, MinIO)

### Setup

```bash
# Clone the repository
git clone <repository-url>
cd skynode-cloud

# Copy environment variables
cp .env.example .env

# Start infrastructure services (Postgres, Redis, MinIO)
docker compose up -d

# Install dependencies (npm workspaces)
npm install

# Generate Prisma client
npm run db:generate

# Push schema to control database
npm run db:push

# (Optional) Seed demo user
npx ts-node apps/api/scripts/seed.ts

# Start development servers
npm run dev
```

### SkyNode CLI

```bash
# Check platform status
npx skynode status

# Authenticate
npx skynode login -e admin@skynode.dev

# List projects
npx skynode projects list

# Create a project
npx skynode projects create "My New App"

# Inspect database & run SQL
npx skynode db tables <project-ref>
npx skynode db sql <project-ref> "SELECT * FROM users"
```

### Services

| Service | URL | Description |
|---------|-----|-------------|
| Dashboard | http://localhost:3000 | Next.js 15 management UI |
| API | http://localhost:4000 | NestJS backend API |
| API Docs | http://localhost:4000/api/docs | Swagger OpenAPI documentation |
| Health Check | http://localhost:4000/api/v1/health | System & services health |
| MinIO Console | http://localhost:9001 | S3-compatible Object Storage UI |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS, Radix UI |
| Backend | NestJS 11, TypeScript, Prisma, Argon2id, AES-256-GCM |
| Database | PostgreSQL 16 (Multi-tenant provisioned databases) |
| Cache & Sessions | Redis 7 |
| Storage | MinIO / AWS S3 SDK |
| Tooling | npm workspaces, Turborepo, Docker, Jest, Nginx |

## Project Structure

```
skynode-cloud/
├── apps/
│   ├── api/          # NestJS backend (control plane + data plane APIs)
│   ├── dashboard/    # Next.js frontend
│   └── cli/          # SkyNode CLI
├── packages/
│   ├── types/        # Shared TypeScript types
│   ├── validation/   # Shared Zod schemas
│   ├── config/       # Shared ESLint/TS configs
│   └── sdk/          # @skynode/sdk
├── infrastructure/
│   ├── docker/       # Dockerfiles
│   ├── postgres/     # Init scripts
│   ├── nginx/        # Reverse proxy configs
│   └── scripts/      # Setup & utility scripts
├── docs/             # Documentation
└── tests/            # Integration & E2E tests
```

## Development

```bash
pnpm dev          # Start all apps in dev mode
pnpm build        # Build all apps
pnpm lint         # Lint all apps
pnpm typecheck    # Type-check all apps
pnpm test         # Run all tests
```

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — System design and decisions
- [SECURITY.md](./SECURITY.md) — Security model and practices
- [DEPLOYMENT.md](./DEPLOYMENT.md) — Deployment guide

## License

UNLICENSED — Private project
