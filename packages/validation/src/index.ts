import { z } from 'zod';

// ---- Auth ----
export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const registerSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters').max(100),
    email: z.string().email('Invalid email address'),
    password: z
      .string()
      .min(8)
      .max(128)
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/,
        'Password must contain uppercase, lowercase, number, and special character',
      ),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const passwordResetRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const passwordResetSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z.string().min(8).max(128),
});

// ---- Projects ----
export const createProjectSchema = z.object({
  name: z
    .string()
    .min(3, 'Project name must be at least 3 characters')
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9 _-]*$/, 'Project name must start with a letter'),
  description: z.string().max(500).optional(),
  region: z.string().default('default'),
});

export const updateProjectSchema = z.object({
  name: z.string().min(3).max(64).optional(),
  description: z.string().max(500).optional(),
});

// ---- Database ----
export const createTableSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z_][a-z0-9_]*$/, 'Table name must be lowercase with underscores'),
  schema: z.string().default('public'),
  columns: z
    .array(
      z.object({
        name: z.string().min(1).max(63).regex(/^[a-z_][a-z0-9_]*$/),
        type: z.string().min(1),
        nullable: z.boolean().default(true),
        defaultValue: z.string().optional(),
        isPrimaryKey: z.boolean().default(false),
        isUnique: z.boolean().default(false),
      }),
    )
    .min(1, 'At least one column is required'),
  enableRls: z.boolean().default(true),
});

export const sqlQuerySchema = z.object({
  query: z.string().min(1).max(50000),
  params: z.array(z.unknown()).optional(),
});

// ---- Storage ----
export const createBucketSchema = z.object({
  name: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/, 'Invalid bucket name'),
  isPublic: z.boolean().default(false),
  fileSizeLimit: z.number().positive().optional(),
  allowedMimeTypes: z.array(z.string()).optional(),
});

// ---- API Keys ----
export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['PUBLISHABLE', 'SECRET']),
  expiresAt: z.string().datetime().optional(),
});

// ---- Pagination ----
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ---- Type exports ----
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateTableInput = z.infer<typeof createTableSchema>;
export type SqlQueryInput = z.infer<typeof sqlQuerySchema>;
export type CreateBucketInput = z.infer<typeof createBucketSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
