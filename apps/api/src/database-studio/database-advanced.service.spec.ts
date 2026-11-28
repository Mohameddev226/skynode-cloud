import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DatabaseAdvancedService } from './database-advanced.service';
import { ProjectConnectionManager, ProjectDbCredentials } from './project-connection.manager';

describe('DatabaseAdvancedService (Phase 5)', () => {
  let service: DatabaseAdvancedService;

  const mockCredentials: ProjectDbCredentials = {
    host: 'localhost',
    port: 5432,
    database: 'skynode_proj_test',
    user: 'test_user',
    password: 'test_password',
  };

  const mockClient = {
    query: jest.fn(),
  };

  const mockConnectionManager = {
    withClient: jest.fn((_creds: any, cb: (client: any) => Promise<any>) => cb(mockClient)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseAdvancedService,
        { provide: ProjectConnectionManager, useValue: mockConnectionManager },
      ],
    }).compile();

    service = module.get<DatabaseAdvancedService>(DatabaseAdvancedService);
  });

  it('lists and creates user schemas while rejecting system schemas', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [{ name: 'public', owner: 'postgres', tableCount: 3 }],
    });
    const schemas = await service.listSchemas(mockCredentials);
    expect(schemas).toHaveLength(1);
    expect(schemas[0]?.name).toBe('public');

    await expect(service.createSchema(mockCredentials, 'pg_catalog')).rejects.toThrow(
      BadRequestException,
    );

    mockClient.query.mockResolvedValue({});
    const created = await service.createSchema(mockCredentials, 'analytics');
    expect(created.name).toBe('analytics');
    expect(mockClient.query).toHaveBeenCalledWith('CREATE SCHEMA IF NOT EXISTS "analytics";');
  });

  it('renames tables and alters columns transactionally', async () => {
    mockClient.query.mockResolvedValue({});
    const renamed = await service.renameTable(mockCredentials, 'public', 'orders', 'fuel_orders');
    expect(renamed.newName).toBe('fuel_orders');
    expect(mockClient.query).toHaveBeenCalledWith(
      'ALTER TABLE "public"."orders" RENAME TO "fuel_orders";',
    );

    jest.clearAllMocks();
    mockClient.query.mockResolvedValue({});
    const altered = await service.alterColumn(mockCredentials, 'public', 'fuel_orders', 'amount', {
      newName: 'total_amount',
      type: 'numeric(12,2)',
      nullable: false,
      defaultValue: '0',
    });

    expect(altered.column).toBe('total_amount');
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('ALTER COLUMN "amount" TYPE numeric(12,2)'),
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('RENAME COLUMN "amount" TO "total_amount"'),
    );
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('creates unique/standard indexes and foreign keys safely', async () => {
    mockClient.query.mockResolvedValue({});
    const idx = await service.createIndex(mockCredentials, 'public', 'fuel_orders', {
      name: 'idx_fuel_orders_tenant',
      columns: ['tenant_id'],
      unique: true,
      method: 'btree',
    });
    expect(idx.name).toBe('idx_fuel_orders_tenant');
    expect(mockClient.query).toHaveBeenCalledWith(
      'CREATE UNIQUE INDEX "idx_fuel_orders_tenant" ON "public"."fuel_orders" USING btree ("tenant_id");',
    );

    const fk = await service.createForeignKey(mockCredentials, 'public', 'fuel_orders', {
      column: 'station_id',
      referencedSchema: 'public',
      referencedTable: 'stations',
      referencedColumn: 'id',
      onDelete: 'CASCADE',
    });
    expect(fk.name).toBe('fk_fuel_orders_station_id_stations');
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('FOREIGN KEY ("station_id")'),
    );
  });

  it('runs migrations with rollback protection', async () => {
    const appliedRow = {
      id: 1,
      version: '202611280001',
      name: 'create_branches',
      up_sql: 'CREATE TABLE public.branches (id uuid PRIMARY KEY);',
      down_sql: 'DROP TABLE IF EXISTS public.branches;',
      status: 'APPLIED',
      applied_at: new Date(),
      rolled_back_at: null,
      created_at: new Date(),
    };

    mockClient.query
      .mockResolvedValueOnce({}) // ensureMigrationsTable
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // up_sql
      .mockResolvedValueOnce({ rows: [appliedRow] }) // INSERT migration
      .mockResolvedValueOnce({}); // COMMIT

    const created = await service.createMigration(mockCredentials, {
      name: 'Create Branches',
      upSql: appliedRow.up_sql,
      downSql: appliedRow.down_sql,
      applyNow: true,
    });
    expect(created.status).toBe('APPLIED');

    // Double apply should throw ConflictException
    mockClient.query
      .mockResolvedValueOnce({}) // ensureMigrationsTable
      .mockResolvedValueOnce({ rows: [appliedRow] });
    await expect(service.applyMigration(mockCredentials, '1')).rejects.toThrow(ConflictException);

    // Missing migration throws NotFoundException
    mockClient.query
      .mockResolvedValueOnce({}) // ensureMigrationsTable
      .mockResolvedValueOnce({ rows: [] });
    await expect(service.rollbackMigration(mockCredentials, '999')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('gracefully handles unavailable pg_stat_statements in getPerformanceStats', async () => {
    mockClient.query
      .mockResolvedValueOnce({
        rows: [
          {
            schema: 'public',
            table: 'fuel_sales',
            liveRows: '100',
            deadRows: '5',
            seqScans: '2',
            idxScans: '50',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ activeConnections: 3, cacheHitRatio: '99.5', databaseSizeBytes: '409600' }],
      })
      .mockRejectedValueOnce(new Error('relation "pg_stat_statements" does not exist'));

    const stats = await service.getPerformanceStats(mockCredentials);
    expect(stats.pgStatStatementsAvailable).toBe(false);
    expect(stats.slowQueries).toEqual([]);
    expect(stats.summary.activeConnections).toBe(3);
    expect(stats.tables[0]?.liveRows).toBe(100);
  });

  it('executes VACUUM and ANALYZE maintenance commands outside transactions', async () => {
    mockClient.query.mockResolvedValue({});
    const res = await service.runMaintenance(mockCredentials, {
      action: 'vacuum',
      schema: 'public',
      table: 'fuel_sales',
    });
    expect(res.message).toContain('VACUUM completed');
    expect(mockClient.query).toHaveBeenCalledWith('VACUUM "public"."fuel_sales";');
  });
});
