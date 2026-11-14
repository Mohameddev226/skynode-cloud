import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseStudioService } from './database-studio.service';
import { ProjectConnectionManager, ProjectDbCredentials } from './project-connection.manager';
import { BadRequestException } from '@nestjs/common';

describe('DatabaseStudioService', () => {
  let service: DatabaseStudioService;

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
    withClient: jest.fn((creds, callback) => callback(mockClient)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseStudioService,
        { provide: ProjectConnectionManager, useValue: mockConnectionManager },
      ],
    }).compile();

    service = module.get<DatabaseStudioService>(DatabaseStudioService);
  });

  describe('getTables', () => {
    it('should query information_schema and return table summaries', async () => {
      mockClient.query.mockResolvedValue({
        rows: [
          { name: 'users', schema: 'public', rowCount: '42', sizeBytes: '16384' },
          { name: 'posts', schema: 'public', rowCount: '100', sizeBytes: '32768' },
        ],
      });

      const tables = await service.getTables(mockCredentials);

      expect(tables).toHaveLength(2);
      expect(tables[0]).toEqual({
        name: 'users',
        schema: 'public',
        rowCount: 42,
        sizeBytes: 16384,
      });
      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('information_schema.tables'));
    });
  });

  describe('createTable', () => {
    it('should generate proper CREATE TABLE statement with columns and primary keys', async () => {
      mockClient.query.mockResolvedValue({});

      await service.createTable(mockCredentials, {
        name: 'products',
        schema: 'public',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, isNullable: false, defaultValue: 'gen_random_uuid()' },
          { name: 'title', type: 'text', isNullable: false },
          { name: 'price', type: 'numeric', defaultValue: '0.00' },
        ],
      });

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE "public"."products"'),
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('PRIMARY KEY ("id")'),
      );
    });

    it('should throw BadRequestException for invalid table or column names', async () => {
      await expect(
        service.createTable(mockCredentials, {
          name: 'invalid; DROP TABLE users;--',
          columns: [{ name: 'id', type: 'uuid' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getTableRecords', () => {
    it('should query total count and paginated records with ordering', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ count: 120 }] }) // count query
        .mockResolvedValueOnce({ rows: [{ id: '1', title: 'Item 1' }, { id: '2', title: 'Item 2' }] }); // data query

      const result = await service.getTableRecords(mockCredentials, 'public', 'products', {
        page: 2,
        limit: 10,
        sortBy: 'title',
        sortOrder: 'asc',
      });

      expect(result.total).toBe(120);
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.rows).toHaveLength(2);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY "title" ASC'),
        [10, 10], // limit 10, offset (2-1)*10 = 10
      );
    });
  });

  describe('insertRecord', () => {
    it('should construct parameterized INSERT statement and return created record', async () => {
      const newRecord = { title: 'New Product', price: 99.99 };
      mockClient.query.mockResolvedValue({
        rows: [{ id: 'uuid-1', ...newRecord }],
      });

      const res = await service.insertRecord(mockCredentials, 'public', 'products', newRecord);

      expect(res.id).toBe('uuid-1');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO "public"."products"'),
        ['New Product', 99.99],
      );
    });
  });

  describe('executeQuery', () => {
    it('should set statement timeout and return columns, rows, and execution time', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({
          fields: [{ name: 'id' }, { name: 'email' }],
          rows: [{ id: '1', email: 'alice@example.com' }],
          rowCount: 1,
        });

      const res = await service.executeQuery(mockCredentials, 'SELECT id, email FROM users;', 10000);

      expect(res.columns).toEqual(['id', 'email']);
      expect(res.rows).toHaveLength(1);
      expect(res.rowCount).toBe(1);
      expect(res.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('statement_timeout'));
    });

    it('should reject empty SQL query', async () => {
      await expect(service.executeQuery(mockCredentials, '   ')).rejects.toThrow(BadRequestException);
    });
  });
});
