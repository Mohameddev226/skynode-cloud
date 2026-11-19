import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service';
import { ProjectConnectionManager } from '../database-studio/project-connection.manager';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class ApiGatewayService {
  private readonly logger = new Logger(ApiGatewayService.name);

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly connectionManager: ProjectConnectionManager,
    private readonly realtimeService: RealtimeService,
  ) {}

  private sanitizeIdentifier(name: string): string {
    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
      throw new BadRequestException(`Invalid identifier: ${name}`);
    }
    return name;
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
        .map((s) => s.trim());
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

  /**
   * PostgREST style GET querying with filters, ordering, pagination, select
   */
  async getRows(
    identifier: string,
    schema = 'public',
    tableName: string,
    queryParams: Record<string, any>,
    apiKey?: string,
  ) {
    const creds = await this.projectsService.getProjectCredentialsByRef(identifier);
    const safeSchema = this.sanitizeIdentifier(schema);
    const safeTable = this.sanitizeIdentifier(tableName);

    // Columns selection
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

    // Build WHERE clauses
    const whereClauses: string[] = [];
    const values: any[] = [];
    const reservedKeys = new Set(['select', 'limit', 'offset', 'order', 'schema', 'pk', 'apikey']);

    for (const [key, val] of Object.entries(queryParams)) {
      if (reservedKeys.has(key) || typeof val !== 'string') continue;
      const clause = this.parseFilterOperator(key, val, values);
      if (clause) whereClauses.push(clause);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Ordering
    let orderSql = '';
    if (queryParams.order && typeof queryParams.order === 'string') {
      const parts = queryParams.order.split('.');
      const col = parts[0]?.trim();
      const dir = parts[1]?.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      if (col) {
        orderSql = `ORDER BY "${this.sanitizeIdentifier(col)}" ${dir}`;
      }
    }

    // Pagination
    const limit = Math.min(Math.max(parseInt(queryParams.limit ?? '100', 10) || 100, 1), 1000);
    const offset = Math.max(parseInt(queryParams.offset ?? '0', 10) || 0, 0);

    return this.connectionManager.withClient(creds, async (client) => {
      // Execute query
      const sql = `
        SELECT ${colSql}
        FROM "${safeSchema}"."${safeTable}"
        ${whereSql}
        ${orderSql}
        LIMIT ${limit} OFFSET ${offset};
      `;

      // Count query
      const countSql = `
        SELECT count(*)::int AS total
        FROM "${safeSchema}"."${safeTable}"
        ${whereSql};
      `;

      const [rowsRes, countRes] = await Promise.all([
        client.query(sql, values),
        client.query(countSql, values),
      ]);

      return {
        data: rowsRes.rows,
        total: countRes.rows[0]?.total ?? rowsRes.rowCount ?? 0,
        limit,
        offset,
      };
    });
  }

  /**
   * Get single record by ID / primary key
   */
  async getRowById(
    identifier: string,
    schema = 'public',
    tableName: string,
    id: string,
    pkCol = 'id',
  ) {
    const creds = await this.projectsService.getProjectCredentialsByRef(identifier);
    const safeSchema = this.sanitizeIdentifier(schema);
    const safeTable = this.sanitizeIdentifier(tableName);
    const safePk = this.sanitizeIdentifier(pkCol);

    return this.connectionManager.withClient(creds, async (client) => {
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
    });
  }

  /**
   * Insert record or bulk records
   */
  async insertRow(
    identifier: string,
    schema = 'public',
    tableName: string,
    payload: Record<string, any> | Record<string, any>[],
  ) {
    const creds = await this.projectsService.getProjectCredentialsByRef(identifier);
    const safeSchema = this.sanitizeIdentifier(schema);
    const safeTable = this.sanitizeIdentifier(tableName);

    const items = Array.isArray(payload) ? payload : [payload];
    if (items.length === 0) throw new BadRequestException('Insert payload cannot be empty');

    return this.connectionManager.withClient(creds, async (client) => {
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
        const inserted = res.rows[0];
        results.push(inserted);

        // Realtime Broadcast
        this.realtimeService.broadcast({
          project: creds.ref,
          schema: safeSchema,
          table: safeTable,
          eventType: 'INSERT',
          record: inserted,
        });
      }

      return Array.isArray(payload) ? results : results[0];
    });
  }

  /**
   * Update record by ID / primary key
   */
  async updateRow(
    identifier: string,
    schema = 'public',
    tableName: string,
    id: string,
    pkCol = 'id',
    data: Record<string, any>,
  ) {
    const creds = await this.projectsService.getProjectCredentialsByRef(identifier);
    const safeSchema = this.sanitizeIdentifier(schema);
    const safeTable = this.sanitizeIdentifier(tableName);
    const safePk = this.sanitizeIdentifier(pkCol);

    const keys = Object.keys(data).map((k) => this.sanitizeIdentifier(k));
    if (keys.length === 0) throw new BadRequestException('No fields provided to update');

    return this.connectionManager.withClient(creds, async (client) => {
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
      const updated = res.rows[0];

      // Realtime Broadcast
      this.realtimeService.broadcast({
        project: creds.ref,
        schema: safeSchema,
        table: safeTable,
        eventType: 'UPDATE',
        record: updated,
        oldRecord: { [pkCol]: id },
      });

      return updated;
    });
  }

  /**
   * Delete record by ID / primary key
   */
  async deleteRow(
    identifier: string,
    schema = 'public',
    tableName: string,
    id: string,
    pkCol = 'id',
  ) {
    const creds = await this.projectsService.getProjectCredentialsByRef(identifier);
    const safeSchema = this.sanitizeIdentifier(schema);
    const safeTable = this.sanitizeIdentifier(tableName);
    const safePk = this.sanitizeIdentifier(pkCol);

    return this.connectionManager.withClient(creds, async (client) => {
      const sql = `
        DELETE FROM "${safeSchema}"."${safeTable}"
        WHERE "${safePk}" = $1
        RETURNING *;
      `;

      const res = await client.query(sql, [id]);
      const deleted = res.rows[0] ?? { [pkCol]: id };

      // Realtime Broadcast
      this.realtimeService.broadcast({
        project: creds.ref,
        schema: safeSchema,
        table: safeTable,
        eventType: 'DELETE',
        record: deleted,
        oldRecord: { [pkCol]: id },
      });

      return { success: true, deletedRecord: deleted };
    });
  }
}
