import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ProjectConnectionManager } from '../database-studio/project-connection.manager';
import { RealtimeService } from '../realtime/realtime.service';
import type { ResolvedApiContext } from './guards/tenant-api.guard';

@Injectable()
export class ApiGatewayService {
  private readonly logger = new Logger(ApiGatewayService.name);

  constructor(
    private readonly connectionManager: ProjectConnectionManager,
    private readonly realtimeService: RealtimeService,
  ) {}

  private sanitizeIdentifier(name: string): string {
    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
      throw new BadRequestException(`Invalid identifier: ${name}`);
    }
    return name;
  }

  private validateSchemaAccess(schema: string, apiRole: ResolvedApiContext['apiRole']): string {
    const safeSchema = this.sanitizeIdentifier(schema);
    const blockedAlways = new Set(['pg_catalog', 'information_schema', 'pg_toast']);
    if (blockedAlways.has(safeSchema.toLowerCase())) {
      throw new ForbiddenException(`Access to system schema "${safeSchema}" is denied`);
    }

    const restrictedSchemas = new Set(['auth', 'storage']);
    if (restrictedSchemas.has(safeSchema.toLowerCase()) && apiRole !== 'service_role') {
      throw new ForbiddenException(
        `Direct REST access to internal schema "${safeSchema}" requires service_role privileges`,
      );
    }

    return safeSchema;
  }

  private handlePgError(err: any): never {
    if (err instanceof ForbiddenException || err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ConflictException) {
      throw err;
    }

    const code = err?.code;
    if (code === '42501') {
      throw new ForbiddenException(
        err?.message || 'Permission or row-level security (RLS) policy violation',
      );
    }
    if (code === '23505') {
      throw new ConflictException(err?.detail || err?.message || 'Unique constraint violation');
    }
    if (code === '23503' || code === '23502' || code === '23514' || code === '22P02') {
      throw new BadRequestException(err?.detail || err?.message || 'Invalid database input');
    }
    if (code === '42P01') {
      throw new NotFoundException(err?.message || 'Target table does not exist');
    }

    throw err;
  }

  private parseFilterOperator(
    col: string,
    rawVal: string,
    values: any[],
  ): string | null {
    const safeCol = `"${this.sanitizeIdentifier(col)}"`;

    if (rawVal === 'is.null') {
      return `${safeCol} IS NULL`;
    }
    if (rawVal === 'is.not.null') {
      return `${safeCol} IS NOT NULL`;
    }

    if (rawVal.startsWith('eq.')) {
      values.push(rawVal.slice(3));
      return `${safeCol} = $${values.length}`;
    }
    if (rawVal.startsWith('neq.')) {
      values.push(rawVal.slice(4));
      return `${safeCol} != $${values.length}`;
    }
    if (rawVal.startsWith('gt.')) {
      values.push(rawVal.slice(3));
      return `${safeCol} > $${values.length}`;
    }
    if (rawVal.startsWith('gte.')) {
      values.push(rawVal.slice(4));
      return `${safeCol} >= $${values.length}`;
    }
    if (rawVal.startsWith('lt.')) {
      values.push(rawVal.slice(3));
      return `${safeCol} < $${values.length}`;
    }
    if (rawVal.startsWith('lte.')) {
      values.push(rawVal.slice(4));
      return `${safeCol} <= $${values.length}`;
    }
    if (rawVal.startsWith('like.')) {
      values.push(rawVal.slice(5));
      return `${safeCol} LIKE $${values.length}`;
    }
    if (rawVal.startsWith('ilike.')) {
      values.push(rawVal.slice(6));
      return `${safeCol} ILIKE $${values.length}`;
    }
    if (rawVal.startsWith('in.(') && rawVal.endsWith(')')) {
      const items = rawVal
        .slice(4, -1)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (items.length === 0) return null;
      const placeholders = items.map((item) => {
        values.push(item);
        return `$${values.length}`;
      });
      return `${safeCol} IN (${placeholders.join(', ')})`;
    }

    // Default: treat as exact equality
    values.push(rawVal);
    return `${safeCol} = $${values.length}`;
  }

  private buildWhereClause(queryParams: Record<string, any>, values: any[]): string {
    const whereClauses: string[] = [];
    const reservedKeys = new Set(['select', 'limit', 'offset', 'order', 'schema', 'pk', 'apikey']);

    for (const [key, val] of Object.entries(queryParams)) {
      if (reservedKeys.has(key) || typeof val !== 'string') continue;
      const clause = this.parseFilterOperator(key, val, values);
      if (clause) whereClauses.push(clause);
    }

    return whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  }

  /**
   * PostgREST style GET querying with filters, ordering, pagination, select, and strict RLS enforcement.
   */
  async getRows(
    ctx: ResolvedApiContext,
    schema = 'public',
    tableName: string,
    queryParams: Record<string, any>,
  ) {
    const safeSchema = this.validateSchemaAccess(schema, ctx.apiRole);
    const safeTable = this.sanitizeIdentifier(tableName);

    let colSql = '*';
    if (queryParams.select && typeof queryParams.select === 'string') {
      const cols = queryParams.select
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      if (cols.length > 0 && cols[0] !== '*') {
        colSql = cols.map((c) => `"${this.sanitizeIdentifier(c)}"`).join(', ');
      }
    }

    const values: any[] = [];
    const whereSql = this.buildWhereClause(queryParams, values);

    let orderSql = '';
    if (queryParams.order && typeof queryParams.order === 'string') {
      const parts = queryParams.order.split('.');
      const col = parts[0]?.trim();
      const dir = parts[1]?.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      if (col) {
        orderSql = `ORDER BY "${this.sanitizeIdentifier(col)}" ${dir}`;
      }
    }

    const limit = Math.min(Math.max(parseInt(queryParams.limit ?? '100', 10) || 100, 1), 1000);
    const offset = Math.max(parseInt(queryParams.offset ?? '0', 10) || 0, 0);

    try {
      return await this.connectionManager.withTenantTransaction(
        ctx.creds,
        ctx.projectRef,
        ctx,
        async (client) => {
          const sql = `
            SELECT ${colSql}
            FROM "${safeSchema}"."${safeTable}"
            ${whereSql}
            ${orderSql}
            LIMIT ${limit} OFFSET ${offset};
          `;

          const countSql = `
            SELECT count(*)::int AS total
            FROM "${safeSchema}"."${safeTable}"
            ${whereSql};
          `;

          const rowsRes = await client.query(sql, values);
          const countRes = await client.query(countSql, values);

          return {
            data: rowsRes.rows,
            total: countRes.rows[0]?.total ?? rowsRes.rowCount ?? 0,
            limit,
            offset,
          };
        },
      );
    } catch (err) {
      this.handlePgError(err);
    }
  }

  /**
   * Get single record by ID / primary key with strict RLS enforcement.
   */
  async getRowById(
    ctx: ResolvedApiContext,
    schema = 'public',
    tableName: string,
    id: string,
    pkCol = 'id',
  ) {
    const safeSchema = this.validateSchemaAccess(schema, ctx.apiRole);
    const safeTable = this.sanitizeIdentifier(tableName);
    const safePk = this.sanitizeIdentifier(pkCol);

    try {
      return await this.connectionManager.withTenantTransaction(
        ctx.creds,
        ctx.projectRef,
        ctx,
        async (client) => {
          const sql = `
            SELECT *
            FROM "${safeSchema}"."${safeTable}"
            WHERE "${safePk}" = $1
            LIMIT 1;
          `;
          const res = await client.query(sql, [id]);
          if (res.rows.length === 0) {
            throw new NotFoundException(`Record with ${pkCol}=${id} not found in ${tableName}`);
          }
          return res.rows[0];
        },
      );
    } catch (err) {
      this.handlePgError(err);
    }
  }

  /**
   * Insert record or bulk records inside an RLS-enforced transaction.
   */
  async insertRow(
    ctx: ResolvedApiContext,
    schema = 'public',
    tableName: string,
    payload: Record<string, any> | Record<string, any>[],
  ) {
    const safeSchema = this.validateSchemaAccess(schema, ctx.apiRole);
    const safeTable = this.sanitizeIdentifier(tableName);

    const items = Array.isArray(payload) ? payload : [payload];
    if (items.length === 0) throw new BadRequestException('Insert payload cannot be empty');

    try {
      const insertedRecords = await this.connectionManager.withTenantTransaction(
        ctx.creds,
        ctx.projectRef,
        ctx,
        async (client) => {
          const results: any[] = [];

          for (const item of items) {
            const keys = Object.keys(item).map((k) => this.sanitizeIdentifier(k));
            if (keys.length === 0) continue;

            const values = Object.values(item);
            const colList = keys.map((k) => `"${k}"`).join(', ');
            const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

            const sql = `
              INSERT INTO "${safeSchema}"."${safeTable}" (${colList})
              VALUES (${placeholders})
              RETURNING *;
            `;

            const res = await client.query(sql, values);
            results.push(res.rows[0]);
          }

          return results;
        },
      );

      // Broadcast after transaction commit so subscribers never observe uncommitted rollbacks
      for (const inserted of insertedRecords) {
        const recordTenantId =
          typeof inserted?.tenant_id === 'string' ? inserted.tenant_id : ctx.tenantId ?? null;
        this.realtimeService.broadcast({
          project: ctx.projectRef,
          tenantId: recordTenantId,
          schema: safeSchema,
          table: safeTable,
          eventType: 'INSERT',
          record: inserted,
        });
      }

      return Array.isArray(payload) ? insertedRecords : insertedRecords[0];
    } catch (err) {
      this.handlePgError(err);
    }
  }

  /**
   * Update record by ID / primary key inside an RLS-enforced transaction.
   */
  async updateRow(
    ctx: ResolvedApiContext,
    schema = 'public',
    tableName: string,
    id: string,
    pkCol = 'id',
    data: Record<string, any>,
  ) {
    const safeSchema = this.validateSchemaAccess(schema, ctx.apiRole);
    const safeTable = this.sanitizeIdentifier(tableName);
    const safePk = this.sanitizeIdentifier(pkCol);

    const keys = Object.keys(data).map((k) => this.sanitizeIdentifier(k));
    if (keys.length === 0) throw new BadRequestException('No fields provided to update');

    try {
      const updated = await this.connectionManager.withTenantTransaction(
        ctx.creds,
        ctx.projectRef,
        ctx,
        async (client) => {
          const values = Object.values(data);
          const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
          values.push(id);
          const pkPlaceholder = `$${values.length}`;

          const sql = `
            UPDATE "${safeSchema}"."${safeTable}"
            SET ${setClauses}
            WHERE "${safePk}" = ${pkPlaceholder}
            RETURNING *;
          `;

          const res = await client.query(sql, values);
          if (res.rows.length === 0) {
            throw new NotFoundException(`Record with ${pkCol}=${id} not found in ${tableName}`);
          }
          return res.rows[0];
        },
      );

      const recordTenantId =
        typeof updated?.tenant_id === 'string' ? updated.tenant_id : ctx.tenantId ?? null;
      this.realtimeService.broadcast({
        project: ctx.projectRef,
        tenantId: recordTenantId,
        schema: safeSchema,
        table: safeTable,
        eventType: 'UPDATE',
        record: updated,
        oldRecord: { [pkCol]: id },
      });

      return updated;
    } catch (err) {
      this.handlePgError(err);
    }
  }

  /**
   * Update records matching PostgREST filters (e.g. PATCH /rest/v1/fuel_sales?id=eq.123).
   */
  async updateRowsByFilter(
    ctx: ResolvedApiContext,
    schema = 'public',
    tableName: string,
    queryParams: Record<string, any>,
    data: Record<string, any>,
  ) {
    const safeSchema = this.validateSchemaAccess(schema, ctx.apiRole);
    const safeTable = this.sanitizeIdentifier(tableName);

    const keys = Object.keys(data).map((k) => this.sanitizeIdentifier(k));
    if (keys.length === 0) throw new BadRequestException('No fields provided to update');

    const values = Object.values(data);
    const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
    const whereSql = this.buildWhereClause(queryParams, values);
    if (!whereSql) {
      throw new BadRequestException('Bulk UPDATE requires at least one filter query parameter');
    }

    try {
      const updatedRows = await this.connectionManager.withTenantTransaction(
        ctx.creds,
        ctx.projectRef,
        ctx,
        async (client) => {
          const sql = `
            UPDATE "${safeSchema}"."${safeTable}"
            SET ${setClauses}
            ${whereSql}
            RETURNING *;
          `;
          const res = await client.query(sql, values);
          return res.rows;
        },
      );

      for (const updated of updatedRows) {
        const recordTenantId =
          typeof updated?.tenant_id === 'string' ? updated.tenant_id : ctx.tenantId ?? null;
        this.realtimeService.broadcast({
          project: ctx.projectRef,
          tenantId: recordTenantId,
          schema: safeSchema,
          table: safeTable,
          eventType: 'UPDATE',
          record: updated,
        });
      }

      return updatedRows;
    } catch (err) {
      this.handlePgError(err);
    }
  }

  /**
   * Delete record by ID / primary key inside an RLS-enforced transaction.
   * Rejects with 404 NotFoundException if 0 rows matched (e.g., hidden by RLS).
   */
  async deleteRow(
    ctx: ResolvedApiContext,
    schema = 'public',
    tableName: string,
    id: string,
    pkCol = 'id',
  ) {
    const safeSchema = this.validateSchemaAccess(schema, ctx.apiRole);
    const safeTable = this.sanitizeIdentifier(tableName);
    const safePk = this.sanitizeIdentifier(pkCol);

    try {
      const deleted = await this.connectionManager.withTenantTransaction(
        ctx.creds,
        ctx.projectRef,
        ctx,
        async (client) => {
          const sql = `
            DELETE FROM "${safeSchema}"."${safeTable}"
            WHERE "${safePk}" = $1
            RETURNING *;
          `;

          const res = await client.query(sql, [id]);
          if (res.rows.length === 0) {
            throw new NotFoundException(`Record with ${pkCol}=${id} not found in ${tableName}`);
          }
          return res.rows[0];
        },
      );

      const recordTenantId =
        typeof deleted?.tenant_id === 'string' ? deleted.tenant_id : ctx.tenantId ?? null;
      this.realtimeService.broadcast({
        project: ctx.projectRef,
        tenantId: recordTenantId,
        schema: safeSchema,
        table: safeTable,
        eventType: 'DELETE',
        record: deleted,
        oldRecord: { [pkCol]: id },
      });

      return { success: true, deletedRecord: deleted };
    } catch (err) {
      this.handlePgError(err);
    }
  }

  /**
   * Delete records matching PostgREST filters inside an RLS-enforced transaction.
   */
  async deleteRowsByFilter(
    ctx: ResolvedApiContext,
    schema = 'public',
    tableName: string,
    queryParams: Record<string, any>,
  ) {
    const safeSchema = this.validateSchemaAccess(schema, ctx.apiRole);
    const safeTable = this.sanitizeIdentifier(tableName);

    const values: any[] = [];
    const whereSql = this.buildWhereClause(queryParams, values);
    if (!whereSql) {
      throw new BadRequestException('Bulk DELETE requires at least one filter query parameter');
    }

    try {
      const deletedRows = await this.connectionManager.withTenantTransaction(
        ctx.creds,
        ctx.projectRef,
        ctx,
        async (client) => {
          const sql = `
            DELETE FROM "${safeSchema}"."${safeTable}"
            ${whereSql}
            RETURNING *;
          `;
          const res = await client.query(sql, values);
          return res.rows;
        },
      );

      for (const deleted of deletedRows) {
        const recordTenantId =
          typeof deleted?.tenant_id === 'string' ? deleted.tenant_id : ctx.tenantId ?? null;
        this.realtimeService.broadcast({
          project: ctx.projectRef,
          tenantId: recordTenantId,
          schema: safeSchema,
          table: safeTable,
          eventType: 'DELETE',
          record: deleted,
        });
      }

      return { success: true, deletedCount: deletedRows.length, deletedRecords: deletedRows };
    } catch (err) {
      this.handlePgError(err);
    }
  }
}
