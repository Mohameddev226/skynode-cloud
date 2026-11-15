'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import {
  Plus,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe,
  Filter,
  ArrowUpDown,
  Shield,
  Trash2,
  Pencil,
  MoreHorizontal,
  Table2,
  X,
  Check,
  Columns,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { CreateTableModal } from '@/components/database/create-table-modal';

/* ─── Types ────────────────────────────────────────────────── */
interface TableInfo {
  name: string;
  schema: string;
  rowCount: number;
  sizeBytes: number;
}

interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimary: boolean;
}

interface RecordsResponse {
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
}

/* ─── Helpers ───────────────────────────────────────────────── */
const TYPE_LABEL: Record<string, string> = {
  'uuid': 'uuid',
  'text': 'text',
  'character varying': 'varchar',
  'integer': 'int4',
  'bigint': 'int8',
  'boolean': 'bool',
  'timestamp without time zone': 'timestamp',
  'timestamp with time zone': 'timestamptz',
  'numeric': 'numeric',
  'jsonb': 'jsonb',
  'json': 'json',
  'date': 'date',
  'real': 'float4',
  'double precision': 'float8',
};

function shortType(dt: string) {
  return TYPE_LABEL[dt.toLowerCase()] ?? dt.split(' ')[0]!.toLowerCase();
}

function cellStr(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

const PAGE_SIZE = 100;

/* ─── Main Component ────────────────────────────────────────── */
export default function TableEditorPage() {
  const params = useParams();
  const slug = params.slug as string;

  /* sidebar */
  const [tables, setTables] = React.useState<TableInfo[]>([]);
  const [tablesLoading, setTablesLoading] = React.useState(true);
  const [schema, setSchema] = React.useState('public');
  const [tableSearch, setTableSearch] = React.useState('');
  const [activeTable, setActiveTable] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  /* grid */
  const [columns, setColumns] = React.useState<ColumnInfo[]>([]);
  const [rows, setRows] = React.useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [gridLoading, setGridLoading] = React.useState(false);
  const [gridError, setGridError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = React.useState<'data' | 'definition'>('data');
  const [filterText, setFilterText] = React.useState('');
  const [openTabs, setOpenTabs] = React.useState<string[]>([]);

  /* load table list */
  async function loadTables() {
    setTablesLoading(true);
    const res = await api.get<TableInfo[]>(`/api/v1/projects/${slug}/database/tables`);
    if (res.success && res.data) {
      const list = Array.isArray(res.data) ? res.data : (res.data as any).data ?? [];
      setTables(list);
      if (!activeTable && list.length > 0) {
        setActiveTable(list[0].name);
        setOpenTabs([list[0].name]);
      }
    }
    setTablesLoading(false);
  }

  React.useEffect(() => { loadTables(); }, [slug]);

  /* load grid data when table changes */
  async function loadTableData(tableName: string, pg = 1) {
    setGridLoading(true);
    setGridError(null);
    setSelected(new Set());

    const [schemaRes, recordsRes] = await Promise.all([
      api.get<{ columns: ColumnInfo[] }>(`/api/v1/projects/${slug}/database/tables/${tableName}?schema=${schema}`),
      api.get<RecordsResponse>(`/api/v1/projects/${slug}/database/tables/${tableName}/records?schema=${schema}&page=${pg}&limit=${PAGE_SIZE}`),
    ]);

    if (schemaRes.success && schemaRes.data) {
      const d = (schemaRes.data as any).data ?? schemaRes.data;
      setColumns(d.columns ?? []);
    }
    if (recordsRes.success && recordsRes.data) {
      const d = (recordsRes.data as any).data ?? recordsRes.data;
      setRows(d.rows ?? []);
      setTotal(d.total ?? 0);
      setPage(pg);
    } else {
      setGridError(recordsRes.error?.message ?? 'Failed to load records');
    }
    setGridLoading(false);
  }

  React.useEffect(() => {
    if (activeTable) loadTableData(activeTable, 1);
  }, [activeTable, schema]);

  function openTable(name: string) {
    setActiveTable(name);
    setActiveTab('data');
    setOpenTabs((prev) => (prev.includes(name) ? prev : [...prev, name]));
  }

  function closeTab(name: string, e: React.MouseEvent) {
    e.stopPropagation();
    const next = openTabs.filter((t) => t !== name);
    setOpenTabs(next);
    if (activeTable === name) setActiveTable(next[next.length - 1] ?? null);
  }

  /* row selection */
  const allSelected = rows.length > 0 && selected.size === rows.length;
  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((_, i) => i)));
  }
  function toggleRow(i: number) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  }

  const filteredTables = tables.filter((t) =>
    t.name.toLowerCase().includes(tableSearch.toLowerCase())
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const startRow = (page - 1) * PAGE_SIZE + 1;
  const endRow = Math.min(page * PAGE_SIZE, total);

  /* ─── Render ───────────────────────────────────────────────── */
  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-background">

      {/* ── Left Sidebar ──────────────────────────────────────── */}
      <aside className="w-56 shrink-0 flex flex-col border-r border-border bg-[#1c1c1c] overflow-hidden">
        {/* Schema selector */}
        <div className="px-3 py-2 border-b border-border">
          <button className="w-full flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs text-foreground bg-background/60 border border-border hover:border-emerald-500/50 transition-colors">
            <div className="flex items-center gap-1.5">
              <Globe className="h-3 w-3 text-emerald-400" />
              <span className="font-mono">schema {schema}</span>
            </div>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
        </div>

        {/* New table + search */}
        <div className="px-3 py-2 space-y-2 border-b border-border">
          <Button
            size="sm"
            variant="outline"
            className="w-full h-7 text-xs justify-start gap-1.5"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" /> New table
          </Button>
          <div className="relative">
            <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="Search tables..."
              className="h-7 pl-7 text-xs bg-background/50"
            />
          </div>
        </div>

        {/* Table list */}
        <div className="flex-1 overflow-y-auto py-1">
          {tablesLoading ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">Loading...</div>
          ) : filteredTables.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">No tables</div>
          ) : (
            filteredTables.map((t) => (
              <button
                key={t.name}
                onClick={() => openTable(t.name)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors group',
                  activeTable === t.name
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                )}
              >
                <Table2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate font-mono">{t.name}</span>
                <Globe className="h-2.5 w-2.5 ml-auto shrink-0 opacity-50" />
              </button>
            ))
          )}
        </div>
      </aside>

      {/* ── Main Area ─────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Table tabs bar */}
        <div className="flex h-9 shrink-0 items-center border-b border-border bg-[#1c1c1c] px-1 gap-0.5 overflow-x-auto">
          {openTabs.map((name) => (
            <div
              key={name}
              onClick={() => { setActiveTable(name); setActiveTab('data'); }}
              className={cn(
                'flex items-center gap-1.5 h-7 px-3 rounded-t text-xs cursor-pointer select-none group transition-colors shrink-0',
                activeTable === name
                  ? 'bg-background text-foreground border border-b-0 border-border'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
              )}
            >
              <Table2 className="h-3 w-3" />
              <span className="font-mono">{name}</span>
              <button
                onClick={(e) => closeTab(name, e)}
                className="h-3.5 w-3.5 rounded-sm flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white/10"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
          {openTabs.length > 0 && (
            <button
              className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-white/5 ml-1"
              title="New tab"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {activeTable ? (
          <>
            {/* ── Toolbar ───────────────────────────────────────── */}
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-background px-3 gap-2">
              {/* Left: filter + sort + rls */}
              <div className="flex items-center gap-1.5">
                {/* Filter */}
                <div className="relative flex items-center">
                  <Search className="absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    placeholder={`Filter by ${columns[0]?.name ?? 'id'}, ${columns[1]?.name ?? 'name'}, … or ask AI`}
                    className="h-7 pl-7 pr-2 w-80 text-xs bg-background/50 border-border"
                  />
                </div>

                <div className="h-5 w-px bg-border mx-1" />

                <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2">
                  <ArrowUpDown className="h-3.5 w-3.5" /> Sort
                </Button>

                {/* RLS policies badge */}
                <button className="flex items-center gap-1.5 h-7 px-2 rounded text-xs font-medium border border-dashed border-border hover:border-emerald-500/50 text-muted-foreground hover:text-foreground transition-colors">
                  <Shield className="h-3 w-3" />
                  <span>RLS policies</span>
                </button>
              </div>

              {/* Right: role + refresh + insert */}
              <div className="flex items-center gap-1.5">
                <button className="flex items-center gap-1 h-7 px-2 rounded text-xs border border-border text-muted-foreground hover:text-foreground transition-colors">
                  Role <span className="font-semibold text-foreground">postgres</span>
                  <ChevronDown className="h-3 w-3" />
                </button>

                <Button
                  variant="ghost" size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                  title="Refresh"
                  onClick={() => loadTableData(activeTable, page)}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', gridLoading && 'animate-spin')} />
                </Button>

                <Button
                  size="sm"
                  className="h-7 gap-1.5 px-3 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                >
                  <Plus className="h-3.5 w-3.5" /> Insert
                </Button>
              </div>
            </div>

            {/* ── Grid ─────────────────────────────────────────── */}
            <div className="flex-1 overflow-auto">
              {gridError ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center text-sm text-muted-foreground">
                    <p className="text-red-400 font-medium">Error loading data</p>
                    <p className="mt-1">{gridError}</p>
                    <Button size="sm" className="mt-3" onClick={() => loadTableData(activeTable, page)}>Retry</Button>
                  </div>
                </div>
              ) : (
                <table className="w-full text-xs border-collapse min-w-max">
                  <thead className="sticky top-0 z-10 bg-[#1c1c1c]">
                    <tr className="border-b border-border">
                      {/* Checkbox col */}
                      <th className="w-10 px-3 py-2 text-left border-r border-border">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleAll}
                          className="h-3.5 w-3.5 rounded accent-emerald-500"
                        />
                      </th>
                      {columns.map((col) => (
                        <th
                          key={col.name}
                          className="px-3 py-2 text-left font-medium text-muted-foreground border-r border-border whitespace-nowrap min-w-[140px] group hover:bg-white/5 cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            {col.isPrimary && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold">PK</span>
                            )}
                            <span className="text-foreground font-mono">{col.name}</span>
                            <span className="text-[10px] text-muted-foreground/60 font-normal">{shortType(col.dataType)}</span>
                            <ChevronDown className="h-3 w-3 ml-auto opacity-0 group-hover:opacity-60" />
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {gridLoading ? (
                      Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/50">
                          <td className="px-3 py-2 border-r border-border">
                            <div className="h-3 w-3.5 rounded bg-muted animate-pulse" />
                          </td>
                          {Array.from({ length: Math.max(columns.length, 4) }).map((_, j) => (
                            <td key={j} className="px-3 py-2 border-r border-border">
                              <div className="h-3 rounded bg-muted animate-pulse" style={{ width: `${60 + Math.random() * 60}px` }} />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan={columns.length + 1} className="py-16 text-center text-muted-foreground">
                          No rows in this table yet. Click <strong className="text-foreground">Insert</strong> to add one.
                        </td>
                      </tr>
                    ) : (
                      rows.map((row, i) => (
                        <tr
                          key={i}
                          className={cn(
                            'border-b border-border/40 hover:bg-white/[0.03] transition-colors group',
                            selected.has(i) && 'bg-emerald-500/5'
                          )}
                        >
                          <td className="w-10 px-3 py-1.5 border-r border-border/50">
                            <input
                              type="checkbox"
                              checked={selected.has(i)}
                              onChange={() => toggleRow(i)}
                              className="h-3.5 w-3.5 rounded accent-emerald-500"
                            />
                          </td>
                          {columns.map((col) => {
                            const val = row[col.name];
                            const str = cellStr(val);
                            const isNull = val === null || val === undefined;
                            return (
                              <td
                                key={col.name}
                                className="px-3 py-1.5 border-r border-border/50 whitespace-nowrap max-w-[280px] overflow-hidden text-ellipsis"
                              >
                                {isNull ? (
                                  <span className="text-muted-foreground/40 italic text-[11px]">NULL</span>
                                ) : (
                                  <span className={cn(
                                    'font-mono',
                                    col.isPrimary ? 'text-amber-400/80' : 'text-foreground',
                                    typeof val === 'boolean' ? 'text-purple-400' : '',
                                    typeof val === 'number' ? 'text-blue-400' : '',
                                  )}>
                                    {str.length > 60 ? str.slice(0, 60) + '…' : str}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {/* ── Bottom bar ───────────────────────────────────── */}
            <div className="flex h-9 shrink-0 items-center justify-between border-t border-border bg-[#1c1c1c] px-3">
              {/* Tabs: Data / Definition */}
              <div className="flex items-center gap-0.5">
                {(['data', 'definition'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      'h-6 px-3 text-xs rounded capitalize transition-colors',
                      activeTab === tab
                        ? 'bg-background text-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Pagination */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {selected.size > 0 && (
                  <span className="text-emerald-400 font-medium mr-2">{selected.size} selected</span>
                )}
                <span>
                  {total === 0 ? '0 rows' : `${startRow}–${endRow} of ${total} rows`}
                </span>
                <span className="text-muted-foreground/40">|</span>
                <span>{PAGE_SIZE} rows</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => loadTableData(activeTable, page - 1)}
                    disabled={page <= 1 || gridLoading}
                    className="h-5 w-5 flex items-center justify-center rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span>Page {page} of {totalPages}</span>
                  <button
                    onClick={() => loadTableData(activeTable, page + 1)}
                    disabled={page >= totalPages || gridLoading}
                    className="h-5 w-5 flex items-center justify-center rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* Empty state — no table selected */
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <Table2 className="h-10 w-10 opacity-20" />
            <p className="text-sm">Select a table from the sidebar to view data</p>
            <Button size="sm" onClick={() => setCreateOpen(true)} className="mt-1">
              <Plus className="h-3.5 w-3.5 mr-1.5" /> New table
            </Button>
          </div>
        )}
      </div>

      <CreateTableModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectSlug={slug}
        onSuccess={() => { loadTables(); }}
      />
    </div>
  );
}
