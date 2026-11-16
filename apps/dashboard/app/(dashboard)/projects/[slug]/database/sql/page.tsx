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
  ChevronRight,
  Database,
  Table2,
  Clock,
  Copy,
  Check,
  Search,
  Sparkles,
  BarChart3,
  ListFilter,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Star,
  MoreVertical,
  MoreHorizontal,
  X,
  FileCode,
  Share2,
  History,
  Edit2,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { useTheme } from '@/providers/theme-provider';

// Monaco editor — client-side dynamic load with hydration-safe fallback
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-background text-xs text-muted-foreground font-mono">
      Loading SQL editor...
    </div>
  ),
});

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

interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  folder: 'shared' | 'favorites' | 'private' | 'logs';
  isFavorite?: boolean;
  createdAt: number;
  updatedAt: number;
}

const TEMPLATES: { id: string; name: string; sql: string }[] = [
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

const DEFAULT_SQL = `-- DUGSIHUB UNIFIED DATABASE SETUP
CREATE TABLE IF NOT EXISTS public.schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT,
  logo TEXT,
  city TEXT DEFAULT 'Mogadishu',
  country TEXT DEFAULT 'Somalia',
  curriculum TEXT DEFAULT 'Somali National Curriculum',
  principal_name TEXT DEFAULT 'Principal',
  email TEXT,
  phone TEXT,
  address TEXT,
  academic_year TEXT DEFAULT '2025/2026',
  current_term TEXT DEFAULT 'Term 2',
  student_count INT DEFAULT 0,
  teacher_count INT DEFAULT 0,
  subscription_plan TEXT DEFAULT 'professional',
  subscription_status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.classes (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  name TEXT NOT NULL,
  section TEXT DEFAULT 'A',
  room_number TEXT DEFAULT '101',
  capacity INT DEFAULT 40,
  enrolled_count INT DEFAULT 0,
  class_teacher_id TEXT,
  class_teacher_name TEXT,
  academic_year TEXT DEFAULT '2025/2026',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const INITIAL_QUERIES: SavedQuery[] = [
  {
    id: 'q-1',
    name: 'Untitled query',
    sql: DEFAULT_SQL,
    folder: 'private',
    isFavorite: false,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'q-2',
    name: 'Untitled query',
    sql: '-- Query 2\nSELECT * FROM public.schools LIMIT 10;',
    folder: 'private',
    isFavorite: false,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'q-3',
    name: 'Untitled query',
    sql: '-- Query 3\nSELECT * FROM public.students LIMIT 10;',
    folder: 'private',
    isFavorite: false,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
];

export default function SqlEditorPage() {
  const params = useParams();
  const slug = params.slug as string;
  const storageKey = `skynode_sql_queries_${slug}`;
  const { resolvedTheme } = useTheme();

  // Initial Queries — initialized with constant to ensure identical SSR and client hydration
  const [queries, setQueries] = React.useState<SavedQuery[]>(INITIAL_QUERIES);

  // Open tabs list (query IDs)
  const [openTabIds, setOpenTabIds] = React.useState<string[]>(['q-1', 'q-2']);
  const [activeQueryId, setActiveQueryId] = React.useState<string>('q-1');

  // Load stored queries from localStorage safely after client hydration
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setQueries(parsed);
          if (!parsed.some((q: SavedQuery) => q.id === activeQueryId)) {
            setActiveQueryId(parsed[0].id);
          }
        }
      }
    } catch {}
  }, [storageKey]);

  // Active query code & dirty tracking
  const activeQuery = queries.find((q) => q.id === activeQueryId) ?? queries[0]!;
  const [sqlCode, setSqlCode] = React.useState(activeQuery?.sql ?? DEFAULT_SQL);
  const [dirtyQueries, setDirtyQueries] = React.useState<Record<string, boolean>>({});
  const [savedFeedback, setSavedFeedback] = React.useState(false);

  // Group collapses in sidebar
  const [collapsedGroups, setCollapsedGroups] = React.useState<Record<string, boolean>>({
    shared: true,
    favorites: true,
    private: false, // private is open by default
    logs: true,
  });

  // UI state
  const [searchFilter, setSearchFilter] = React.useState('');
  const [showLeftSidebar, setShowLeftSidebar] = React.useState(true);
  const [editingTitleId, setEditingTitleId] = React.useState<string | null>(null);
  const [editingTitleText, setEditingTitleText] = React.useState('');
  const [selectedText, setSelectedText] = React.useState('');

  // Results & Execution state
  const [activeTab, setActiveTab] = React.useState<'results' | 'chart'>('results');
  const [result, setResult] = React.useState<QueryResult | null>(null);
  const [queryError, setQueryError] = React.useState<QueryError | null>(null);
  const [status, setStatus] = React.useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [copiedCsv, setCopiedCsv] = React.useState(false);

  // Persist queries to localStorage
  const saveQueriesToStorage = React.useCallback(
    (newQueries: SavedQuery[]) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(newQueries));
      } catch (err) {
        console.error('Failed to save queries to localStorage', err);
      }
    },
    [storageKey]
  );

  // When switching active tab, update editor code
  React.useEffect(() => {
    if (activeQuery) {
      setSqlCode(activeQuery.sql);
      setResult(null);
      setQueryError(null);
      setStatus('idle');
    }
  }, [activeQueryId]);

  // Handle Code changes in Monaco
  function handleCodeChange(newCode: string | undefined) {
    const val = newCode ?? '';
    setSqlCode(val);
    if (activeQuery && val !== activeQuery.sql) {
      setDirtyQueries((prev) => ({ ...prev, [activeQueryId]: true }));
    } else {
      setDirtyQueries((prev) => ({ ...prev, [activeQueryId]: false }));
    }
  }

  // Create new untitled query
  function handleCreateNewQuery() {
    const newId = `q-${Date.now()}`;
    const newQuery: SavedQuery = {
      id: newId,
      name: 'Untitled query',
      sql: `-- Untitled query\nSELECT 1;\n`,
      folder: 'private',
      isFavorite: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const updated = [newQuery, ...queries];
    setQueries(updated);
    saveQueriesToStorage(updated);
    setOpenTabIds((prev) => [...prev, newId]);
    setActiveQueryId(newId);
  }

  // Select query to open in tab
  function handleOpenQuery(id: string) {
    if (!openTabIds.includes(id)) {
      setOpenTabIds((prev) => [...prev, id]);
    }
    setActiveQueryId(id);
  }

  // Close tab
  function handleCloseTab(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const remaining = openTabIds.filter((tId) => tId !== id);
    setOpenTabIds(remaining);
    if (activeQueryId === id) {
      if (remaining.length > 0) {
        setActiveQueryId(remaining[remaining.length - 1]!);
      }
    }
  }

  // Save current query
  function handleSaveQuery() {
    if (!activeQuery) return;

    // Smart auto-title extraction if untitled and starts with comment
    let newName = activeQuery.name;
    if (activeQuery.name === 'Untitled query') {
      const match = sqlCode.trim().match(/^--\s*([^\n\r]+)/);
      if (match && match[1]?.trim()) {
        newName = match[1].trim();
      }
    }

    const updated = queries.map((q) =>
      q.id === activeQueryId
        ? { ...q, sql: sqlCode, name: newName, updatedAt: Date.now() }
        : q
    );

    setQueries(updated);
    saveQueriesToStorage(updated);
    setDirtyQueries((prev) => ({ ...prev, [activeQueryId]: false }));

    // Show saved feedback indicator
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2000);
  }

  // Delete query
  function handleDeleteQuery(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (queries.length <= 1) return;
    const remaining = queries.filter((q) => q.id !== id);
    setQueries(remaining);
    saveQueriesToStorage(remaining);
    setOpenTabIds((prev) => prev.filter((tId) => tId !== id));
    if (activeQueryId === id) {
      setActiveQueryId(remaining[0]!.id);
    }
  }

  // Toggle favorite
  function handleToggleFavorite(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const updated = queries.map((q) =>
      q.id === id ? { ...q, isFavorite: !q.isFavorite } : q
    );
    setQueries(updated);
    saveQueriesToStorage(updated);
  }

  // Rename query
  function handleStartRename(q: SavedQuery, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingTitleId(q.id);
    setEditingTitleText(q.name);
  }

  function handleFinishRename() {
    if (!editingTitleId) return;
    const trimmed = editingTitleText.trim() || 'Untitled query';
    const updated = queries.map((q) =>
      q.id === editingTitleId ? { ...q, name: trimmed, updatedAt: Date.now() } : q
    );
    setQueries(updated);
    saveQueriesToStorage(updated);
    setEditingTitleId(null);
  }

  // Run SQL Query against backend
  async function runQuery() {
    // If text is selected in editor, run only the selected SQL; otherwise run full code
    const sqlToExecute = selectedText.trim() || sqlCode.trim();
    if (!sqlToExecute) return;

    setStatus('running');
    setResult(null);
    setQueryError(null);

    const res = await api.post<QueryResult>(`/api/v1/projects/${slug}/database/query`, {
      sql: sqlToExecute,
    });

    if (!res.success) {
      setQueryError({ message: res.error?.message ?? 'Query execution failed' });
      setStatus('error');
    } else {
      const data = (res.data as any)?.data ?? res.data;
      setResult(data ?? null);
      setStatus('success');
      // Auto-save query on successful run
      handleSaveQuery();
    }
  }

  // Keyboard shortcut listener (Ctrl+Enter, Ctrl+S)
  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      runQuery();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      handleSaveQuery();
    }
  }

  // Filter queries
  const filteredQueries = queries.filter((q) =>
    q.name.toLowerCase().includes(searchFilter.toLowerCase())
  );
  const favoriteQueries = filteredQueries.filter((q) => q.isFavorite);
  const privateQueries = filteredQueries.filter((q) => q.folder === 'private');

  // Copy CSV
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

  const isCurrentDirty = dirtyQueries[activeQueryId] ?? false;

  return (
    <div
      className="flex flex-col h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-background select-none text-foreground"
      onKeyDown={handleKeyDown}
    >
      {/* ── Top Header / Tab Bar (Supabase Style) ───────────────── */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-muted/40 px-2 gap-2">
        {/* Left: Sidebar Toggle + Open Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1">
          <button
            onClick={() => setShowLeftSidebar(!showLeftSidebar)}
            className="flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 shadow-xs"
            title="Toggle SQL Editor sidebar"
          >
            <PanelLeft className="h-3.5 w-3.5" />
          </button>

          <div className="h-4 w-px bg-border mx-1 shrink-0" />

          {/* Open Tabs */}
          {openTabIds.map((tabId) => {
            const query = queries.find((q) => q.id === tabId);
            if (!query) return null;
            const isActive = tabId === activeQueryId;
            const isDirty = dirtyQueries[tabId] ?? false;

            return (
              <div
                key={tabId}
                onClick={() => setActiveQueryId(tabId)}
                className={cn(
                  'group flex items-center gap-2 h-7 px-2.5 rounded-t text-xs cursor-pointer select-none border transition-all shrink-0',
                  isActive
                    ? 'bg-background border-border border-b-transparent text-foreground font-medium shadow-xs'
                    : 'bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/60'
                )}
              >
                {/* [SQL] Badge Icon */}
                <span className="rounded bg-muted px-1 py-0.2 text-[9px] font-mono text-muted-foreground font-bold tracking-wider">
                  SQL
                </span>

                <span className="truncate max-w-[150px] italic font-normal text-xs">
                  {query.name}
                </span>

                {/* Dirty indicator or close button */}
                <div className="flex items-center justify-center w-3.5 h-3.5 ml-0.5">
                  {isDirty ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 group-hover:hidden" />
                  ) : null}
                  <button
                    onClick={(e) => handleCloseTab(tabId, e)}
                    className={cn(
                      'h-3.5 w-3.5 rounded flex items-center justify-center hover:bg-white/10 text-muted-foreground hover:text-foreground',
                      isDirty ? 'hidden group-hover:flex' : 'opacity-0 group-hover:opacity-100'
                    )}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              </div>
            );
          })}

          {/* + Add Query Tab */}
          <button
            onClick={handleCreateNewQuery}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors shrink-0"
            title="Create new query"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Right Action Bar */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Saved Status Indicator */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono mr-1">
            {savedFeedback ? (
              <span className="flex items-center gap-1 text-emerald-400 text-[11px]">
                <Check className="h-3 w-3" /> Saved
              </span>
            ) : isCurrentDirty ? (
              <span className="flex items-center gap-1 text-amber-400 text-[11px]">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Unsaved
              </span>
            ) : (
              <span className="text-muted-foreground/60 text-[11px]">Saved</span>
            )}
          </div>

          {/* More options menu */}
          <button className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted">
            <MoreVertical className="h-3.5 w-3.5" />
          </button>

          {/* Database Selector Pill */}
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground font-mono shadow-xs">
            <Database className="h-3.5 w-3.5 text-emerald-500" />
            <span>Database</span>
            <ChevronDown className="h-3 w-3 text-muted-foreground opacity-60" />
          </div>

          {/* Save Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSaveQuery}
            className="h-7 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
            title="Save query (Ctrl+S)"
          >
            <Save className="h-3.5 w-3.5" />
            <span>Save</span>
            <span className="text-[10px] text-muted-foreground/60 font-mono">Ctrl S</span>
          </Button>

          {/* Prominent Emerald Run Button */}
          <button
            onClick={runQuery}
            disabled={status === 'running'}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-all',
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
            <span>{selectedText.trim() ? 'Run selected' : 'Run'}</span>
            <span className="rounded bg-emerald-700/80 px-1 py-0.2 text-[10px] font-mono text-emerald-100">
              Ctrl ↵
            </span>
          </button>
        </div>
      </div>

      {/* ── Main IDE Body ──────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Queries Tree Sidebar (Supabase Style) */}
        {showLeftSidebar && (
          <aside className="w-60 shrink-0 border-r border-border bg-sidebar flex flex-col overflow-hidden">
            {/* Header: SQL Editor title */}
            <div className="flex h-9 items-center justify-between px-3 border-b border-border/60">
              <span className="text-xs font-semibold tracking-wide text-foreground">
                SQL Editor
              </span>
              <button
                onClick={handleCreateNewQuery}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                title="New query"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Search row with sort + new */}
            <div className="p-2 border-b border-border/60 flex items-center gap-1.5">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground/60" />
                <Input
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Search queries..."
                  className="h-7 pl-6 pr-2 text-xs bg-background border-border font-mono"
                />
              </div>
              <button
                onClick={handleCreateNewQuery}
                className="flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 shadow-xs"
                title="New query"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Tree Navigation: SHARED, FAVORITES, PRIVATE (3), LOGS */}
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1 text-xs">
              {/* 1. SHARED */}
              <div>
                <button
                  onClick={() =>
                    setCollapsedGroups((prev) => ({ ...prev, shared: !prev.shared }))
                  }
                  className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider hover:text-foreground transition-colors"
                >
                  {collapsedGroups.shared ? (
                    <ChevronRight className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  <span>SHARED</span>
                </button>
                {!collapsedGroups.shared && (
                  <div className="pl-4 py-1 text-[11px] text-muted-foreground/50 italic">
                    No shared queries
                  </div>
                )}
              </div>

              {/* 2. FAVORITES */}
              <div>
                <button
                  onClick={() =>
                    setCollapsedGroups((prev) => ({ ...prev, favorites: !prev.favorites }))
                  }
                  className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider hover:text-foreground transition-colors"
                >
                  {collapsedGroups.favorites ? (
                    <ChevronRight className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  <span>FAVORITES</span>
                  {favoriteQueries.length > 0 && (
                    <span className="text-[10px] text-muted-foreground/60 ml-0.5">
                      ({favoriteQueries.length})
                    </span>
                  )}
                </button>
                {!collapsedGroups.favorites && (
                  <div className="space-y-0.5 pl-2">
                    {favoriteQueries.length === 0 ? (
                      <div className="py-1 text-[11px] text-muted-foreground/50 italic pl-2">
                        No favorites yet
                      </div>
                    ) : (
                      favoriteQueries.map((q) => (
                        <div
                          key={q.id}
                          onClick={() => handleOpenQuery(q.id)}
                          className={cn(
                            'group flex items-center justify-between px-2 py-1 rounded text-xs cursor-pointer transition-colors',
                            activeQueryId === q.id
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                          )}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span className="rounded bg-muted px-1 py-0.2 text-[8px] font-mono text-muted-foreground font-bold">
                              SQL
                            </span>
                            <span className="truncate">{q.name}</span>
                          </div>
                          <Star
                            onClick={(e) => handleToggleFavorite(q.id, e)}
                            className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0"
                          />
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* 3. PRIVATE (N) — Expanded in Screenshot */}
              <div>
                <button
                  onClick={() =>
                    setCollapsedGroups((prev) => ({ ...prev, private: !prev.private }))
                  }
                  className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider hover:text-foreground transition-colors"
                >
                  {collapsedGroups.private ? (
                    <ChevronRight className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  <span>PRIVATE ({privateQueries.length})</span>
                </button>

                {!collapsedGroups.private && (
                  <div className="space-y-0.5 pl-1">
                    {privateQueries.map((q) => {
                      const isActive = activeQueryId === q.id;
                      const isEditing = editingTitleId === q.id;

                      return (
                        <div
                          key={q.id}
                          onClick={() => handleOpenQuery(q.id)}
                          onDoubleClick={(e) => handleStartRename(q, e)}
                          className={cn(
                            'group flex items-center justify-between px-2 py-1.5 rounded text-xs cursor-pointer transition-colors',
                            isActive
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                          )}
                        >
                          <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                            {/* [SQL] Badge */}
                            <span className="rounded bg-muted px-1 py-0.2 text-[8px] font-mono text-muted-foreground font-bold shrink-0">
                              SQL
                            </span>

                            {isEditing ? (
                              <input
                                autoFocus
                                value={editingTitleText}
                                onChange={(e) => setEditingTitleText(e.target.value)}
                                onBlur={handleFinishRename}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleFinishRename();
                                  if (e.key === 'Escape') setEditingTitleId(null);
                                }}
                                className="h-5 px-1 bg-background text-foreground text-xs rounded border border-emerald-500 w-full outline-none"
                              />
                            ) : (
                              <span className="truncate italic font-normal">{q.name}</span>
                            )}
                          </div>

                          {/* Quick Actions (Favorite + Delete) */}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-1">
                            <button
                              onClick={(e) => handleToggleFavorite(q.id, e)}
                              className="text-muted-foreground hover:text-amber-400"
                              title="Favorite"
                            >
                              <Star
                                className={cn(
                                  'h-3 w-3',
                                  q.isFavorite && 'fill-amber-400 text-amber-400'
                                )}
                              />
                            </button>
                            <button
                              onClick={(e) => handleStartRename(q, e)}
                              className="text-muted-foreground hover:text-foreground"
                              title="Rename"
                            >
                              <Edit2 className="h-2.5 w-2.5" />
                            </button>
                            {queries.length > 1 && (
                              <button
                                onClick={(e) => handleDeleteQuery(q.id, e)}
                                className="text-muted-foreground hover:text-destructive"
                                title="Delete query"
                              >
                                <Trash2 className="h-2.5 w-2.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 4. LOGS */}
              <div>
                <button
                  onClick={() =>
                    setCollapsedGroups((prev) => ({ ...prev, logs: !prev.logs }))
                  }
                  className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider hover:text-foreground transition-colors"
                >
                  {collapsedGroups.logs ? (
                    <ChevronRight className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  <span>LOGS</span>
                </button>
                {!collapsedGroups.logs && (
                  <div className="pl-4 py-1 text-[11px] text-muted-foreground/50 italic">
                    No query logs
                  </div>
                )}
              </div>

              {/* Templates section */}
              <div className="pt-4 border-t border-border/40">
                <span className="px-2 py-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider block">
                  TEMPLATES
                </span>
                <div className="space-y-0.5 mt-1">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        const newId = `t-${Date.now()}`;
                        const newQuery: SavedQuery = {
                          id: newId,
                          name: t.name,
                          sql: t.sql,
                          folder: 'private',
                          isFavorite: false,
                          createdAt: Date.now(),
                          updatedAt: Date.now(),
                        };
                        const updated = [newQuery, ...queries];
                        setQueries(updated);
                        saveQueriesToStorage(updated);
                        setOpenTabIds((prev) => [...prev, newId]);
                        setActiveQueryId(newId);
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors text-left truncate"
                    >
                      <Sparkles className="h-3 w-3 shrink-0 text-amber-500" />
                      <span className="truncate">{t.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        )}

        {/* Center: Monaco Editor & Bottom Results */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Top Monaco Editor Pane */}
          <div className="flex-[3] min-h-[240px] overflow-hidden bg-background border-b border-border">
            <MonacoEditor
              height="100%"
              language="sql"
              value={sqlCode}
              onChange={handleCodeChange}
              onMount={(editor) => {
                editor.onDidChangeCursorSelection(() => {
                  const selection = editor.getSelection();
                  if (selection && !selection.isEmpty()) {
                    const text = editor.getModel()?.getValueInRange(selection);
                    setSelectedText(text ?? '');
                  } else {
                    setSelectedText('');
                  }
                });
              }}
              theme={resolvedTheme === 'light' ? 'vs' : 'vs-dark'}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                fontFamily: 'Consolas, "Fira Code", monospace',
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

          {/* Bottom Results & Chart Area */}
          <div className="flex-[2] min-h-[160px] flex flex-col overflow-hidden bg-background">
            {/* Results Tab Bar */}
            <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-card px-4">
              <div className="flex items-center gap-4 text-xs font-medium">
                <button
                  onClick={() => setActiveTab('results')}
                  className={cn(
                    'h-8 border-b-2 transition-colors flex items-center gap-1.5',
                    activeTab === 'results'
                      ? 'border-emerald-500 text-foreground font-semibold'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Table2 className="h-3.5 w-3.5" />
                  Results
                  {result && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      ({result.rowCount})
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setActiveTab('chart')}
                  className={cn(
                    'h-8 border-b-2 transition-colors flex items-center gap-1.5',
                    activeTab === 'chart'
                      ? 'border-emerald-500 text-foreground font-semibold'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                  Chart
                </button>
              </div>

              {/* Status and Action Helpers */}
              <div className="flex items-center gap-3 text-xs">
                {status === 'running' && (
                  <span className="flex items-center gap-1.5 text-muted-foreground text-xs font-mono">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    Executing query...
                  </span>
                )}

                {status === 'success' && result && (
                  <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                    <span className="flex items-center gap-1 text-emerald-500">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Success
                    </span>
                    <span>{result.rowCount} rows</span>
                    <span>{result.executionTimeMs}ms</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={copyCsv}
                      className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {copiedCsv ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      CSV
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Content Body */}
            <div className="flex-1 overflow-auto p-4 font-mono text-xs">
              {status === 'idle' && !result && !queryError && (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                  <p>Click <strong className="text-foreground">Run</strong> to execute your query</p>
                  <span className="text-[11px] text-muted-foreground/60">
                    Use Ctrl+Enter to run instantly, Ctrl+S to save
                  </span>
                </div>
              )}

              {queryError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertCircle className="h-4 w-4" />
                    <span>Query Error</span>
                  </div>
                  <p className="mt-1 text-xs whitespace-pre-wrap">{queryError.message}</p>
                </div>
              )}

              {result && activeTab === 'results' && (
                <div className="h-full overflow-auto border border-border rounded-md">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-muted/40 sticky top-0 z-10 border-b border-border">
                      <tr>
                        {result.columns.map((col) => (
                          <th key={col} className="px-3 py-2 font-semibold text-muted-foreground border-r border-border last:border-r-0 whitespace-nowrap">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {result.rows.length === 0 ? (
                        <tr>
                          <td colSpan={result.columns.length} className="px-3 py-6 text-center text-muted-foreground">
                            No rows returned
                          </td>
                        </tr>
                      ) : (
                        result.rows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-muted/20 transition-colors">
                            {result.columns.map((col) => {
                              const val = row[col];
                              return (
                                <td key={col} className="px-3 py-1.5 border-r border-border last:border-r-0 whitespace-nowrap max-w-xs truncate">
                                  {val === null || val === undefined ? (
                                    <span className="text-muted-foreground/40 italic">NULL</span>
                                  ) : typeof val === 'object' ? (
                                    JSON.stringify(val)
                                  ) : (
                                    String(val)
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {result && activeTab === 'chart' && (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                  <BarChart3 className="h-8 w-8 text-emerald-500 opacity-60" />
                  <p>Chart visualization ready for {result.rowCount} data rows</p>
                  <p className="text-[11px] text-muted-foreground/60">
                    Switch to Results view to inspect or export CSV data
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
