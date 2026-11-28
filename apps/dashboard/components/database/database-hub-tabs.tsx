'use client';

import * as React from 'react';
import {
  Plus,
  Trash2,
  GitBranch,
  KeyRound,
  Link2,
  Puzzle,
  Activity,
  Code2,
  Zap,
  RotateCcw,
  Play,
  Search,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/shared/empty-state';
import api from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';

export interface TableItem {
  name: string;
  schema: string;
  rowCount: number;
  sizeBytes: number;
}

export interface IndexRecord {
  name: string;
  schema: string;
  table: string;
  definition: string;
  isUnique: boolean;
  isPrimary: boolean;
  sizeBytes: number;
  scans: number;
}

export interface ForeignKeyRecord {
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

export interface MigrationItem {
  id: number;
  version: string;
  name: string;
  up_sql: string;
  down_sql: string | null;
  status: 'PENDING' | 'APPLIED' | 'ROLLED_BACK';
  applied_at: string | null;
  rolled_back_at: string | null;
  created_at: string;
}

export interface ExtensionItem {
  name: string;
  defaultVersion: string;
  installedVersion: string | null;
  comment: string | null;
}

export interface FunctionItem {
  name: string;
  schema: string;
  arguments: string;
  returnType: string;
  language: string;
  securityDefiner: boolean;
}

export interface TriggerItem {
  name: string;
  schema: string;
  table: string;
  timing: string;
  event: string;
  orientation: string;
  statement: string;
}

export interface PerformancePayload {
  summary: {
    activeConnections: number;
    cacheHitRatio: number;
    databaseSizeBytes: number;
  };
  tables: Array<{
    schema: string;
    table: string;
    liveRows: number;
    deadRows: number;
    seqScans: number;
    idxScans: number;
    lastVacuum: string | null;
    lastAutovacuum: string | null;
    lastAnalyze: string | null;
  }>;
  pgStatStatementsAvailable: boolean;
  slowQueries: Array<{
    query: string;
    calls: number;
    meanExecTimeMs: number;
    totalExecTimeMs: number;
    rows: number;
  }>;
}

export function IndexesManager({
  slug,
  tables,
  indexes,
  onReload,
}: {
  slug: string;
  tables: TableItem[];
  indexes: IndexRecord[];
  onReload: () => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [tableKey, setTableKey] = React.useState('');
  const [name, setName] = React.useState('');
  const [columnsInput, setColumnsInput] = React.useState('');
  const [unique, setUnique] = React.useState(false);
  const [method, setMethod] = React.useState<'btree' | 'hash' | 'gin' | 'gist'>('btree');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!tableKey && tables.length > 0 && tables[0]) {
      setTableKey(`${tables[0].schema}.${tables[0].name}`);
    }
  }, [tables, tableKey]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!tableKey || !name.trim() || !columnsInput.trim()) return;
    const [schema, table] = tableKey.split('.');
    if (!schema || !table) return;

    setSaving(true);
    setError(null);
    const cols = columnsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const res = await api.post(
      `/api/v1/projects/${slug}/database/tables/${table}/indexes?schema=${schema}`,
      { name: name.trim(), columns: cols, unique, method },
    );

    if (!res.success) {
      setError(res.error?.message ?? 'Failed to create index');
      setSaving(false);
      return;
    }

    setOpen(false);
    setName('');
    setColumnsInput('');
    setUnique(false);
    setSaving(false);
    await onReload();
  }

  async function handleDrop(idx: IndexRecord) {
    if (!confirm(`Drop index "${idx.name}" from ${idx.schema}.${idx.table}?`)) return;
    const res = await api.delete(
      `/api/v1/projects/${slug}/database/indexes/${encodeURIComponent(idx.name)}?schema=${idx.schema}`,
    );
    if (!res.success) {
      setError(res.error?.message ?? 'Failed to drop index');
      return;
    }
    await onReload();
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-2.5 text-xs bg-destructive/10 text-destructive rounded-md">{error}</div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Accelerate filtered multi-tenant queries (e.g. composite index on <code className="font-mono">(tenant_id, created_at)</code>).
        </p>
        <Button size="sm" onClick={() => setOpen(true)} disabled={tables.length === 0}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> New index
        </Button>
      </div>

      {indexes.length === 0 ? (
        <EmptyState icon={KeyRound} title="No indexes found" description="Create an index on any column to speed up queries." />
      ) : (
        <Card>
          <CardContent className="p-0 divide-y divide-border">
            {indexes.map((idx) => (
              <div key={`${idx.schema}.${idx.name}`} className="flex items-start justify-between gap-3 p-3.5">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono font-semibold">{idx.name}</span>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {idx.schema}.{idx.table}
                    </Badge>
                    {idx.isPrimary && <Badge className="text-[10px]">PRIMARY</Badge>}
                    {idx.isUnique && !idx.isPrimary && <Badge variant="secondary" className="text-[10px]">UNIQUE</Badge>}
                    <span className="text-[11px] text-muted-foreground">
                      {idx.scans} scans · {(idx.sizeBytes / 1024).toFixed(1)} KB
                    </span>
                  </div>
                  <p className="text-[11px] font-mono text-muted-foreground break-all">{idx.definition}</p>
                </div>
                {!idx.isPrimary && (
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive shrink-0" onClick={() => handleDrop(idx)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Database Index</DialogTitle>
            <DialogDescription>Add a B-Tree, GIN, GiST, or Hash index to a table.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium">Table</label>
              <select
                value={tableKey}
                onChange={(e) => setTableKey(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-xs font-mono"
              >
                {tables.map((t) => (
                  <option key={`${t.schema}.${t.name}`} value={`${t.schema}.${t.name}`}>
                    {t.schema}.{t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Index Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="idx_fuel_sales_tenant_id"
                className="text-xs font-mono"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Columns (comma-separated)</label>
              <Input
                value={columnsInput}
                onChange={(e) => setColumnsInput(e.target.value)}
                placeholder="tenant_id, created_at"
                className="text-xs font-mono"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3 items-center">
              <div className="space-y-1">
                <label className="text-xs font-medium">Method</label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as any)}
                  className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-xs font-mono"
                >
                  <option value="btree">btree</option>
                  <option value="hash">hash</option>
                  <option value="gin">gin</option>
                  <option value="gist">gist</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs pt-5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={unique}
                  onChange={(e) => setUnique(e.target.checked)}
                  className="rounded accent-emerald-500"
                />
                <span>Unique index</span>
              </label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create index'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ForeignKeysManager({
  slug,
  tables,
  foreignKeys,
  onReload,
}: {
  slug: string;
  tables: TableItem[];
  foreignKeys: ForeignKeyRecord[];
  onReload: () => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [sourceKey, setSourceKey] = React.useState('');
  const [column, setColumn] = React.useState('');
  const [refKey, setRefKey] = React.useState('');
  const [refColumn, setRefColumn] = React.useState('id');
  const [onDelete, setOnDelete] = React.useState<'NO ACTION' | 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'SET DEFAULT'>('CASCADE');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!sourceKey && tables.length > 0 && tables[0]) {
      setSourceKey(`${tables[0].schema}.${tables[0].name}`);
    }
    if (!refKey && tables.length > 0 && tables[0]) {
      setRefKey(`${tables[0].schema}.${tables[0].name}`);
    }
  }, [tables, sourceKey, refKey]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const [srcSchema, srcTable] = sourceKey.split('.');
    const [refSchema, refTable] = refKey.split('.');
    if (!srcSchema || !srcTable || !refSchema || !refTable || !column.trim() || !refColumn.trim()) return;

    setSaving(true);
    setError(null);
    const res = await api.post(
      `/api/v1/projects/${slug}/database/tables/${srcTable}/foreign-keys?schema=${srcSchema}`,
      {
        column: column.trim(),
        referencedSchema: refSchema,
        referencedTable: refTable,
        referencedColumn: refColumn.trim(),
        onDelete,
      },
    );

    if (!res.success) {
      setError(res.error?.message ?? 'Failed to add foreign key');
      setSaving(false);
      return;
    }

    setOpen(false);
    setColumn('');
    setSaving(false);
    await onReload();
  }

  async function handleDrop(fk: ForeignKeyRecord) {
    if (!confirm(`Drop foreign key constraint "${fk.name}"?`)) return;
    const res = await api.delete(
      `/api/v1/projects/${slug}/database/tables/${fk.table}/foreign-keys/${encodeURIComponent(fk.name)}?schema=${fk.schema}`,
    );
    if (!res.success) {
      setError(res.error?.message ?? 'Failed to drop foreign key');
      return;
    }
    await onReload();
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-2.5 text-xs bg-destructive/10 text-destructive rounded-md">{error}</div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Enforce referential integrity between project tables and multi-tenant resources.
        </p>
        <Button size="sm" onClick={() => setOpen(true)} disabled={tables.length === 0}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add relationship
        </Button>
      </div>

      {foreignKeys.length === 0 ? (
        <EmptyState icon={Link2} title="No foreign key relationships" description="Connect tables together with CASCADE, RESTRICT, or SET NULL foreign keys." />
      ) : (
        <Card>
          <CardContent className="p-0 divide-y divide-border">
            {foreignKeys.map((fk) => (
              <div key={`${fk.schema}.${fk.table}.${fk.name}`} className="flex items-center justify-between gap-3 p-3.5">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono font-semibold">{fk.name}</span>
                    <Badge variant="outline" className="text-[10px]">ON DELETE {fk.onDelete}</Badge>
                  </div>
                  <p className="text-xs font-mono text-muted-foreground">
                    <span className="text-foreground">{fk.schema}.{fk.table}.{fk.column}</span>
                    {' → '}
                    <span className="text-emerald-500">{fk.referencedSchema}.{fk.referencedTable}.{fk.referencedColumn}</span>
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive shrink-0" onClick={() => handleDrop(fk)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Foreign Key Relationship</DialogTitle>
            <DialogDescription>Link a source column to a referenced table primary/unique key.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Source Table</label>
                <select
                  value={sourceKey}
                  onChange={(e) => setSourceKey(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs font-mono"
                >
                  {tables.map((t) => (
                    <option key={`${t.schema}.${t.name}`} value={`${t.schema}.${t.name}`}>
                      {t.schema}.{t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Source Column</label>
                <Input
                  value={column}
                  onChange={(e) => setColumn(e.target.value)}
                  placeholder="tenant_id"
                  className="text-xs font-mono"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Referenced Table</label>
                <select
                  value={refKey}
                  onChange={(e) => setRefKey(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs font-mono"
                >
                  {tables.map((t) => (
                    <option key={`${t.schema}.${t.name}`} value={`${t.schema}.${t.name}`}>
                      {t.schema}.{t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Referenced Column</label>
                <Input
                  value={refColumn}
                  onChange={(e) => setRefColumn(e.target.value)}
                  placeholder="id"
                  className="text-xs font-mono"
                  required
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">On Delete Rule</label>
              <select
                value={onDelete}
                onChange={(e) => setOnDelete(e.target.value as any)}
                className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs font-mono"
              >
                <option value="CASCADE">CASCADE</option>
                <option value="RESTRICT">RESTRICT</option>
                <option value="SET NULL">SET NULL</option>
                <option value="NO ACTION">NO ACTION</option>
                <option value="SET DEFAULT">SET DEFAULT</option>
              </select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Adding...' : 'Add constraint'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function MigrationsManager({
  slug,
  migrations,
  onReload,
}: {
  slug: string;
  migrations: MigrationItem[];
  onReload: () => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [upSql, setUpSql] = React.useState('');
  const [downSql, setDownSql] = React.useState('');
  const [applyNow, setApplyNow] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !upSql.trim()) return;
    setSaving(true);
    setError(null);

    const res = await api.post(`/api/v1/projects/${slug}/database/migrations`, {
      name: name.trim(),
      upSql: upSql.trim(),
      downSql: downSql.trim() || undefined,
      applyNow,
    });

    if (!res.success) {
      setError(res.error?.message ?? 'Migration failed');
      setSaving(false);
      return;
    }

    setOpen(false);
    setName('');
    setUpSql('');
    setDownSql('');
    setSaving(false);
    await onReload();
  }

  async function handleAction(id: number, action: 'apply' | 'rollback') {
    setBusyId(id);
    setError(null);
    const res = await api.post(`/api/v1/projects/${slug}/database/migrations/${id}/${action}`, {});
    if (!res.success) {
      setError(res.error?.message ?? `Failed to ${action} migration`);
    }
    setBusyId(null);
    await onReload();
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-2.5 text-xs bg-destructive/10 text-destructive rounded-md">{error}</div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Track transactional schema evolution in <code className="font-mono">public._skynode_migrations</code> with up/down rollback support.
        </p>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> New migration
        </Button>
      </div>

      {migrations.length === 0 ? (
        <EmptyState icon={GitBranch} title="No migrations recorded yet" description="Create your first versioned SQL migration with optional rollback DDL." />
      ) : (
        <div className="space-y-2.5">
          {migrations.map((m) => (
            <Card key={m.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-emerald-500" />
                    <span className="text-sm font-mono font-semibold">{m.name}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">{m.version}</Badge>
                    <Badge
                      variant={
                        m.status === 'APPLIED'
                          ? 'default'
                          : m.status === 'PENDING'
                            ? 'secondary'
                            : 'outline'
                      }
                      className="text-[10px]"
                    >
                      {m.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.status !== 'APPLIED' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        disabled={busyId === m.id}
                        onClick={() => handleAction(m.id, 'apply')}
                      >
                        <Play className="h-3 w-3" /> Apply
                      </Button>
                    )}
                    {m.status === 'APPLIED' && m.down_sql && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1 text-amber-500"
                        disabled={busyId === m.id}
                        onClick={() => handleAction(m.id, 'rollback')}
                      >
                        <RotateCcw className="h-3 w-3" /> Rollback
                      </Button>
                    )}
                  </div>
                </div>
                <CardDescription className="text-xs">
                  {m.applied_at
                    ? `Applied ${formatRelativeTime(m.applied_at)}`
                    : `Created ${formatRelativeTime(m.created_at)}`}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <pre className="rounded bg-muted p-2.5 text-[11px] font-mono overflow-x-auto">{m.up_sql}</pre>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Database Migration</DialogTitle>
            <DialogDescription>Runs atomically inside a PostgreSQL transaction.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium">Migration Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="add_stations_table"
                className="text-xs font-mono"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Up SQL</label>
              <Textarea
                value={upSql}
                onChange={(e) => setUpSql(e.target.value)}
                placeholder="CREATE TABLE public.stations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, name text NOT NULL);"
                className="font-mono text-xs min-h-[110px]"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Down SQL (optional rollback)</label>
              <Textarea
                value={downSql}
                onChange={(e) => setDownSql(e.target.value)}
                placeholder="DROP TABLE IF EXISTS public.stations;"
                className="font-mono text-xs min-h-[70px]"
              />
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={applyNow}
                onChange={(e) => setApplyNow(e.target.checked)}
                className="rounded accent-emerald-500"
              />
              <span>Apply immediately inside transaction</span>
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Running...' : applyNow ? 'Create & Apply' : 'Save Pending'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function FunctionsAndTriggersManager({
  functions,
  triggers,
}: {
  functions: FunctionItem[];
  triggers: TriggerItem[];
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2.5">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Code2 className="h-4 w-4 text-primary" /> Functions ({functions.length})
        </h3>
        {functions.length === 0 ? (
          <EmptyState icon={Code2} title="No custom functions" description="Create SQL or PL/pgSQL functions from the SQL Editor." />
        ) : (
          <Card>
            <CardContent className="p-0 divide-y divide-border">
              {functions.map((fn, i) => (
                <div key={`${fn.schema}.${fn.name}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-mono font-medium truncate">
                      <span className="text-muted-foreground">{fn.schema}.</span>
                      {fn.name}({fn.arguments})
                    </p>
                    <p className="text-[11px] font-mono text-muted-foreground">
                      RETURNS {fn.returnType} · {fn.language}
                    </p>
                  </div>
                  {fn.securityDefiner && (
                    <Badge variant="secondary" className="text-[10px] shrink-0">SECURITY DEFINER</Badge>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-2.5">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-500" /> Triggers ({triggers.length})
        </h3>
        {triggers.length === 0 ? (
          <EmptyState icon={Zap} title="No triggers configured" description="Attach BEFORE/AFTER INSERT/UPDATE triggers in SQL Editor." />
        ) : (
          <Card>
            <CardContent className="p-0 divide-y divide-border">
              {triggers.map((tr, i) => (
                <div key={`${tr.schema}.${tr.table}.${tr.name}-${i}`} className="px-4 py-2.5 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono font-semibold">{tr.name}</span>
                    <Badge variant="outline" className="text-[10px] font-mono">{tr.schema}.{tr.table}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{tr.timing} {tr.event}</Badge>
                  </div>
                  <p className="text-[11px] font-mono text-muted-foreground truncate">{tr.statement}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export function ExtensionsManager({
  slug,
  extensions,
  onReload,
}: {
  slug: string;
  extensions: ExtensionItem[];
  onReload: () => Promise<void>;
}) {
  const [search, setSearch] = React.useState('');
  const [togglingName, setTogglingName] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function handleToggle(ext: ExtensionItem, enabled: boolean) {
    setTogglingName(ext.name);
    setError(null);
    const res = await api.post(`/api/v1/projects/${slug}/database/extensions`, {
      name: ext.name,
      enabled,
    });
    if (!res.success) {
      setError(res.error?.message ?? `Could not ${enabled ? 'enable' : 'disable'} ${ext.name}`);
    } else {
      await onReload();
    }
    setTogglingName(null);
  }

  const filtered = extensions.filter(
    (e) =>
      e.name.toLowerCase().includes(search.trim().toLowerCase()) ||
      (e.comment ?? '').toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-2.5 text-xs bg-destructive/10 text-destructive rounded-md">{error}</div>
      )}

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search PostgreSQL extensions (e.g. pg_trgm, vector)..."
          className="pl-9 text-xs"
        />
      </div>

      <div className="grid gap-2.5 md:grid-cols-2">
        {filtered.slice(0, 60).map((ext) => {
          const isInstalled = Boolean(ext.installedVersion);
          return (
            <Card key={ext.name}>
              <CardContent className="flex items-start justify-between gap-3 p-3.5">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <Puzzle className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="text-xs font-mono font-semibold">{ext.name}</span>
                    <Badge variant={isInstalled ? 'default' : 'outline'} className="text-[10px]">
                      {ext.installedVersion ?? ext.defaultVersion}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {ext.comment ?? 'PostgreSQL extension'}
                  </p>
                </div>
                <Switch
                  checked={isInstalled}
                  disabled={togglingName === ext.name}
                  onCheckedChange={(checked) => handleToggle(ext, checked)}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export function PerformanceManager({
  slug,
  stats,
  onReload,
}: {
  slug: string;
  stats: PerformancePayload | null;
  onReload: () => Promise<void>;
}) {
  const [running, setRunning] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function runMaintenance(action: 'vacuum' | 'analyze', schema?: string, table?: string) {
    setRunning(true);
    setNotice(null);
    const res = await api.post<{ message: string }>(`/api/v1/projects/${slug}/database/maintenance`, {
      action,
      schema,
      table,
    });
    if (!res.success) {
      setNotice(res.error?.message ?? `${action} failed`);
    } else {
      setNotice(res.data?.message ?? `${action.toUpperCase()} completed`);
      await onReload();
    }
    setRunning(false);
  }

  if (!stats) return null;

  return (
    <div className="space-y-4">
      {notice && (
        <div className="p-2.5 text-xs bg-muted border border-border rounded-md">{notice}</div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Cache Hit Ratio</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono">{stats.summary.cacheHitRatio}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Active DB Connections</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono">{stats.summary.activeConnections}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Database Size</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono">
              {(stats.summary.databaseSizeBytes / (1024 * 1024)).toFixed(2)} MB
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-500" /> Table Health &amp; Tuple Statistics
        </h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={running} onClick={() => runMaintenance('analyze')}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" /> ANALYZE DB
          </Button>
          <Button variant="outline" size="sm" disabled={running} onClick={() => runMaintenance('vacuum')}>
            VACUUM DB
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-b border-border text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Table</th>
                <th className="px-3 py-2 text-right">Live rows</th>
                <th className="px-3 py-2 text-right">Dead tuples</th>
                <th className="px-3 py-2 text-right">Seq scans</th>
                <th className="px-3 py-2 text-right">Index scans</th>
                <th className="px-3 py-2 text-right">Maintenance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stats.tables.map((t) => (
                <tr key={`${t.schema}.${t.table}`}>
                  <td className="px-3 py-2 font-mono">{t.schema}.{t.table}</td>
                  <td className="px-3 py-2 text-right font-mono">{t.liveRows.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono text-amber-500">{t.deadRows.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono">{t.seqScans.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-500">{t.idxScans.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right space-x-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      disabled={running}
                      onClick={() => runMaintenance('vacuum', t.schema, t.table)}
                    >
                      Vacuum
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      disabled={running}
                      onClick={() => runMaintenance('analyze', t.schema, t.table)}
                    >
                      Analyze
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {stats.pgStatStatementsAvailable && stats.slowQueries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Slowest Queries (pg_stat_statements)</CardTitle>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border">
            {stats.slowQueries.map((q, idx) => (
              <div key={idx} className="px-4 py-2.5 flex items-center justify-between gap-4 text-xs">
                <code className="font-mono truncate text-foreground/80">{q.query}</code>
                <span className="font-mono text-muted-foreground shrink-0">
                  {q.meanExecTimeMs}ms avg · {q.calls} calls
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
