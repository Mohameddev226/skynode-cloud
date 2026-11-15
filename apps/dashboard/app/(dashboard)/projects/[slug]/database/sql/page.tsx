'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  Play,
  Save,
  Plus,
  Trash2,
  ChevronDown,
  Database,
  Table2,
  Clock,
  Copy,
  Check,
  FileCode2,
  Search,
  Sparkles,
  BarChart3,
  ListFilter,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import api from '@/lib/api';

// Monaco editor — client-side dynamic load
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs: number;
}

interface QueryError {
  message: string;
  hint?: string;
  position?: string;
}

interface QuerySnippet {
  id: string;
  name: string;
  sql: string;
  createdAt?: string;
}

const TEMPLATES: QuerySnippet[] = [
  {
    id: 'user-growth',
    name: 'User growth',
    sql: `-- User growth\n-- Track how your user base is trending over time\nSELECT\n  date_trunc('week', created_at) AS week,\n  count(distinct id) AS active_users\nFROM auth.users\nGROUP BY 1\nORDER BY 1 DESC;`,
  },
  {
    id: 'table-sizes',
    name: 'Table sizes & rows',
    sql: `-- Table sizes & disk usage\nSELECT\n  table_schema,\n  table_name,\n  pg_size_pretty(pg_total_relation_size(quote_ident(table_schema) || '.' || quote_ident(table_name))) AS total_size\nFROM information_schema.tables\nWHERE table_schema NOT IN ('pg_catalog', 'information_schema')\nORDER BY pg_total_relation_size(quote_ident(table_schema) || '.' || quote_ident(table_name)) DESC;`,
  },
  {
    id: 'show-tables',
    name: 'List all project tables',
    sql: `-- List all user tables in public and auth schemas\nSELECT\n  table_schema,\n  table_name,\n  table_type\nFROM information_schema.tables\nWHERE table_schema IN ('public', 'auth')\nORDER BY table_schema, table_name;`,
  },
  {
    id: 'active-sessions',
    name: 'Active sessions',
    sql: `-- Inspect active login sessions\nSELECT\n  id,\n  user_id,\n  created_at,\n  expires_at\nFROM auth.sessions\nORDER BY created_at DESC\nLIMIT 20;`,
  },
];

const DEFAULT_QUERY = `-- Hit CTRL+ENTER to run query or start typing\nSELECT * FROM information_schema.tables\nWHERE table_schema IN ('public', 'auth')\nLIMIT 10;\n`;

export default function SqlEditorPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [activeTab, setActiveTab] = React.useState<'results' | 'chart'>('results');
  const [queries, setQueries] = React.useState<QuerySnippet[]>([
    { id: 'query-1', name: 'New query', sql: DEFAULT_QUERY },
  ]);
  const [activeQueryId, setActiveQueryId] = React.useState<string>('query-1');
  const [searchFilter, setSearchFilter] = React.useState('');
  const [showLeftSidebar, setShowLeftSidebar] = React.useState(true);
  const [showTemplatesDrawer, setShowTemplatesDrawer] = React.useState(true);

  const activeSnippet = queries.find((q) => q.id === activeQueryId) ?? queries[0]!;
  const [sqlCode, setSqlCode] = React.useState(activeSnippet.sql);

  const [result, setResult] = React.useState<QueryResult | null>(null);
  const [queryError, setQueryError] = React.useState<QueryError | null>(null);
  const [status, setStatus] = React.useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [copiedCsv, setCopiedCsv] = React.useState(false);

  // Sync state when active query changes
  React.useEffect(() => {
    setSqlCode(activeSnippet.sql);
    setResult(null);
    setQueryError(null);
    setStatus('idle');
  }, [activeQueryId]);

  function handleCreateNewQuery() {
    const newId = `query-${Date.now()}`;
    const newQuery: QuerySnippet = {
      id: newId,
      name: `Query ${queries.length + 1}`,
      sql: `-- New query\nSELECT 1;\n`,
    };
    setQueries((prev) => [newQuery, ...prev]);
    setActiveQueryId(newId);
  }

  function handleSelectSnippet(snippet: QuerySnippet) {
    if (!queries.some((q) => q.id === snippet.id)) {
      setQueries((prev) => [snippet, ...prev]);
    }
    setActiveQueryId(snippet.id);
  }

  function handleDeleteQuery(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (queries.length <= 1) return;
    const remaining = queries.filter((q) => q.id !== id);
    setQueries(remaining);
    if (activeQueryId === id) {
      setActiveQueryId(remaining[0]!.id);
    }
  }

  async function runQuery() {
    if (!sqlCode.trim()) return;
    setStatus('running');
    setResult(null);
    setQueryError(null);

    const res = await api.post<QueryResult>(`/api/v1/projects/${slug}/database/query`, {
      sql: sqlCode,
    });

    if (!res.success) {
      setQueryError({ message: res.error?.message ?? 'Query execution failed' });
      setStatus('error');
    } else {
      setResult(res.data ?? null);
      setStatus('success');
      // Update snippet code in saved queries
      setQueries((prev) =>
        prev.map((q) => (q.id === activeQueryId ? { ...q, sql: sqlCode } : q))
      );
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      runQuery();
    }
  }

  async function copyCsv() {
    if (!result) return;
    const csv = [
      result.columns.join(','),
      ...result.rows.map((r) =>
        result.columns.map((c) => JSON.stringify(r[c] ?? '')).join(',')
      ),
    ].join('\n');
    await navigator.clipboard.writeText(csv);
    setCopiedCsv(true);
    setTimeout(() => setCopiedCsv(false), 2000);
  }

  const filteredQueries = queries.filter((q) =>
    q.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div
      className="flex flex-col h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-background select-none"
      onKeyDown={handleKeyDown}
    >
      {/* ── Top Bar ────────────────────────────────────────────── */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        {/* Left: active query title & database target selector */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLeftSidebar(!showLeftSidebar)}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            title="Toggle queries sidebar"
          >
            <ListFilter className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleCreateNewQuery}
            className="h-7 gap-1 px-2.5 text-xs font-medium"
          >
            <Plus className="h-3 w-3" />
            New
          </Button>

          <span className="text-muted-foreground/40 text-xs">|</span>

          {/* Database Target Pill (Supabase Style) */}
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground font-mono">
            <Database className="h-3.5 w-3.5 text-emerald-500" />
            <span>Database</span>
            <ChevronDown className="h-3 w-3 text-muted-foreground opacity-60" />
          </div>

          <span className="text-xs font-medium text-foreground truncate max-w-[200px]">
            {activeSnippet.name}
          </span>
        </div>

        {/* Right: Save & Prominent Emerald Run Button (Supabase Style) */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQueries((prev) =>
                prev.map((q) => (q.id === activeQueryId ? { ...q, sql: sqlCode } : q))
              );
            }}
            className="h-7 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Save className="h-3.5 w-3.5" />
            Save
            <span className="text-[10px] text-muted-foreground/60 font-mono">Ctrl S</span>
          </Button>

          {/* Signature Supabase Emerald Run Button */}
          <button
            onClick={runQuery}
            disabled={status === 'running'}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-all',
              status === 'running'
                ? 'bg-emerald-700 opacity-60 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-500 active:scale-95'
            )}
          >
            {status === 'running' ? (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-white" />
            )}
            <span>Run</span>
            <span className="rounded bg-emerald-700/80 px-1 py-0.2 text-[10px] font-mono text-emerald-100">
              Ctrl ↵
            </span>
          </button>
        </div>
      </div>

      {/* ── Main IDE Body ──────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Queries Sub-Sidebar */}
        {showLeftSidebar && (
          <aside className="w-56 shrink-0 border-r border-border bg-sidebar flex flex-col overflow-hidden">
            <div className="p-2 border-b border-sidebar-border">
              <div className="relative">
                <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground/60" />
                <Input
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Search queries..."
                  className="h-7 pl-7 text-xs bg-background/50"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
              <p className="px-2 py-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                Saved Queries
              </p>
              {filteredQueries.map((q) => (
                <div
                  key={q.id}
                  onClick={() => setActiveQueryId(q.id)}
                  className={cn(
                    'group flex items-center justify-between px-2 py-1.5 rounded-md text-xs cursor-pointer transition-colors',
                    activeQueryId === q.id
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
                  )}
                >
                  <div className="flex items-center gap-2 truncate">
                    <FileCode2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    <span className="truncate">{q.name}</span>
                  </div>
                  {queries.length > 1 && (
                    <button
                      onClick={(e) => handleDeleteQuery(q.id, e)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}

              <div className="pt-3">
                <p className="px-2 py-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                  Templates
                </p>
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleSelectSnippet(t)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors text-left truncate"
                  >
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span className="truncate">{t.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        )}

        {/* Center: Monaco Editor & Bottom Results */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Top Monaco Editor Pane */}
          <div className="flex-[3] min-h-[220px] overflow-hidden bg-[#171717] border-b border-border">
            <MonacoEditor
              height="100%"
              language="sql"
              value={sqlCode}
              onChange={(v) => setSqlCode(v ?? '')}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                tabSize: 2,
                renderLineHighlight: 'line',
                smoothScrolling: true,
                cursorBlinking: 'smooth',
                padding: { top: 10, bottom: 10 },
                lineNumbersMinChars: 3,
                folding: false,
              }}
            />
          </div>

          {/* Bottom Results Pane (Supabase Style) */}
          <div className="flex-[2] min-h-[180px] flex flex-col bg-background overflow-hidden">
            {/* Tabs Header */}
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3 bg-muted/20">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setActiveTab('results')}
                  className={cn(
                    'px-3 py-1 text-xs font-medium rounded transition-colors',
                    activeTab === 'results'
                      ? 'bg-background text-foreground shadow-sm font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  Results {result ? `(${result.rowCount})` : ''}
                </button>
                <button
                  onClick={() => setActiveTab('chart')}
                  className={cn(
                    'px-3 py-1 text-xs font-medium rounded transition-colors flex items-center gap-1',
                    activeTab === 'chart'
                      ? 'bg-background text-foreground shadow-sm font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <BarChart3 className="h-3 w-3" />
                  Chart
                </button>
              </div>

              {/* Status and Action Buttons */}
              <div className="flex items-center gap-2">
                {status === 'success' && result && (
                  <>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {result.rowCount} {result.rowCount === 1 ? 'row' : 'rows'} · {result.executionTimeMs}ms
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={copyCsv}
                      className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                    >
                      {copiedCsv ? (
                        <Check className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      {copiedCsv ? 'Copied' : 'Copy CSV'}
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Results Content Area */}
            <div className="flex-1 overflow-auto p-0">
              {/* Idle State (Matches Supabase screenshot exactly!) */}
              {status === 'idle' && (
                <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
                  <p>
                    Click <strong className="text-foreground font-semibold">Run</strong> to execute your query
                  </p>
                </div>
              )}

              {/* Running State */}
              {status === 'running' && (
                <div className="flex h-full items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
                  <span>Executing query in PostgreSQL...</span>
                </div>
              )}

              {/* Error State */}
              {status === 'error' && queryError && (
                <div className="p-4 space-y-1.5">
                  <div className="flex items-center gap-2 text-destructive text-xs font-semibold">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>Query Error</span>
                  </div>
                  <pre className="p-3 rounded-md bg-destructive/10 border border-destructive/20 font-mono text-xs text-destructive whitespace-pre-wrap">
                    {queryError.message}
                  </pre>
                  {queryError.hint && (
                    <p className="text-xs text-muted-foreground">Hint: {queryError.hint}</p>
                  )}
                </div>
              )}

              {/* Success Data Table */}
              {status === 'success' && result && (
                <>
                  {result.rowCount === 0 ? (
                    <div className="p-6 text-center text-xs text-muted-foreground">
                      Success. Query returned 0 rows.
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
                        <tr>
                          <th className="py-2 px-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-12 text-center border-r border-border">
                            #
                          </th>
                          {result.columns.map((col) => (
                            <th
                              key={col}
                              className="py-2 px-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider font-mono border-r border-border"
                            >
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border font-mono">
                        {result.rows.map((row, i) => (
                          <tr key={i} className="hover:bg-muted/40 transition-colors">
                            <td className="py-2 px-3 text-muted-foreground/60 text-center border-r border-border">
                              {i + 1}
                            </td>
                            {result.columns.map((col) => {
                              const val = row[col];
                              return (
                                <td key={col} className="py-2 px-3 border-r border-border truncate max-w-xs">
                                  {val === null || val === undefined ? (
                                    <span className="italic text-muted-foreground/40">null</span>
                                  ) : typeof val === 'object' ? (
                                    JSON.stringify(val)
                                  ) : (
                                    String(val)
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right Templates Drawer (Matches Supabase screenshot!) */}
        {showTemplatesDrawer && (
          <aside className="w-72 shrink-0 border-l border-border bg-card/60 p-4 flex flex-col gap-3 overflow-y-auto hidden xl:flex">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-emerald-500 uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                PREVIEW
              </span>
              <button
                onClick={() => setShowTemplatesDrawer(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>

            <div>
              <h3 className="text-sm font-semibold">User growth</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Track how your user base is trending over time.
              </p>
            </div>

            {/* Code preview block */}
            <div className="rounded-md bg-[#131313] p-3 border border-border/80 font-mono text-[11px] text-muted-foreground space-y-1">
              <p className="text-emerald-400">select</p>
              <p className="pl-2">date_trunc(&apos;week&apos;, created_at) as week,</p>
              <p className="pl-2">count(distinct id) as active_users</p>
              <p className="text-emerald-400">from auth.users</p>
              <p className="text-emerald-400">group by 1;</p>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const growthSnippet = TEMPLATES[0]!;
                handleSelectSnippet(growthSnippet);
              }}
              className="w-full text-xs gap-1.5"
            >
              <Sparkles className="h-3 w-3 text-emerald-500" />
              Insert template
            </Button>

            <div className="mt-4 pt-4 border-t border-border space-y-2">
              <h4 className="text-xs font-semibold text-foreground">Explorer & Notebooks</h4>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Run complex multi-table SQL queries, inspect tables, and preview schema directly on your PostgreSQL database.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleSelectSnippet(TEMPLATES[1]!)}
                className="w-full text-xs mt-2"
              >
                Inspect table sizes
              </Button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
