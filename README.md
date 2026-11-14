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
- **pnpm** >= 9.0.0
- **Docker Desktop** (for PostgreSQL, Redis, MinIO)

### Setup

```bash
# Clone the repository
git clone <repository-url>
cd skynode-cloud

# Copy environment variables
cp .env.example .env

# Start infrastructure services
docker compose up -d

# Install dependencies
pnpm install

# Generate Prisma client
pnpm db:generate

# Push schema to database
pnpm db:push

# Start development
pnpm dev
```

### Services

| Service | URL | Description |
|---------|-----|-------------|
| Dashboard | http://localhost:3000 | Next.js management UI |
| API | http://localhost:4000 | NestJS backend API |
| API Docs | http://localhost:4000/api/docs | Swagger documentation |
| MinIO Console | http://localhost:9001 | Object storage UI |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS |
| Backend | NestJS 11, TypeScript, Prisma |
| Database | PostgreSQL 16 |
| Cache | Redis 7 |
| Storage | MinIO |
| Tooling | pnpm, Turborepo, Docker |

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
