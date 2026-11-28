'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import {
  Zap,
  Key,
  Plus,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  ExternalLink,
  Play,
  ChevronDown,
  ChevronRight,
  Table2,
  Globe,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { LoadingSkeleton } from '@/components/shared/loading-skeleton';
import { ErrorState } from '@/components/shared/error-state';
import api from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  type?: string;
  permissions?: string[];
  createdAt: string;
  lastUsedAt?: string;
}

interface ProjectApiConfig {
  baseUrl: string;
  anonKey: string;
  serviceKey: string;
}

interface TableInfo {
  name: string;
  schema: string;
  rowCount: number;
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  POST: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  PATCH: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  DELETE: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
};

interface EndpointGroup {
  table: string;
  endpoints: { method: string; path: string; description: string }[];
}

function buildEndpoints(baseUrl: string, tables: TableInfo[]): EndpointGroup[] {
  return tables.map((t) => ({
    table: t.name,
    endpoints: [
      {
        method: 'GET',
        path: `${baseUrl}/rest/v1/${t.name}`,
        description: `List rows from ${t.name} with filter, order, pagination`,
      },
      {
        method: 'GET',
        path: `${baseUrl}/rest/v1/${t.name}/:id`,
        description: `Get a single row by primary key`,
      },
      {
        method: 'POST',
        path: `${baseUrl}/rest/v1/${t.name}`,
        description: `Insert one or more rows into ${t.name}`,
      },
      {
        method: 'PATCH',
        path: `${baseUrl}/rest/v1/${t.name}/:id`,
        description: `Update a row by primary key`,
      },
      {
        method: 'DELETE',
        path: `${baseUrl}/rest/v1/${t.name}/:id`,
        description: `Delete a row by primary key`,
      },
    ],
  }));
}

export default function ApiPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [apiKeys, setApiKeys] = React.useState<ApiKey[]>([]);
  const [config, setConfig] = React.useState<ProjectApiConfig | null>(null);
  const [tables, setTables] = React.useState<TableInfo[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showServiceKey, setShowServiceKey] = React.useState(false);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [expandedTable, setExpandedTable] = React.useState<string | null>(null);

  // Test panel
  const [testUrl, setTestUrl] = React.useState('');
  const [testResult, setTestResult] = React.useState<string | null>(null);
  const [testLoading, setTestLoading] = React.useState(false);

  async function fetchData() {
    setLoading(true);
    setError(null);
    const [keysRes, configRes, tablesRes] = await Promise.all([
      api.get<ApiKey[]>(`/api/v1/projects/${slug}/api/keys`),
      api.get<ProjectApiConfig>(`/api/v1/projects/${slug}/api/config`),
      api.get<TableInfo[] | { tables: TableInfo[] }>(`/api/v1/projects/${slug}/database/tables`),
    ]);
    if (!keysRes.success) {
      setError(keysRes.error?.message ?? 'Failed to load API config');
    } else {
      setApiKeys(keysRes.data ?? []);
      setConfig(configRes.data ?? null);
      const rawTables = tablesRes.data;
      const list = Array.isArray(rawTables) ? rawTables : (rawTables?.tables ?? []);
      setTables(list.filter((t) => t.schema === 'public'));
    }
    setLoading(false);
  }

  React.useEffect(() => { fetchData(); }, [slug]);

  async function copyToClipboard(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  async function runTestRequest(url: string) {
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const json = await res.json();
      setTestResult(JSON.stringify(json, null, 2));
    } catch (e: any) {
      setTestResult(`Error: ${e.message}`);
    }
    setTestLoading(false);
  }

  if (loading) return (
    <div className="space-y-6">
      <LoadingSkeleton className="h-8 w-32" />
      <LoadingSkeleton className="h-48 rounded-lg" />
      <LoadingSkeleton className="h-64 rounded-lg" />
    </div>
  );
  if (error) return <ErrorState message={error} onRetry={fetchData} />;

  const endpointGroups = config ? buildEndpoints(config.baseUrl, tables) : [];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Docs & Keys</h1>
          <p className="text-sm text-muted-foreground">REST API endpoints and credentials for this project</p>
        </div>
        <Button variant="outline" size="icon" onClick={fetchData} title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Tabs defaultValue="credentials">
        <TabsList>
          <TabsTrigger value="credentials">Credentials</TabsTrigger>
          <TabsTrigger value="explorer">
            Explorer
            {tables.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs">{tables.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="keys">API Keys</TabsTrigger>
        </TabsList>

        {/* ── Credentials ───────────────────────────────────────── */}
        <TabsContent value="credentials" className="space-y-4">
          {config ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Project credentials</CardTitle>
                <CardDescription>Use these to connect your application to this project.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Base URL */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Project URL</label>
                  <div className="flex items-center gap-2">
                    <Input value={config.baseUrl} readOnly className="font-mono text-xs" />
                    <Button variant="outline" size="icon" className="shrink-0" onClick={() => copyToClipboard(config.baseUrl, 'url')}>
                      <Copy className={`h-4 w-4 ${copied === 'url' ? 'text-green-500' : ''}`} />
                    </Button>
                    <Button variant="outline" size="icon" className="shrink-0" asChild>
                      <a href={config.baseUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>

                <Separator />

                {/* Anon Key */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Anon / Public key</label>
                  <p className="text-xs text-muted-foreground">Safe to use in browser. Respects row-level security policies.</p>
                  <div className="flex items-center gap-2">
                    <Input value={config.anonKey} readOnly className="font-mono text-xs" />
                    <Button variant="outline" size="icon" className="shrink-0" onClick={() => copyToClipboard(config.anonKey, 'anon')}>
                      <Copy className={`h-4 w-4 ${copied === 'anon' ? 'text-green-500' : ''}`} />
                    </Button>
                  </div>
                </div>

                <Separator />

                {/* Service Key */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Service role key</label>
                  <p className="text-xs text-destructive">Never expose this key publicly. It bypasses all security policies.</p>
                  <div className="flex items-center gap-2">
                    <Input
                      value={showServiceKey ? config.serviceKey : '•'.repeat(60)}
                      readOnly
                      className="font-mono text-xs"
                    />
                    <Button variant="outline" size="icon" className="shrink-0" onClick={() => setShowServiceKey(!showServiceKey)}>
                      {showServiceKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button variant="outline" size="icon" className="shrink-0" onClick={() => copyToClipboard(config.serviceKey, 'service')}>
                      <Copy className={`h-4 w-4 ${copied === 'service' ? 'text-green-500' : ''}`} />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                API credentials not yet provisioned for this project.
              </CardContent>
            </Card>
          )}

          {/* Quick start code snippet */}
          {config && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Multi-Tenant SDK Quick Start (@skynode/sdk)</CardTitle>
                <CardDescription>Authenticate users, switch active tenant organizations, query RLS-isolated tables, and subscribe to tenant-scoped realtime events.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <pre className="bg-muted rounded-md p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
{`import { createClient } from '@skynode/sdk';

const skynode = createClient('${config.baseUrl}', '${config.anonKey}');

// 1. Authenticate user & inspect available tenants
const { data: session } = await skynode.auth.signIn({
  email: 'user@company.com',
  password: 'Password123!',
});

// 2. Switch active tenant workspace
await skynode.setTenant('<TENANT_ID_OR_SLUG>');

// 3. Query tenant-isolated rows (enforced via PostgreSQL RLS)
const { data: rows } = await skynode
  .from('${tables[0]?.name ?? 'your_table'}')
  .select('*')
  .limit(10);

// 4. REST fetch equivalent with verified tenant header
const res = await fetch('${config.baseUrl}/rest/v1/${tables[0]?.name ?? 'your_table'}?limit=10', {
  headers: {
    'apikey': '${config.anonKey}',
    'Authorization': \`Bearer \${session?.access_token}\`,
    'X-Tenant-ID': '<TENANT_ID>',
  },
});`}
                </pre>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Explorer ───────────────────────────────────────────── */}
        <TabsContent value="explorer" className="space-y-4">
          {tables.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center space-y-2">
                <Table2 className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                <p className="text-sm text-muted-foreground">No tables found. Create tables in the Table Editor first.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Quick test */}
              {config && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Play className="h-4 w-4 text-emerald-500" />
                      Quick test
                    </CardTitle>
                    <CardDescription>Send a GET request to any REST endpoint</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex gap-2">
                      <Input
                        value={testUrl}
                        onChange={(e) => setTestUrl(e.target.value)}
                        placeholder={`${config.baseUrl}/rest/v1/${tables[0]?.name ?? 'table'}?limit=5`}
                        className="font-mono text-xs"
                        onKeyDown={(e) => e.key === 'Enter' && testUrl && runTestRequest(testUrl)}
                      />
                      <Button
                        onClick={() => testUrl && runTestRequest(testUrl)}
                        disabled={!testUrl || testLoading}
                        className="shrink-0"
                      >
                        {testLoading ? 'Loading...' : 'Run'}
                      </Button>
                    </div>
                    {testResult && (
                      <pre className="bg-muted rounded-md p-3 text-xs font-mono overflow-auto max-h-48 whitespace-pre-wrap">
                        {testResult}
                      </pre>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Endpoints per table */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-medium">{endpointGroups.length} table{endpointGroups.length !== 1 ? 's' : ''} · {endpointGroups.length * 5} endpoints</p>
                </div>
                {endpointGroups.map((group) => (
                  <Card key={group.table} className="overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors text-left"
                      onClick={() => setExpandedTable(expandedTable === group.table ? null : group.table)}
                    >
                      <div className="flex items-center gap-2">
                        <Table2 className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-mono font-medium">{group.table}</span>
                        <Badge variant="outline" className="text-xs">{group.endpoints.length} endpoints</Badge>
                      </div>
                      {expandedTable === group.table ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                    {expandedTable === group.table && (
                      <div className="border-t border-border divide-y divide-border">
                        {group.endpoints.map((ep) => (
                          <div key={`${ep.method}-${ep.path}`} className="flex items-start gap-3 px-4 py-2.5 group hover:bg-muted/30">
                            <span className={`text-xs font-bold font-mono px-1.5 py-0.5 rounded border shrink-0 mt-0.5 ${METHOD_COLORS[ep.method]}`}>
                              {ep.method}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-mono break-all text-foreground/80">{ep.path}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">{ep.description}</p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 opacity-0 group-hover:opacity-100 shrink-0"
                              onClick={() => copyToClipboard(ep.path, ep.path)}
                            >
                              <Copy className={`h-3 w-3 ${copied === ep.path ? 'text-green-500' : ''}`} />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* ── API Keys ───────────────────────────────────────────── */}
        <TabsContent value="keys" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Create scoped API keys for specific use cases.</p>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New API key
            </Button>
          </div>
          {apiKeys.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center space-y-2">
                <Key className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                <p className="text-sm text-muted-foreground">No API keys yet.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {apiKeys.map((key) => (
                    <div key={key.id} className="flex items-center justify-between p-4">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">{key.name}</p>
                        <p className="text-xs font-mono text-muted-foreground">{key.keyPrefix}...</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex gap-1 flex-wrap justify-end">
                          {key.type && (
                            <Badge variant={key.type === 'SECRET' ? 'destructive' : 'secondary'} className="text-xs">
                              {key.type}
                            </Badge>
                          )}
                          {key.permissions?.map((p) => (
                            <Badge key={p} variant="secondary" className="text-xs">{p}</Badge>
                          ))}
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {key.lastUsedAt ? formatRelativeTime(key.lastUsedAt) : 'Never used'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
