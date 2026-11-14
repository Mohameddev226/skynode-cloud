-- SkyNode Cloud — Control Plane Database DDL
-- Creates control plane schemas, enums, tables, and indexes

\c skynode_control;

-- Enable uuid-ossp / pgcrypto for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
CREATE TYPE "PlatformRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "ProjectStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'PAUSED', 'DELETING', 'DELETED', 'ERROR');
CREATE TYPE "ApiKeyType" AS ENUM ('PUBLISHABLE', 'SECRET');
CREATE TYPE "ActorType" AS ENUM ('PLATFORM_USER', 'APP_USER', 'SYSTEM', 'API_KEY');
CREATE TYPE "BackupStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'DELETED');
CREATE TYPE "BackupType" AS ENUM ('AUTOMATIC', 'MANUAL');

-- Platform Users
CREATE TABLE IF NOT EXISTS platform_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  "passwordHash" VARCHAR(255) NOT NULL,
  role "PlatformRole" NOT NULL DEFAULT 'MEMBER',
  "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
  "mfaEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "mfaSecret" VARCHAR(255),
  "avatarUrl" VARCHAR(500),
  "lastLoginAt" TIMESTAMPTZ,
  "failedLogins" INT NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_users_email ON platform_users(email);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  "ipAddress" VARCHAR(45),
  "userAgent" VARCHAR(500),
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions("userId");
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions("expiresAt");

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref VARCHAR(12) UNIQUE NOT NULL,
  slug VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(64) NOT NULL,
  description VARCHAR(500),
  status "ProjectStatus" NOT NULL DEFAULT 'PROVISIONING',
  "ownerId" UUID NOT NULL REFERENCES platform_users(id),
  region VARCHAR(50) NOT NULL DEFAULT 'default',
  "dbHost" VARCHAR(255) NOT NULL DEFAULT 'localhost',
  "dbPort" INT NOT NULL DEFAULT 5432,
  "dbName" VARCHAR(100) NOT NULL,
  "dbUser" VARCHAR(100) NOT NULL,
  "dbPasswordEnc" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects("ownerId");
CREATE INDEX IF NOT EXISTS idx_projects_ref ON projects(ref);
CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- API Keys
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  type "ApiKeyType" NOT NULL,
  "keyHash" VARCHAR(255) NOT NULL,
  "keyPrefix" VARCHAR(12) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expiresAt" TIMESTAMPTZ,
  "lastUsedAt" TIMESTAMPTZ,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  "revokedAt" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys("keyHash");
CREATE INDEX IF NOT EXISTS idx_api_keys_project_id ON api_keys("projectId");

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "actorId" VARCHAR(255) NOT NULL,
  "actorType" "ActorType" NOT NULL,
  action VARCHAR(100) NOT NULL,
  "resourceType" VARCHAR(100) NOT NULL,
  "resourceId" VARCHAR(255) NOT NULL,
  metadata JSONB,
  "ipAddress" VARCHAR(45),
  "userAgent" VARCHAR(500),
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs("actorId");
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs("resourceType", "resourceId");
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs("timestamp");

-- Backups
CREATE TABLE IF NOT EXISTS backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  "fileName" VARCHAR(255) NOT NULL,
  "filePath" VARCHAR(500) NOT NULL,
  "sizeBytes" BIGINT,
  status "BackupStatus" NOT NULL DEFAULT 'PENDING',
  type "BackupType" NOT NULL,
  "startedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completedAt" TIMESTAMPTZ,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_backups_project_id ON backups("projectId");
CREATE INDEX IF NOT EXISTS idx_backups_status ON backups(status);

-- Grant permissions to skynode_api role
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO skynode_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO skynode_api;
