// ============================================================
// @skynode/types — Shared TypeScript type definitions
// ============================================================

// --- Platform User ---
export interface PlatformUser {
  id: string;
  email: string;
  name: string;
  role: PlatformRole;
  emailVerified: boolean;
  mfaEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export enum PlatformRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

// --- Project ---
export interface Project {
  id: string;
  ref: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  ownerId: string;
  region: string;
  dbHost: string;
  dbPort: number;
  dbName: string;
  createdAt: Date;
  updatedAt: Date;
}

export enum ProjectStatus {
  PROVISIONING = 'PROVISIONING',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  DELETING = 'DELETING',
  DELETED = 'DELETED',
  ERROR = 'ERROR',
}

// --- API Key ---
export interface ApiKey {
  id: string;
  projectId: string;
  name: string;
  type: ApiKeyType;
  keyPrefix: string;
  createdAt: Date;
  expiresAt?: Date;
  lastUsedAt?: Date;
  revoked: boolean;
}

export enum ApiKeyType {
  PUBLISHABLE = 'PUBLISHABLE',
  SECRET = 'SECRET',
}

// --- Audit Log ---
export interface AuditLog {
  id: string;
  actorId: string;
  actorType: ActorType;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
}

export enum ActorType {
  PLATFORM_USER = 'PLATFORM_USER',
  APP_USER = 'APP_USER',
  SYSTEM = 'SYSTEM',
  API_KEY = 'API_KEY',
}

// --- API Response ---
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ResponseMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ResponseMeta {
  page?: number;
  perPage?: number;
  total?: number;
  totalPages?: number;
}

// --- Database ---
export interface TableInfo {
  schema: string;
  name: string;
  type: 'table' | 'view';
  rowCount: number;
  sizeBytes: number;
  columns: ColumnInfo[];
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isUnique: boolean;
  references?: ForeignKeyRef;
}

export interface ForeignKeyRef {
  table: string;
  column: string;
  schema: string;
}

// --- Storage ---
export interface StorageBucket {
  id: string;
  name: string;
  projectId: string;
  isPublic: boolean;
  fileSizeLimit?: number;
  allowedMimeTypes?: string[];
  createdAt: Date;
}

export interface StorageFile {
  id: string;
  bucketId: string;
  name: string;
  path: string;
  mimeType: string;
  size: number;
  createdAt: Date;
  updatedAt: Date;
}

// --- Health ---
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  timestamp: string;
  services: Record<string, ServiceHealth>;
}

export interface ServiceHealth {
  status: 'up' | 'down' | 'degraded';
  latencyMs?: number;
  message?: string;
}
