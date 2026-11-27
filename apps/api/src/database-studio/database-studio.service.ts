import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ProjectConnectionManager, ProjectDbCredentials } from './project-connection.manager';
import { CreateTableDto, TableQueryPaginationDto } from './dto/database-studio.dto';

export interface TableSummary {
  name: string;
  schema: string;
  rowCount: number;
  sizeBytes: number;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimary: boolean;
}

export interface QueryExecutionResult {
  columns: string[];
  rows: Record<string, any>[];
  rowCount: number;
  executionTimeMs: number;
}

@Injectable()
export class DatabaseStudioService {
  private readonly logger = new Logger(DatabaseStudioService.name);

  constructor(private readonly connectionManager: ProjectConnectionManager) {}

  /**
   * Sanitizes SQL identifier to prevent SQL injection in table/column names.
   */
  private sanitizeIdentifier(identifier: string): string {
    if (!/^[a-zA-Z0-9_]+$/.test(identifier)) {
      throw new BadRequestException(`Invalid SQL identifier: ${identifier}`);
    }
    return identifier;
  }

  /**
   * List all user tables in the project database with row counts and disk sizes.
   */
  async getTables(credentials: ProjectDbCredentials): Promise<TableSummary[]> {
    return this.connectionManager.withClient(credentials, async (client) => {
      const sql = `
        SELECT
          t.table_name AS name,
          t.table_schema AS schema,
          COALESCE(s.n_live_tup, 0)::int AS "rowCount",
          COALESCE(pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name)), 0)::bigint AS "sizeBytes"
        FROM information_schema.tables t
        LEFT JOIN pg_stat_user_tables s
          ON s.schemaname = t.table_schema AND s.relname = t.table_name
        WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
          AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_schema, t.table_name;
      `;

      const result = await client.query(sql);
      return result.rows.map((r) => ({
        name: r.name,
        schema: r.schema,
        rowCount: parseInt(r.rowCount, 10) || 0,
        sizeBytes: parseInt(r.sizeBytes, 10) || 0,
      }));
    });
  }

  /**
   * Get detailed column and constraint schema for a table.
   */
  async getTableSchema(
    credentials: ProjectDbCredentials,
    schema: string,
    table: string,
  ): Promise<{ table: string; schema: string; columns: ColumnInfo[] }> {
    const safeSchema = this.sanitizeIdentifier(schema);
    const safeTable = this.sanitizeIdentifier(table);

    return this.connectionManager.withClient(credentials, async (client) => {
      const sql = `
        SELECT
          c.column_name AS name,
          c.data_type AS "dataType",
          (c.is_nullable = 'YES') AS "isNullable",
          c.column_default AS "defaultValue",
          COALESCE(pk.is_pk, false) AS "isPrimary"
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT kcu.column_name, true AS is_pk
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = $1
            AND tc.table_name = $2
        ) pk ON pk.column_name = c.column_name
        WHERE c.table_schema = $1 AND c.table_name = $2
        ORDER BY c.ordinal_position;
      `;

      const result = await client.query(sql, [safeSchema, safeTable]);
      return {
        table: safeTable,
        schema: safeSchema,
        columns: result.rows,
      };
    });
  }

  /**
   * Create a new table with column definitions.
   */
  async createTable(credentials: ProjectDbCredentials, dto: CreateTableDto): Promise<void> {
    const schema = this.sanitizeIdentifier(dto.schema || 'public');
    const table = this.sanitizeIdentifier(dto.name);

    if (dto.columns.length === 0) {
      throw new BadRequestException('At least one column definition is required');
    }

    const columnDefs: string[] = [];
    const primaryKeys: string[] = [];

    for (const col of dto.columns) {
      const colName = this.sanitizeIdentifier(col.name);
      // Valid SQL data types
      const type = col.type.toLowerCase();
      if (!/^[a-z0-9_() ]+$/.test(type)) {
        throw new BadRequestException(`Invalid column type: ${col.type}`);
      }

      let def = `"${colName}" ${type}`;
      if (col.isNullable === false) def += ' NOT NULL';
      if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`;
      if (col.isUnique) def += ' UNIQUE';

      columnDefs.push(def);

      if (col.isPrimary) {
        primaryKeys.push(`"${colName}"`);
      }
    }

    if (primaryKeys.length > 0) {
      columnDefs.push(`PRIMARY KEY (${primaryKeys.join(', ')})`);
    }

    const sql = `CREATE TABLE "${schema}"."${table}" (\n  ${columnDefs.join(',\n  ')}\n);`;

    await this.connectionManager.withClient(credentials, async (client) => {
      await client.query(sql);
      // Grant access to runtime roles so RLS policies control row visibility rather than table-level denies
      await client.query(`
        DO $$
        DECLARE
          r RECORD;
        BEGIN
          FOR r IN SELECT rolname FROM pg_roles WHERE rolname = 'authenticated' OR rolname LIKE 'proj_%_authenticated' LOOP
            EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${schema}"."${table}" TO %I', r.rolname);
          END LOOP;
          FOR r IN SELECT rolname FROM pg_roles WHERE rolname = 'anon' OR rolname LIKE 'proj_%_anon' LOOP
            EXECUTE format('GRANT SELECT ON TABLE "${schema}"."${table}" TO %I', r.rolname);
          END LOOP;
        EXCEPTION WHEN OTHERS THEN NULL;
        END
        $$;
      `).catch(() => {});
    });
  }

  /**
   * Drop a table.
   */
  async dropTable(credentials: ProjectDbCredentials, schema: string, table: string): Promise<void> {
    const safeSchema = this.sanitizeIdentifier(schema);
    const safeTable = this.sanitizeIdentifier(table);

    await this.connectionManager.withClient(credentials, async (client) => {
      await client.query(`DROP TABLE IF EXISTS "${safeSchema}"."${safeTable}" CASCADE;`);
    });
  }

  /**
   * Fetch paginated records from a table.
   */
  async getTableRecords(
    credentials: ProjectDbCredentials,
    schema: string,
    table: string,
    pagination: TableQueryPaginationDto,
  ): Promise<{ rows: Record<string, any>[]; total: number; page: number; limit: number }> {
    const safeSchema = this.sanitizeIdentifier(schema);
    const safeTable = this.sanitizeIdentifier(table);

    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 50;
    const offset = (page - 1) * limit;

    let orderByClause = '';
    if (pagination.sortBy) {
      const safeCol = this.sanitizeIdentifier(pagination.sortBy);
      const direction = pagination.sortOrder === 'desc' ? 'DESC' : 'ASC';
      orderByClause = `ORDER BY "${safeCol}" ${direction}`;
    }

    return this.connectionManager.withClient(credentials, async (client) => {
      const countRes = await client.query(`SELECT COUNT(*)::int AS count FROM "${safeSchema}"."${safeTable}"`);
      const total = countRes.rows[0]?.count || 0;

      const dataQuery = `
        SELECT * FROM "${safeSchema}"."${safeTable}"
        ${orderByClause}
        LIMIT $1 OFFSET $2;
      `;

      const dataRes = await client.query(dataQuery, [limit, offset]);
      return {
        rows: dataRes.rows,
        total,
        page,
        limit,
      };
    });
  }

  /**
   * Insert a new record into a table.
   */
  async insertRecord(
    credentials: ProjectDbCredentials,
    schema: string,
    table: string,
    data: Record<string, any>,
  ): Promise<Record<string, any>> {
    const safeSchema = this.sanitizeIdentifier(schema);
    const safeTable = this.sanitizeIdentifier(table);

    const keys = Object.keys(data).map((k) => this.sanitizeIdentifier(k));
    if (keys.length === 0) {
      throw new BadRequestException('Cannot insert empty record');
    }

    const values = Object.values(data);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const columns = keys.map((k) => `"${k}"`).join(', ');

    const sql = `
      INSERT INTO "${safeSchema}"."${safeTable}" (${columns})
      VALUES (${placeholders})
      RETURNING *;
    `;

    return this.connectionManager.withClient(credentials, async (client) => {
      const res = await client.query(sql, values);
      return res.rows[0];
    });
  }

  /**
   * Update a record by primary key.
   */
  async updateRecord(
    credentials: ProjectDbCredentials,
    schema: string,
    table: string,
    pkCol: string,
    pkVal: any,
    data: Record<string, any>,
  ): Promise<Record<string, any>> {
    const safeSchema = this.sanitizeIdentifier(schema);
    const safeTable = this.sanitizeIdentifier(table);
    const safePk = this.sanitizeIdentifier(pkCol);

    const keys = Object.keys(data).map((k) => this.sanitizeIdentifier(k));
    if (keys.length === 0) {
      throw new BadRequestException('No fields to update');
    }

    const values = Object.values(data);
    const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');

    values.push(pkVal);
    const pkPlaceholder = `$${values.length}`;

    const sql = `
      UPDATE "${safeSchema}"."${safeTable}"
      SET ${setClauses}
      WHERE "${safePk}" = ${pkPlaceholder}
      RETURNING *;
    `;

    return this.connectionManager.withClient(credentials, async (client) => {
      const res = await client.query(sql, values);
      return res.rows[0];
    });
  }

  /**
   * Delete a record by primary key.
   */
  async deleteRecord(
    credentials: ProjectDbCredentials,
    schema: string,
    table: string,
    pkCol: string,
    pkVal: any,
  ): Promise<void> {
    const safeSchema = this.sanitizeIdentifier(schema);
    const safeTable = this.sanitizeIdentifier(table);
    const safePk = this.sanitizeIdentifier(pkCol);

    const sql = `DELETE FROM "${safeSchema}"."${safeTable}" WHERE "${safePk}" = $1;`;

    await this.connectionManager.withClient(credentials, async (client) => {
      await client.query(sql, [pkVal]);
    });
  }

  /**
   * Execute raw SQL with strict statement timeout.
   */
  async executeQuery(
    credentials: ProjectDbCredentials,
    sql: string,
    timeoutMs = 15000,
  ): Promise<QueryExecutionResult> {
    const trimmed = sql.trim();
    if (!trimmed) {
      throw new BadRequestException('SQL query cannot be empty');
    }

    const startTime = Date.now();

    return this.connectionManager.withClient(credentials, async (client) => {
      // Set local statement timeout for security and performance
      await client.query(`SET LOCAL statement_timeout = ${Math.min(timeoutMs, 60000)};`);

      try {
        const result = await client.query(trimmed);
        const executionTimeMs = Date.now() - startTime;

        // In pg, fields array contains column metadata
        const columns = result.fields ? result.fields.map((f) => f.name) : [];
        const rows = Array.isArray(result.rows) ? result.rows : [];
        const rowCount = typeof result.rowCount === 'number' ? result.rowCount : rows.length;

        return {
          columns,
          rows,
          rowCount,
          executionTimeMs,
        };
      } catch (err: any) {
        this.logger.warn(`SQL Query error: ${err.message}`);
        throw new BadRequestException(err.message);
      }
    });
  }

  async addColumn(
    credentials: ProjectDbCredentials,
    schema: string,
    table: string,
    dto: { name: string; type: string; nullable?: boolean; defaultValue?: string },
  ): Promise<void> {
    const safeSchema = this.sanitizeIdentifier(schema);
    const safeTable = this.sanitizeIdentifier(table);
    const safeCol = this.sanitizeIdentifier(dto.name);
    if (!/^[a-zA-Z0-9_(),\s]+$/.test(dto.type)) {
      throw new BadRequestException('Invalid data type');
    }
    const nullable = dto.nullable !== false;
    const nullClause = nullable ? '' : ' NOT NULL';
    const defaultClause = dto.defaultValue ? ` DEFAULT ${dto.defaultValue}` : '';
    const sql = `ALTER TABLE "${safeSchema}"."${safeTable}" ADD COLUMN "${safeCol}" ${dto.type}${nullClause}${defaultClause};`;

    await this.connectionManager.withClient(credentials, async (client) => {
      await client.query(sql);
    });
  }

  async dropColumn(
    credentials: ProjectDbCredentials,
    schema: string,
    table: string,
    columnName: string,
  ): Promise<void> {
    const safeSchema = this.sanitizeIdentifier(schema);
    const safeTable = this.sanitizeIdentifier(table);
    const safeCol = this.sanitizeIdentifier(columnName);
    const sql = `ALTER TABLE "${safeSchema}"."${safeTable}" DROP COLUMN IF EXISTS "${safeCol}";`;

    await this.connectionManager.withClient(credentials, async (client) => {
      await client.query(sql);
    });
  }

  async listPolicies(
    credentials: ProjectDbCredentials,
    schema: string,
    table: string,
  ): Promise<any[]> {
    const sql = `
      SELECT
        p.policyname AS name,
        p.cmd AS command,
        p.permissive,
        p.roles,
        p.qual AS using_expr,
        p.with_check AS with_check_expr,
        c.relrowsecurity AS rls_enabled
      FROM pg_policies p
      JOIN pg_class c ON c.relname = p.tablename AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $1)
      WHERE p.schemaname = $1 AND p.tablename = $2
      ORDER BY p.policyname;
    `;
    return this.connectionManager.withClient(credentials, async (client) => {
      const result = await client.query(sql, [schema, table]);
      return result.rows;
    });
  }

  async createPolicy(
    credentials: ProjectDbCredentials,
    schema: string,
    table: string,
    dto: { name: string; command: string; using?: string; withCheck?: string },
  ): Promise<void> {
    const safeSchema = this.sanitizeIdentifier(schema);
    const safeTable = this.sanitizeIdentifier(table);
    const safeName = dto.name.replace(/"/g, '""');
    const allowedCmds = ['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE'];
    const cmd = (dto.command || 'ALL').toUpperCase();
    if (!allowedCmds.includes(cmd)) {
      throw new BadRequestException(`Invalid policy command: ${dto.command}`);
    }

    let sql = `CREATE POLICY "${safeName}" ON "${safeSchema}"."${safeTable}" FOR ${cmd}`;
    if (dto.using) sql += ` USING (${dto.using})`;
    if (dto.withCheck) sql += ` WITH CHECK (${dto.withCheck})`;

    await this.connectionManager.withClient(credentials, async (client) => {
      await client.query(sql);
    });
  }

  async dropPolicy(
    credentials: ProjectDbCredentials,
    schema: string,
    table: string,
    policyName: string,
  ): Promise<void> {
    const safeSchema = this.sanitizeIdentifier(schema);
    const safeTable = this.sanitizeIdentifier(table);
    const safeName = policyName.replace(/"/g, '""');
    const sql = `DROP POLICY IF EXISTS "${safeName}" ON "${safeSchema}"."${safeTable}";`;

    await this.connectionManager.withClient(credentials, async (client) => {
      await client.query(sql);
    });
  }

  async setRls(
    credentials: ProjectDbCredentials,
    schema: string,
    table: string,
    enabled: boolean,
    force = false,
  ): Promise<void> {
    const safeSchema = this.sanitizeIdentifier(schema);
    const safeTable = this.sanitizeIdentifier(table);
    const statements = [
      enabled
        ? `ALTER TABLE "${safeSchema}"."${safeTable}" ENABLE ROW LEVEL SECURITY;`
        : `ALTER TABLE "${safeSchema}"."${safeTable}" DISABLE ROW LEVEL SECURITY;`,
    ];

    if (enabled && force) {
      statements.push(`ALTER TABLE "${safeSchema}"."${safeTable}" FORCE ROW LEVEL SECURITY;`);
    } else if (!enabled || !force) {
      statements.push(`ALTER TABLE "${safeSchema}"."${safeTable}" NO FORCE ROW LEVEL SECURITY;`);
    }

    await this.connectionManager.withClient(credentials, async (client) => {
      for (const stmt of statements) {
        await client.query(stmt);
      }
    });
  }

  /**
   * Apply a standardized Universal Multi-Tenant RLS policy template onto a table.
   */
  async applyTenantRlsTemplate(
    credentials: ProjectDbCredentials,
    schema: string,
    table: string,
    options: {
      template: 'tenant_isolation' | 'tenant_rbac' | 'public_read_tenant_write' | 'global_read';
      tenantColumn?: string;
      resourceName?: string;
    },
  ): Promise<{ appliedPolicies: string[] }> {
    const safeSchema = this.sanitizeIdentifier(schema);
    const safeTable = this.sanitizeIdentifier(table);
    const tenantCol = this.sanitizeIdentifier(options.tenantColumn || 'tenant_id');
    const resourceName = (options.resourceName || safeTable).replace(/'/g, "''");

    return this.connectionManager.withClient(credentials, async (client) => {
      await client.query(`ALTER TABLE "${safeSchema}"."${safeTable}" ENABLE ROW LEVEL SECURITY;`);

      // Grant runtime table permissions cleanly so PostgreSQL evaluates RLS policies instead of blocking at table level
      await client.query(`
        DO $$
        DECLARE r RECORD;
        BEGIN
          FOR r IN SELECT rolname FROM pg_roles WHERE rolname = 'authenticated' OR rolname LIKE 'proj_%_authenticated' LOOP
            EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${safeSchema}"."${safeTable}" TO %I', r.rolname);
          END LOOP;
          FOR r IN SELECT rolname FROM pg_roles WHERE rolname = 'anon' OR rolname LIKE 'proj_%_anon' LOOP
            EXECUTE format('GRANT SELECT ON TABLE "${safeSchema}"."${safeTable}" TO %I', r.rolname);
          END LOOP;
        EXCEPTION WHEN OTHERS THEN NULL;
        END $$;
      `).catch(() => {});

      const appliedPolicies: string[] = [];

      const createOrReplace = async (name: string, cmd: string, expr: string, isCheckOnly = false) => {
        const safeName = name.replace(/"/g, '""');
        await client.query(`DROP POLICY IF EXISTS "${safeName}" ON "${safeSchema}"."${safeTable}";`);
        const clause = isCheckOnly ? `WITH CHECK (${expr})` : cmd === 'UPDATE' ? `USING (${expr}) WITH CHECK (${expr})` : `USING (${expr})`;
        await client.query(`CREATE POLICY "${safeName}" ON "${safeSchema}"."${safeTable}" FOR ${cmd} ${clause};`);
        appliedPolicies.push(safeName);
      };

      if (options.template === 'tenant_isolation') {
        await createOrReplace(
          `${safeTable}_tenant_select`,
          'SELECT',
          `auth.is_service_role() OR ("${tenantCol}" = auth.tenant_id() AND auth.is_tenant_member())`,
        );
        await createOrReplace(
          `${safeTable}_tenant_insert`,
          'INSERT',
          `auth.is_service_role() OR ("${tenantCol}" = auth.tenant_id() AND auth.is_tenant_member())`,
          true,
        );
        await createOrReplace(
          `${safeTable}_tenant_update`,
          'UPDATE',
          `auth.is_service_role() OR ("${tenantCol}" = auth.tenant_id() AND auth.is_tenant_member())`,
        );
        await createOrReplace(
          `${safeTable}_tenant_delete`,
          'DELETE',
          `auth.is_service_role() OR ("${tenantCol}" = auth.tenant_id() AND auth.is_tenant_member())`,
        );
      } else if (options.template === 'tenant_rbac') {
        await createOrReplace(
          `${safeTable}_rbac_select`,
          'SELECT',
          `auth.is_service_role() OR ("${tenantCol}" = auth.tenant_id() AND auth.has_permission('${resourceName}', 'read'))`,
        );
        await createOrReplace(
          `${safeTable}_rbac_insert`,
          'INSERT',
          `auth.is_service_role() OR ("${tenantCol}" = auth.tenant_id() AND auth.has_permission('${resourceName}', 'create'))`,
          true,
        );
        await createOrReplace(
          `${safeTable}_rbac_update`,
          'UPDATE',
          `auth.is_service_role() OR ("${tenantCol}" = auth.tenant_id() AND auth.has_permission('${resourceName}', 'update'))`,
        );
        await createOrReplace(
          `${safeTable}_rbac_delete`,
          'DELETE',
          `auth.is_service_role() OR ("${tenantCol}" = auth.tenant_id() AND auth.has_permission('${resourceName}', 'delete'))`,
        );
      } else if (options.template === 'public_read_tenant_write') {
        await createOrReplace(`${safeTable}_public_select`, 'SELECT', `TRUE`);
        await createOrReplace(
          `${safeTable}_tenant_insert`,
          'INSERT',
          `auth.is_service_role() OR ("${tenantCol}" = auth.tenant_id() AND auth.is_tenant_member())`,
          true,
        );
        await createOrReplace(
          `${safeTable}_tenant_update`,
          'UPDATE',
          `auth.is_service_role() OR ("${tenantCol}" = auth.tenant_id() AND auth.is_tenant_member())`,
        );
        await createOrReplace(
          `${safeTable}_tenant_delete`,
          'DELETE',
          `auth.is_service_role() OR ("${tenantCol}" = auth.tenant_id() AND auth.is_tenant_member())`,
        );
      } else if (options.template === 'global_read') {
        await createOrReplace(`${safeTable}_global_read`, 'SELECT', `auth.uid() IS NOT NULL OR auth.is_service_role()`);
      }

      return { appliedPolicies };
    });
  }
}
