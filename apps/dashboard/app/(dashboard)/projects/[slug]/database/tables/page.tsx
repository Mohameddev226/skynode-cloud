'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Database,
  RefreshCw,
  Table2,
  KeyRound,
  Link2,
  GitBranch,
  Code2,
  Puzzle,
  Activity,
  Plus,
  ExternalLink,
  Terminal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingSkeleton } from '@/components/shared/loading-skeleton';
import { ErrorState } from '@/components/shared/error-state';
import {
  IndexesManager,
  ForeignKeysManager,
  MigrationsManager,
  FunctionsAndTriggersManager,
  ExtensionsManager,
  PerformanceManager,
  type TableItem,
  type IndexRecord,
  type ForeignKeyRecord,
  type MigrationItem,
  type ExtensionItem,
  type FunctionItem,
  type TriggerItem,
  type PerformancePayload,
} from '@/components/database/database-hub-tabs';
import api from '@/lib/api';

interface SchemaItem {
  name: string;
  owner: string;
  tableCount: number;
}

export default function DatabaseHubPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [schemas, setSchemas] = React.useState<SchemaItem[]>([]);
  const [tables, setTables] = React.useState<TableItem[]>([]);
  const [indexes, setIndexes] = React.useState<IndexRecord[]>([]);
  const [foreignKeys, setForeignKeys] = React.useState<ForeignKeyRecord[]>([]);
  const [migrations, setMigrations] = React.useState<MigrationItem[]>([]);
  const [extensions, setExtensions] = React.useState<ExtensionItem[]>([]);
  const [functions, setFunctions] = React.useState<FunctionItem[]>([]);
  const [triggers, setTriggers] = React.useState<TriggerItem[]>([]);
  const [performance, setPerformance] = React.useState<PerformancePayload | null>(null);

  const [newSchemaName, setNewSchemaName] = React.useState('');
  const [creatingSchema, setCreatingSchema] = React.useState(false);
  const [schemaNotice, setSchemaNotice] = React.useState<string | null>(null);

  const loadAll = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    const [
      schemasRes,
      tablesRes,
      indexesRes,
      fkRes,
      migRes,
      extRes,
      fnRes,
      trRes,
      perfRes,
    ] = await Promise.all([
      api.get<SchemaItem[]>(`/api/v1/projects/${slug}/database/schemas`),
      api.get<TableItem[]>(`/api/v1/projects/${slug}/database/tables`),
      api.get<IndexRecord[]>(`/api/v1/projects/${slug}/database/indexes`),
      api.get<ForeignKeyRecord[]>(`/api/v1/projects/${slug}/database/foreign-keys`),
      api.get<MigrationItem[]>(`/api/v1/projects/${slug}/database/migrations`),
      api.get<ExtensionItem[]>(`/api/v1/projects/${slug}/database/extensions`),
      api.get<FunctionItem[]>(`/api/v1/projects/${slug}/database/functions`),
      api.get<TriggerItem[]>(`/api/v1/projects/${slug}/database/triggers`),
      api.get<PerformancePayload>(`/api/v1/projects/${slug}/database/performance`),
    ]);

    if (!tablesRes.success) {
      setError(tablesRes.error?.message ?? 'Failed to load database metadata');
      setLoading(false);
      return;
    }

    setSchemas(Array.isArray(schemasRes.data) ? schemasRes.data : []);
    setTables(Array.isArray(tablesRes.data) ? tablesRes.data : []);
    setIndexes(Array.isArray(indexesRes.data) ? indexesRes.data : []);
    setForeignKeys(Array.isArray(fkRes.data) ? fkRes.data : []);
    setMigrations(Array.isArray(migRes.data) ? migRes.data : []);
    setExtensions(Array.isArray(extRes.data) ? extRes.data : []);
    setFunctions(Array.isArray(fnRes.data) ? fnRes.data : []);
    setTriggers(Array.isArray(trRes.data) ? trRes.data : []);
    setPerformance(perfRes.success && perfRes.data ? perfRes.data : null);
    setLoading(false);
  }, [slug]);

  React.useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function handleCreateSchema(e: React.FormEvent) {
    e.preventDefault();
    if (!newSchemaName.trim()) return;
    setCreatingSchema(true);
    setSchemaNotice(null);

    const res = await api.post(`/api/v1/projects/${slug}/database/schemas`, {
      name: newSchemaName.trim(),
    });
    if (!res.success) {
      setSchemaNotice(res.error?.message ?? 'Failed to create schema');
    } else {
      setNewSchemaName('');
      await loadAll();
    }
    setCreatingSchema(false);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton className="h-8 w-56" />
        <div className="grid gap-4 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <LoadingSkeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <LoadingSkeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={loadAll} />;
  }

  const installedExtCount = extensions.filter((e) => Boolean(e.installedVersion)).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Database className="h-6 w-6 text-emerald-500" />
            Database Management
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage PostgreSQL schemas, indexes, foreign keys, versioned migrations, extensions, and query health.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/projects/${slug}/database`}>
              <Table2 className="mr-1.5 h-3.5 w-3.5" /> Table Editor
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/projects/${slug}/database/sql`}>
              <Terminal className="mr-1.5 h-3.5 w-3.5" /> SQL Editor
            </Link>
          </Button>
          <Button variant="outline" size="icon" onClick={loadAll} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Schemas / Tables</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono">
              {schemas.length} <span className="text-sm font-normal text-muted-foreground">/ {tables.length} tables</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Indexes &amp; Relations</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono">
              {indexes.length} <span className="text-sm font-normal text-muted-foreground">/ {foreignKeys.length} FKs</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Migrations Applied</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono">
              {migrations.filter((m) => m.status === 'APPLIED').length}
              <span className="text-sm font-normal text-muted-foreground"> / {migrations.length}</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Extensions Active</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono">{installedExtCount}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="schemas">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="schemas" className="gap-1.5">
            <Table2 className="h-3.5 w-3.5" /> Schemas &amp; Tables
          </TabsTrigger>
          <TabsTrigger value="indexes" className="gap-1.5">
            <KeyRound className="h-3.5 w-3.5" /> Indexes
            <Badge variant="secondary" className="ml-1 text-[10px]">{indexes.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="relationships" className="gap-1.5">
            <Link2 className="h-3.5 w-3.5" /> Relationships
            <Badge variant="secondary" className="ml-1 text-[10px]">{foreignKeys.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="migrations" className="gap-1.5">
            <GitBranch className="h-3.5 w-3.5" /> Migrations
            <Badge variant="secondary" className="ml-1 text-[10px]">{migrations.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="functions" className="gap-1.5">
            <Code2 className="h-3.5 w-3.5" /> Functions &amp; Triggers
          </TabsTrigger>
          <TabsTrigger value="extensions" className="gap-1.5">
            <Puzzle className="h-3.5 w-3.5" /> Extensions
          </TabsTrigger>
          <TabsTrigger value="performance" className="gap-1.5">
            <Activity className="h-3.5 w-3.5" /> Performance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="schemas" className="space-y-4">
          {schemaNotice && (
            <div className="p-2.5 text-xs bg-destructive/10 text-destructive rounded-md">{schemaNotice}</div>
          )}

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Database Schemas</CardTitle>
                  <CardDescription>Namespaces isolating tables, functions, and policies.</CardDescription>
                </div>
                <form onSubmit={handleCreateSchema} className="flex items-center gap-2">
                  <Input
                    value={newSchemaName}
                    onChange={(e) => setNewSchemaName(e.target.value)}
                    placeholder="new_schema"
                    className="h-8 w-40 text-xs font-mono"
                    required
                  />
                  <Button type="submit" size="sm" className="h-8 text-xs" disabled={creatingSchema}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> {creatingSchema ? 'Creating...' : 'Create schema'}
                  </Button>
                </form>
              </div>
            </CardHeader>
            <CardContent className="grid gap-2.5 sm:grid-cols-3">
              {schemas.map((s) => (
                <div key={s.name} className="rounded-lg border border-border p-3 bg-muted/20 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-mono font-semibold text-emerald-500">{s.name}</p>
                    <p className="text-[11px] text-muted-foreground">Owner: {s.owner}</p>
                  </div>
                  <Badge variant="outline" className="font-mono text-xs">{s.tableCount} tables</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">All Tables</CardTitle>
                  <CardDescription>Open any table in Table Editor to inspect rows, rename tables/columns, or configure RLS.</CardDescription>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/projects/${slug}/database`}>
                    Open Table Editor <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border">
              {tables.map((t) => (
                <div key={`${t.schema}.${t.name}`} className="flex items-center justify-between px-4 py-2.5 text-xs">
                  <div className="flex items-center gap-2 font-mono">
                    <Badge variant="outline" className="text-[10px]">{t.schema}</Badge>
                    <span className="font-semibold">{t.name}</span>
                  </div>
                  <div className="flex items-center gap-4 text-muted-foreground font-mono">
                    <span>{t.rowCount.toLocaleString()} rows</span>
                    <span>{(t.sizeBytes / 1024).toFixed(1)} KB</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="indexes">
          <IndexesManager slug={slug} tables={tables} indexes={indexes} onReload={loadAll} />
        </TabsContent>

        <TabsContent value="relationships">
          <ForeignKeysManager slug={slug} tables={tables} foreignKeys={foreignKeys} onReload={loadAll} />
        </TabsContent>

        <TabsContent value="migrations">
          <MigrationsManager slug={slug} migrations={migrations} onReload={loadAll} />
        </TabsContent>

        <TabsContent value="functions">
          <FunctionsAndTriggersManager functions={functions} triggers={triggers} />
        </TabsContent>

        <TabsContent value="extensions">
          <ExtensionsManager slug={slug} extensions={extensions} onReload={loadAll} />
        </TabsContent>

        <TabsContent value="performance">
          <PerformanceManager slug={slug} stats={performance} onReload={loadAll} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
