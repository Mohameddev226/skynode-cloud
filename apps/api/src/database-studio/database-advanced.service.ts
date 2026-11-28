import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { ProjectConnectionManager, ProjectDbCredentials } from './project-connection.manager';
import type {
  AlterColumnDto,
  CreateForeignKeyDto,
  CreateIndexDto,
  CreateMigrationDto,
  MaintenanceDto,
} from './dto/database-studio.dto';

export interface SchemaSummary {
  name: string;
  owner: string;
  tableCount: number;
}

export interface IndexInfo {
  name: string;
  schema: string;
  table: string;
  definition: string;
  isUnique: boolean;
  isPrimary: boolean;
  sizeBytes: number;
  scans: number;
}

export interface ForeignKeyInfo {
  name: string;
  schema: string;
  table: string;
  column: string;
  referencedSchema: string;
  referencedTable: string;
  referencedColumn: string;
  onDelete: string;
  onUpdate: string;
}

export interface MigrationRecord {
  id: number;
  version: string;
  name: string;
  up_sql: string;
  down_sql: string | null;
  status: 'PENDING' | 'APPLIED' | 'ROLLED_BACK';
  applied_at: Date | null;
  rolled_back_at: Date | null;
  created_at: Date;
}

export interface ExtensionInfo {
  name: string;
  defaultVersion: string;
  installedVersion: string | null;
  comment: string | null;
}

export interface FunctionInfo {
  name: string;
  schema: string;
  arguments: string;
  returnType: string;
  language: string;
  securityDefiner: boolean;
}

export interface TriggerInfo {
  name: string;
  schema: string;
  table: string;
  timing: string;
  event: string;
  orientation: string;
  statement: string;
}

const RESERVED_SCHEMAS = new Set(['pg_catalog', 'information_schema', 'pg_toast']);
const FK_ACTION_MAP: Record<string, string> = {
  'NO ACTION': 'NO ACTION',
  CASCADE: 'CASCADE',
  RESTRICT: 'RESTRICT',
  'SET NULL': 'SET NULL',
  'SET DEFAULT': 'SET DEFAULT',
};

@Injectable()
export class DatabaseAdvancedService {
  private readonly logger = new Logger(DatabaseAdvancedService.name);

  constructor(private readonly connectionManager: ProjectConnectionManager) {}

  private sanitizeIdentifier(identifier: string): string {
    if (!identifier || !/^[a-zA-Z0-9_]+$/.test(identifier)) {
      throw new BadRequestException(`Invalid SQL identifier: ${identifier}`);
    }
    return identifier;
  }

  private assertEditableSchema(schema: string): string {
    const safe = this.sanitizeIdentifier(schema);
    if (RESERVED_SCHEMAS.has(safe.toLowerCase()) || safe.toLowerCase().startsWith('pg_temp')) {
      throw new BadRequestException(`Cannot modify reserved system schema "${safe}"`);
    }
    return safe;
  }

  // ── 5A. Schemas, Table Rename, Column Alter ───────────────────────────────

  async listSchemas(credentials: ProjectDbCredentials): Promise<SchemaSummary[]> {
    return this.connectionManager.withClient(credentials, async (client) => {
      const res = await client.query<{ name: string; owner: string; tableCount: number }>(`
        SELECT
          n.nspname AS name,
          pg_get_userbyid(n.nspowner) AS owner,
          COUNT(c.oid)::int AS "tableCount"
        FROM pg_namespace n
        LEFT JOIN pg_class c
          ON c.relnamespace = n.oid AND c.relkind IN ('r', 'p')
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND n.nspname NOT LIKE 'pg_temp_%'
          AND n.nspname NOT LIKE 'pg_toast_temp_%'
        GROUP BY n.nspname, n.nspowner
        ORDER BY CASE WHEN n.nspname = 'public' THEN 0 ELSE 1 END, n.nspname ASC;
      `);
      return res.rows;
    });
  }

  async createSchema(credentials: ProjectDbCredentials, name: string): Promise<{ name: string }> {
    const safeName = this.assertEditableSchema(name);
    await this.connectionManager.withClient(credentials, async (client) => {
      try {
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${safeName}";`);
        await client
          .query(`
            DO $$
            DECLARE r RECORD;
            BEGIN
              FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('authenticated', 'anon') OR rolname LIKE 'proj_%_authenticated' OR rolname LIKE 'proj_%_anon' LOOP
                EXECUTE format('GRANT USAGE ON SCHEMA "${safeName}" TO %I', r.rolname);
              END LOOP;
            EXCEPTION WHEN OTHERS THEN NULL;
            END $$;
          `)
          .catch(() => {});
      } catch (err: any) {
        throw new BadRequestException(err.message);
      }
    });
    return { name: safeName };
  }

  async renameTable(
    credentials: ProjectDbCredentials,
    schema: string,
    tableName: string,
    newName: string,
  ): Promise<{ schema: string; oldName: string; newName: string }> {
    const safeSchema = this.assertEditableSchema(schema);
    const safeTable = this.sanitizeIdentifier(tableName);
    const safeNew = this.sanitizeIdentifier(newName);

    if (safeTable === safeNew) {
      return { schema: safeSchema, oldName: safeTable, newName: safeNew };
    }

    await this.connectionManager.withClient(credentials, async (client) => {
      try {
        await client.query(
          `ALTER TABLE "${safeSchema}"."${safeTable}" RENAME TO "${safeNew}";`,
        );
      } catch (err: any) {
        throw new BadRequestException(err.message);
      }
    });

    return { schema: safeSchema, oldName: safeTable, newName: safeNew };
  }

  async alterColumn(
    credentials: ProjectDbCredentials,
    schema: string,
    tableName: string,
    columnName: string,
    dto: AlterColumnDto,
  ): Promise<{ schema: string; table: string; column: string }> {
    const safeSchema = this.assertEditableSchema(schema);
    const safeTable = this.sanitizeIdentifier(tableName);
    let currentCol = this.sanitizeIdentifier(columnName);

    if (
      dto.newName === undefined &&
      dto.type === undefined &&
      dto.nullable === undefined &&
      dto.defaultValue === undefined
    ) {
      throw new BadRequestException('At least one column modification is required');
    }

    if (dto.type && !/^[a-zA-Z0-9_(),\s]+$/.test(dto.type)) {
      throw new BadRequestException(`Invalid column data type: ${dto.type}`);
    }

    if (typeof dto.defaultValue === 'string' && dto.defaultValue.includes(';')) {
      throw new BadRequestException('Invalid default expression');
    }

    await this.connectionManager.withClient(credentials, async (client) => {
      await client.query('BEGIN');
      try {
        if (dto.type) {
          const cleanType = dto.type.trim();
          await client.query(
            `ALTER TABLE "${safeSchema}"."${safeTable}" ALTER COLUMN "${currentCol}" TYPE ${cleanType} USING "${currentCol}"::${cleanType};`,
          );
        }

        if (dto.nullable !== undefined) {
          await client.query(
            `ALTER TABLE "${safeSchema}"."${safeTable}" ALTER COLUMN "${currentCol}" ${
              dto.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'
            };`,
          );
        }

        if (dto.defaultValue !== undefined) {
          if (dto.defaultValue === null || dto.defaultValue.trim() === '') {
            await client.query(
              `ALTER TABLE "${safeSchema}"."${safeTable}" ALTER COLUMN "${currentCol}" DROP DEFAULT;`,
            );
          } else {
            await client.query(
              `ALTER TABLE "${safeSchema}"."${safeTable}" ALTER COLUMN "${currentCol}" SET DEFAULT ${dto.defaultValue.trim()};`,
            );
          }
        }

        if (dto.newName && dto.newName !== currentCol) {
          const safeNewCol = this.sanitizeIdentifier(dto.newName);
          await client.query(
            `ALTER TABLE "${safeSchema}"."${safeTable}" RENAME COLUMN "${currentCol}" TO "${safeNewCol}";`,
          );
          currentCol = safeNewCol;
        }

        await client.query('COMMIT');
      } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {});
        throw new BadRequestException(err.message);
      }
    });

    return { schema: safeSchema, table: safeTable, column: currentCol };
  }

  // ── 5B. Indexes & Foreign Keys ────────────────────────────────────────────

  async listIndexes(
    credentials: ProjectDbCredentials,
    schema?: string,
    table?: string,
  ): Promise<IndexInfo[]> {
    const safeSchema = schema ? this.sanitizeIdentifier(schema) : null;
    const safeTable = table ? this.sanitizeIdentifier(table) : null;

    return this.connectionManager.withClient(credentials, async (client) => {
      const clauses = [`ns.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')`];
      const params: string[] = [];

      if (safeSchema) {
        params.push(safeSchema);
        clauses.push(`ns.nspname = $${params.length}`);
      }
      if (safeTable) {
        params.push(safeTable);
        clauses.push(`tbl.relname = $${params.length}`);
      }

      const res = await client.query<IndexInfo>(
        `
        SELECT
          idx.relname AS name,
          ns.nspname AS schema,
          tbl.relname AS "table",
          pg_get_indexdef(idx.oid) AS definition,
          ix.indisunique AS "isUnique",
          ix.indisprimary AS "isPrimary",
          COALESCE(pg_relation_size(idx.oid), 0)::bigint AS "sizeBytes",
          COALESCE(st.idx_scan, 0)::bigint AS scans
        FROM pg_index ix
        JOIN pg_class idx ON idx.oid = ix.indexrelid
        JOIN pg_class tbl ON tbl.oid = ix.indrelid
        JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
        LEFT JOIN pg_stat_user_indexes st ON st.indexrelid = idx.oid
        WHERE ${clauses.join(' AND ')}
        ORDER BY ns.nspname, tbl.relname, idx.relname;
        `,
        params,
      );

      return res.rows.map((r) => ({
        ...r,
        sizeBytes: Number(r.sizeBytes ?? 0),
        scans: Number(r.scans ?? 0),
      }));
    });
  }

  async createIndex(
    credentials: ProjectDbCredentials,
    schema: string,
    table: string,
    dto: CreateIndexDto,
  ): Promise<{ name: string; schema: string; table: string }> {
    const safeSchema = this.assertEditableSchema(schema);
    const safeTable = this.sanitizeIdentifier(table);
    const safeName = this.sanitizeIdentifier(dto.name);
    const safeCols = dto.columns.map((c) => `"${this.sanitizeIdentifier(c)}"`);
    const method = dto.method && ['btree', 'hash', 'gin', 'gist'].includes(dto.method) ? dto.method : 'btree';
    const uniqueSql = dto.unique ? 'UNIQUE ' : '';

    const sql = `CREATE ${uniqueSql}INDEX "${safeName}" ON "${safeSchema}"."${safeTable}" USING ${method} (${safeCols.join(', ')});`;

    await this.connectionManager.withClient(credentials, async (client) => {
      try {
        await client.query(sql);
      } catch (err: any) {
        throw new BadRequestException(err.message);
      }
    });

    return { name: safeName, schema: safeSchema, table: safeTable };
  }

  async dropIndex(
    credentials: ProjectDbCredentials,
    schema: string,
    indexName: string,
  ): Promise<void> {
    const safeSchema = this.assertEditableSchema(schema);
    const safeIndex = this.sanitizeIdentifier(indexName);

    await this.connectionManager.withClient(credentials, async (client) => {
      try {
        await client.query(`DROP INDEX IF EXISTS "${safeSchema}"."${safeIndex}";`);
      } catch (err: any) {
        throw new BadRequestException(err.message);
      }
    });
  }

  async listForeignKeys(
    credentials: ProjectDbCredentials,
    schema?: string,
    table?: string,
  ): Promise<ForeignKeyInfo[]> {
    const safeSchema = schema ? this.sanitizeIdentifier(schema) : null;
    const safeTable = table ? this.sanitizeIdentifier(table) : null;

    return this.connectionManager.withClient(credentials, async (client) => {
      const clauses = [
        `con.contype = 'f'`,
        `src_ns.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')`,
      ];
      const params: string[] = [];

      if (safeSchema) {
        params.push(safeSchema);
        clauses.push(`src_ns.nspname = $${params.length}`);
      }
      if (safeTable) {
        params.push(safeTable);
        clauses.push(`src_tbl.relname = $${params.length}`);
      }

      const res = await client.query<ForeignKeyInfo>(
        `
        SELECT
          con.conname AS name,
          src_ns.nspname AS schema,
          src_tbl.relname AS "table",
          src_att.attname AS "column",
          ref_ns.nspname AS "referencedSchema",
          ref_tbl.relname AS "referencedTable",
          ref_att.attname AS "referencedColumn",
          CASE con.confdeltype
            WHEN 'a' THEN 'NO ACTION'
            WHEN 'r' THEN 'RESTRICT'
            WHEN 'c' THEN 'CASCADE'
            WHEN 'n' THEN 'SET NULL'
            WHEN 'd' THEN 'SET DEFAULT'
            ELSE 'NO ACTION'
          END AS "onDelete",
          CASE con.confupdtype
            WHEN 'a' THEN 'NO ACTION'
            WHEN 'r' THEN 'RESTRICT'
            WHEN 'c' THEN 'CASCADE'
            WHEN 'n' THEN 'SET NULL'
            WHEN 'd' THEN 'SET DEFAULT'
            ELSE 'NO ACTION'
          END AS "onUpdate"
        FROM pg_constraint con
        JOIN pg_class src_tbl ON src_tbl.oid = con.conrelid
        JOIN pg_namespace src_ns ON src_ns.oid = src_tbl.relnamespace
        JOIN pg_attribute src_att ON src_att.attrelid = con.conrelid AND src_att.attnum = con.conkey[1]
        JOIN pg_class ref_tbl ON ref_tbl.oid = con.confrelid
        JOIN pg_namespace ref_ns ON ref_ns.oid = ref_tbl.relnamespace
        JOIN pg_attribute ref_att ON ref_att.attrelid = con.confrelid AND ref_att.attnum = con.confkey[1]
        WHERE ${clauses.join(' AND ')}
        ORDER BY src_ns.nspname, src_tbl.relname, con.conname;
        `,
        params,
      );

      return res.rows;
    });
  }

  async createForeignKey(
    credentials: ProjectDbCredentials,
    schema: string,
    table: string,
    dto: CreateForeignKeyDto,
  ): Promise<{ name: string }> {
    const safeSchema = this.assertEditableSchema(schema);
    const safeTable = this.sanitizeIdentifier(table);
    const safeCol = this.sanitizeIdentifier(dto.column);
    const safeRefSchema = this.assertEditableSchema(dto.referencedSchema || 'public');
    const safeRefTable = this.sanitizeIdentifier(dto.referencedTable);
    const safeRefCol = this.sanitizeIdentifier(dto.referencedColumn);
    const safeName = this.sanitizeIdentifier(
      dto.name || `fk_${safeTable}_${safeCol}_${safeRefTable}`.slice(0, 60),
    );
    const onDelete = FK_ACTION_MAP[dto.onDelete || 'NO ACTION'] ?? 'NO ACTION';
    const onUpdate = FK_ACTION_MAP[dto.onUpdate || 'NO ACTION'] ?? 'NO ACTION';

    const sql = `
      ALTER TABLE "${safeSchema}"."${safeTable}"
      ADD CONSTRAINT "${safeName}"
      FOREIGN KEY ("${safeCol}")
      REFERENCES "${safeRefSchema}"."${safeRefTable}" ("${safeRefCol}")
      ON DELETE ${onDelete}
      ON UPDATE ${onUpdate};
    `;

    await this.connectionManager.withClient(credentials, async (client) => {
      try {
        await client.query(sql);
      } catch (err: any) {
        throw new BadRequestException(err.message);
      }
    });

    return { name: safeName };
  }

  async dropForeignKey(
    credentials: ProjectDbCredentials,
    schema: string,
    table: string,
    constraintName: string,
  ): Promise<void> {
    const safeSchema = this.assertEditableSchema(schema);
    const safeTable = this.sanitizeIdentifier(table);
    const safeConstraint = this.sanitizeIdentifier(constraintName);

    await this.connectionManager.withClient(credentials, async (client) => {
      try {
        await client.query(
          `ALTER TABLE "${safeSchema}"."${safeTable}" DROP CONSTRAINT IF EXISTS "${safeConstraint}";`,
        );
      } catch (err: any) {
        throw new BadRequestException(err.message);
      }
    });
  }

  // ── 5C. Versioned Migrations System ───────────────────────────────────────

  private async ensureMigrationsTable(client: PoolClient): Promise<void> {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public._skynode_migrations (
        id SERIAL PRIMARY KEY,
        version VARCHAR(32) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        up_sql TEXT NOT NULL,
        down_sql TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPLIED', 'ROLLED_BACK')),
        applied_at TIMESTAMPTZ,
        rolled_back_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  async listMigrations(credentials: ProjectDbCredentials): Promise<MigrationRecord[]> {
    return this.connectionManager.withClient(credentials, async (client) => {
      await this.ensureMigrationsTable(client);
      const res = await client.query<MigrationRecord>(
        `SELECT * FROM public._skynode_migrations ORDER BY version DESC, id DESC;`,
      );
      return res.rows;
    });
  }

  async createMigration(
    credentials: ProjectDbCredentials,
    dto: CreateMigrationDto,
  ): Promise<MigrationRecord> {
    const cleanName = dto.name.trim().replace(/\s+/g, '_').toLowerCase().slice(0, 120);
    const version = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, '')
      .slice(0, 17);

    return this.connectionManager.withClient(credentials, async (client) => {
      await this.ensureMigrationsTable(client);

      if (dto.applyNow !== false) {
        await client.query('BEGIN');
        try {
          await client.query(dto.upSql);
          const inserted = await client.query<MigrationRecord>(
            `INSERT INTO public._skynode_migrations (version, name, up_sql, down_sql, status, applied_at)
             VALUES ($1, $2, $3, $4, 'APPLIED', NOW())
             RETURNING *`,
            [version, cleanName, dto.upSql, dto.downSql ?? null],
          );
          await client.query('COMMIT');
          return inserted.rows[0]!;
        } catch (err: any) {
          await client.query('ROLLBACK').catch(() => {});
          throw new BadRequestException(`Migration failed: ${err.message}`);
        }
      }

      const inserted = await client.query<MigrationRecord>(
        `INSERT INTO public._skynode_migrations (version, name, up_sql, down_sql, status)
         VALUES ($1, $2, $3, $4, 'PENDING')
         RETURNING *`,
        [version, cleanName, dto.upSql, dto.downSql ?? null],
      );
      return inserted.rows[0]!;
    });
  }

  async applyMigration(
    credentials: ProjectDbCredentials,
    idOrVersion: string,
  ): Promise<MigrationRecord> {
    return this.connectionManager.withClient(credentials, async (client) => {
      await this.ensureMigrationsTable(client);
      const isNum = /^\d+$/.test(idOrVersion);
      const res = await client.query<MigrationRecord>(
        isNum
          ? `SELECT * FROM public._skynode_migrations WHERE id = $1 OR version = $2 LIMIT 1`
          : `SELECT * FROM public._skynode_migrations WHERE version = $1 LIMIT 1`,
        isNum ? [parseInt(idOrVersion, 10), idOrVersion] : [idOrVersion],
      );

      const migration = res.rows[0];
      if (!migration) throw new NotFoundException(`Migration "${idOrVersion}" not found`);
      if (migration.status === 'APPLIED') {
        throw new ConflictException(`Migration "${migration.name}" is already applied`);
      }

      await client.query('BEGIN');
      try {
        await client.query(migration.up_sql);
        const updated = await client.query<MigrationRecord>(
          `UPDATE public._skynode_migrations
           SET status = 'APPLIED', applied_at = NOW(), rolled_back_at = NULL
           WHERE id = $1 RETURNING *`,
          [migration.id],
        );
        await client.query('COMMIT');
        return updated.rows[0]!;
      } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {});
        throw new BadRequestException(`Apply migration failed: ${err.message}`);
      }
    });
  }

  async rollbackMigration(
    credentials: ProjectDbCredentials,
    idOrVersion: string,
  ): Promise<MigrationRecord> {
    return this.connectionManager.withClient(credentials, async (client) => {
      await this.ensureMigrationsTable(client);
      const isNum = /^\d+$/.test(idOrVersion);
      const res = await client.query<MigrationRecord>(
        isNum
          ? `SELECT * FROM public._skynode_migrations WHERE id = $1 OR version = $2 LIMIT 1`
          : `SELECT * FROM public._skynode_migrations WHERE version = $1 LIMIT 1`,
        isNum ? [parseInt(idOrVersion, 10), idOrVersion] : [idOrVersion],
      );

      const migration = res.rows[0];
      if (!migration) throw new NotFoundException(`Migration "${idOrVersion}" not found`);
      if (migration.status !== 'APPLIED') {
        throw new BadRequestException('Only APPLIED migrations can be rolled back');
      }
      if (!migration.down_sql || !migration.down_sql.trim()) {
        throw new BadRequestException('This migration has no down_sql rollback script');
      }

      await client.query('BEGIN');
      try {
        await client.query(migration.down_sql);
        const updated = await client.query<MigrationRecord>(
          `UPDATE public._skynode_migrations
           SET status = 'ROLLED_BACK', rolled_back_at = NOW()
           WHERE id = $1 RETURNING *`,
          [migration.id],
        );
        await client.query('COMMIT');
        return updated.rows[0]!;
      } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {});
        throw new BadRequestException(`Rollback failed: ${err.message}`);
      }
    });
  }

  // ── 5D. Extensions, Functions, Triggers & Performance ─────────────────────

  async listExtensions(credentials: ProjectDbCredentials): Promise<ExtensionInfo[]> {
    return this.connectionManager.withClient(credentials, async (client) => {
      const res = await client.query<ExtensionInfo>(`
        SELECT
          name,
          default_version AS "defaultVersion",
          installed_version AS "installedVersion",
          comment
        FROM pg_available_extensions
        ORDER BY (installed_version IS NOT NULL) DESC, name ASC;
      `);
      return res.rows;
    });
  }

  async toggleExtension(
    credentials: ProjectDbCredentials,
    name: string,
    enabled: boolean,
  ): Promise<{ name: string; enabled: boolean }> {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new BadRequestException(`Invalid extension name: ${name}`);
    }
    const safeName = name.replace(/"/g, '');
    await this.connectionManager.withClient(credentials, async (client) => {
      try {
        if (enabled) {
          await client.query(`CREATE EXTENSION IF NOT EXISTS "${safeName}";`);
        } else {
          await client.query(`DROP EXTENSION IF EXISTS "${safeName}" CASCADE;`);
        }
      } catch (err: any) {
        throw new BadRequestException(err.message);
      }
    });
    return { name: safeName, enabled };
  }

  async listFunctions(credentials: ProjectDbCredentials): Promise<FunctionInfo[]> {
    return this.connectionManager.withClient(credentials, async (client) => {
      const res = await client.query<FunctionInfo>(`
        SELECT
          p.proname AS name,
          n.nspname AS schema,
          pg_get_function_identity_arguments(p.oid) AS arguments,
          pg_get_function_result(p.oid) AS "returnType",
          l.lanname AS language,
          p.prosecdef AS "securityDefiner"
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_language l ON l.oid = p.prolang
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND n.nspname NOT LIKE 'pg_temp_%'
        ORDER BY n.nspname, p.proname;
      `);
      return res.rows;
    });
  }

  async listTriggers(credentials: ProjectDbCredentials): Promise<TriggerInfo[]> {
    return this.connectionManager.withClient(credentials, async (client) => {
      const res = await client.query<TriggerInfo>(`
        SELECT
          trigger_name AS name,
          event_object_schema AS schema,
          event_object_table AS "table",
          action_timing AS timing,
          event_manipulation AS event,
          action_orientation AS orientation,
          action_statement AS statement
        FROM information_schema.triggers
        WHERE trigger_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY event_object_schema, event_object_table, trigger_name;
      `);
      return res.rows;
    });
  }

  async getPerformanceStats(credentials: ProjectDbCredentials) {
    return this.connectionManager.withClient(credentials, async (client) => {
      const [tablesRes, dbRes] = await Promise.all([
        client.query(`
          SELECT
            schemaname AS schema,
            relname AS "table",
            COALESCE(n_live_tup, 0)::bigint AS "liveRows",
            COALESCE(n_dead_tup, 0)::bigint AS "deadRows",
            COALESCE(seq_scan, 0)::bigint AS "seqScans",
            COALESCE(idx_scan, 0)::bigint AS "idxScans",
            last_vacuum AS "lastVacuum",
            last_autovacuum AS "lastAutovacuum",
            last_analyze AS "lastAnalyze"
          FROM pg_stat_user_tables
          ORDER BY COALESCE(n_dead_tup, 0) DESC, relname ASC;
        `),
        client.query(`
          SELECT
            numbackends::int AS "activeConnections",
            CASE
              WHEN (blks_hit + blks_read) > 0
              THEN ROUND((blks_hit::numeric / (blks_hit + blks_read)) * 100, 2)
              ELSE 100
            END AS "cacheHitRatio",
            pg_database_size(current_database())::bigint AS "databaseSizeBytes"
          FROM pg_stat_database
          WHERE datname = current_database();
        `),
      ]);

      let slowQueries: Array<{
        query: string;
        calls: number;
        meanExecTimeMs: number;
        totalExecTimeMs: number;
        rows: number;
      }> = [];
      let pgStatStatementsAvailable = false;

      try {
        const stmtRes = await client.query(`
          SELECT
            LEFT(query, 200) AS query,
            calls::bigint AS calls,
            ROUND(mean_exec_time::numeric, 2)::float AS "meanExecTimeMs",
            ROUND(total_exec_time::numeric, 2)::float AS "totalExecTimeMs",
            rows::bigint AS rows
          FROM pg_stat_statements
          ORDER BY mean_exec_time DESC
          LIMIT 20;
        `);
        pgStatStatementsAvailable = true;
        slowQueries = stmtRes.rows.map((r) => ({
          ...r,
          calls: Number(r.calls ?? 0),
          rows: Number(r.rows ?? 0),
        }));
      } catch (err: any) {
        this.logger.debug(`pg_stat_statements unavailable: ${err.message}`);
      }

      const dbRow = dbRes.rows[0] ?? {};
      return {
        summary: {
          activeConnections: Number(dbRow.activeConnections ?? 1),
          cacheHitRatio: Number(dbRow.cacheHitRatio ?? 100),
          databaseSizeBytes: Number(dbRow.databaseSizeBytes ?? 0),
        },
        tables: tablesRes.rows.map((t) => ({
          ...t,
          liveRows: Number(t.liveRows ?? 0),
          deadRows: Number(t.deadRows ?? 0),
          seqScans: Number(t.seqScans ?? 0),
          idxScans: Number(t.idxScans ?? 0),
        })),
        pgStatStatementsAvailable,
        slowQueries,
      };
    });
  }

  async runMaintenance(
    credentials: ProjectDbCredentials,
    dto: MaintenanceDto,
  ): Promise<{ message: string }> {
    const cmd = dto.action === 'vacuum' ? 'VACUUM' : 'ANALYZE';
    let target = '';
    if (dto.table) {
      const safeSchema = this.assertEditableSchema(dto.schema || 'public');
      const safeTable = this.sanitizeIdentifier(dto.table);
      target = ` "${safeSchema}"."${safeTable}"`;
    }

    await this.connectionManager.withClient(credentials, async (client) => {
      try {
        await client.query(`${cmd}${target};`);
      } catch (err: any) {
        throw new BadRequestException(err.message);
      }
    });

    return {
      message: target ? `${cmd} completed on${target}` : `${cmd} completed on database`,
    };
  }
}
