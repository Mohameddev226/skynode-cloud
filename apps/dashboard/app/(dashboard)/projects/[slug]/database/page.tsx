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
  ArrowUp,
  ArrowDown,
  Shield,
  Trash2,
  Pencil,
  MoreHorizontal,
  Table2,
  X,
  Check,
  Columns,
  Key,
  FileCode,
  Copy,
  AlertTriangle,
  Database,
  Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { CreateTableModal } from '@/components/database/create-table-modal';
import { InsertRowModal } from '@/components/database/insert-row-modal';

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

  /* sidebar & schemas */
  const [tables, setTables] = React.useState<TableInfo[]>([]);
  const [tablesLoading, setTablesLoading] = React.useState(true);
  const [schema, setSchema] = React.useState('public');
  const [schemaMenuOpen, setSchemaMenuOpen] = React.useState(false);
  const [tableSearch, setTableSearch] = React.useState('');
  const [activeTable, setActiveTable] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [insertOpen, setInsertOpen] = React.useState(false);

  /* grid & definition */
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

  /* sorting */
  const [sortCol, setSortCol] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc' | null>(null);

  /* row deletion */
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const [deletingRows, setDeletingRows] = React.useState(false);

  /* table drop */
  const [dropTableTarget, setDropTableTarget] = React.useState<string | null>(null);
  const [droppingTable, setDroppingTable] = React.useState(false);

  /* copied state */
  const [copiedDdl, setCopiedDdl] = React.useState(false);

  /* inline editing */
  const [editingCell, setEditingCell] = React.useState<{ rowIndex: number; colName: string } | null>(null);
  const [editValue, setEditValue] = React.useState<string>('');
  const [savingCell, setSavingCell] = React.useState(false);

  /* load table list */
  async function loadTables(targetSchema = schema) {
    setTablesLoading(true);
    const res = await api.get<TableInfo[]>(`/api/v1/projects/${slug}/database/tables`);
    if (res.success && res.data) {
      const allTables = Array.isArray(res.data) ? res.data : (res.data as any).data ?? [];
      const filtered = allTables.filter((t: TableInfo) => t.schema === targetSchema);
      setTables(filtered);

      // If active table is not in this schema, switch to the first table
      if (filtered.length > 0) {
        if (!activeTable || !filtered.some((t: TableInfo) => t.name === activeTable)) {
          setActiveTable(filtered[0].name);
          setOpenTabs([filtered[0].name]);
        }
      } else {
        setActiveTable(null);
        setOpenTabs([]);
      }
    }
    setTablesLoading(false);
  }

  React.useEffect(() => {
    loadTables(schema);
  }, [slug, schema]);

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
    if (activeTable) {
      loadTableData(activeTable, 1);
    }
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

  /* sort handler */
  function handleSort(colName: string) {
    if (sortCol === colName) {
      if (sortDir === 'asc') setSortDir('desc');
      else if (sortDir === 'desc') {
        setSortCol(null);
        setSortDir(null);
      }
    } else {
      setSortCol(colName);
      setSortDir('asc');
    }
  }

  /* filter & sort client-side records */
  const displayedRows = React.useMemo(() => {
    let result = [...rows];
    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      result = result.filter((row) =>
        Object.values(row).some((val) =>
          String(val ?? '').toLowerCase().includes(q)
        )
      );
    }
    if (sortCol && sortDir) {
      result.sort((a, b) => {
        const valA = a[sortCol];
        const valB = b[sortCol];
        if (valA === valB) return 0;
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;
        if (valA < valB) return sortDir === 'asc' ? -1 : 1;
        return sortDir === 'asc' ? 1 : -1;
      });
    }
    return result;
  }, [rows, filterText, sortCol, sortDir]);

  /* inline cell edit handlers */
  function startEditing(rowIndex: number, col: ColumnInfo, val: unknown) {
    if (col.isPrimary) return;
    setEditingCell({ rowIndex, colName: col.name });
    setEditValue(val === null || val === undefined ? '' : String(val));
  }

  async function saveCellEdit(rowIndex: number, col: ColumnInfo) {
    if (!editingCell || !activeTable) return;
    const originalRow = displayedRows[rowIndex];
    if (!originalRow) {
      setEditingCell(null);
      return;
    }
    const pkCol = columns.find((c) => c.isPrimary)?.name || 'id';
    const pkVal = (originalRow as any)[pkCol];
    if (pkVal === undefined) {
      setEditingCell(null);
      return;
    }

    const originalVal = originalRow[col.name];
    const originalStr = originalVal === null || originalVal === undefined ? '' : String(originalVal);
    if (editValue === originalStr) {
      setEditingCell(null);
      return;
    }

    let parsedValue: any = editValue;
    if (col.isNullable && editValue.trim() === '') {
      parsedValue = null;
    } else if (
      col.dataType.includes('int') ||
      col.dataType.includes('numeric') ||
      col.dataType.includes('float') ||
      col.dataType.includes('real') ||
      col.dataType.includes('double')
    ) {
      if (editValue.trim() !== '') {
        parsedValue = Number(editValue);
      }
    } else if (col.dataType.includes('bool')) {
      parsedValue = editValue.toLowerCase() === 'true' || editValue === '1';
    }

    setSavingCell(true);
    try {
      const res = await api.patch(
        `/api/v1/projects/${slug}/database/tables/${activeTable}/records/${encodeURIComponent(String(pkVal))}?pk=${pkCol}&schema=${schema}`,
        { [col.name]: parsedValue }
      );
      if (res.success) {
        loadTableData(activeTable, page);
      } else {
        alert(res.error?.message ?? 'Failed to update record');
      }
    } catch (err: any) {
      alert(err?.message ?? 'Failed to update record');
    } finally {
      setSavingCell(false);
      setEditingCell(null);
    }
  }

  /* delete selected rows */
  async function handleDeleteSelectedRows() {
    if (!activeTable || selected.size === 0) return;
    setDeletingRows(true);

    const pkCol = columns.find((c) => c.isPrimary)?.name || 'id';
    const selectedRows = Array.from(selected).map((idx) => rows[idx]).filter(Boolean);

    for (const r of selectedRows) {
      const pkVal = (r as any)[pkCol];
      if (pkVal !== undefined) {
        await api.delete(
          `/api/v1/projects/${slug}/database/tables/${activeTable}/records/${encodeURIComponent(String(pkVal))}?pk=${pkCol}&schema=${schema}`
        );
      }
    }

    setDeletingRows(false);
    setDeleteConfirmOpen(false);
    setSelected(new Set());
    loadTableData(activeTable, page);
  }

  /* drop table */
  async function handleDropTable() {
    if (!dropTableTarget) return;
    setDroppingTable(true);

    await api.delete(
      `/api/v1/projects/${slug}/database/tables/${dropTableTarget}?schema=${schema}`
    );

    setDroppingTable(false);
    const dropped = dropTableTarget;
    setDropTableTarget(null);

    // Remove from open tabs
    setOpenTabs((prev) => prev.filter((t) => t !== dropped));
    if (activeTable === dropped) {
      setActiveTable(null);
    }
    loadTables(schema);
  }

  /* copy DDL */
  function copyTableDdl() {
    if (!activeTable || columns.length === 0) return;
    const colDefs = columns.map((c) => {
      let def = `  "${c.name}" ${c.dataType}`;
      if (c.isPrimary) def += ' PRIMARY KEY';
      if (!c.isNullable && !c.isPrimary) def += ' NOT NULL';
      if (c.defaultValue) def += ` DEFAULT ${c.defaultValue}`;
      return def;
    });
    const ddl = `CREATE TABLE ${schema}.${activeTable} (\n${colDefs.join(',\n')}\n);`;
    navigator.clipboard.writeText(ddl);
    setCopiedDdl(true);
    setTimeout(() => setCopiedDdl(false), 2000);
  }

  const filteredTables = tables.filter((t) =>
    t.name.toLowerCase().includes(tableSearch.toLowerCase())
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const startRow = (page - 1) * PAGE_SIZE + 1;
  const endRow = Math.min(page * PAGE_SIZE, total);
  const activeTableSummary = tables.find((t) => t.name === activeTable);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-background">

      {/* ── Left Sidebar (Supabase Style) ──────────────────────── */}
      <aside className="w-60 shrink-0 flex flex-col border-r border-border bg-sidebar overflow-hidden select-none">
        {/* Schema selector dropdown */}
        <div className="p-2 border-b border-border/70 relative">
          <button
            onClick={() => setSchemaMenuOpen(!schemaMenuOpen)}
            className="w-full flex items-center justify-between gap-2 rounded px-2.5 py-1.5 text-xs text-foreground bg-background border border-border hover:border-emerald-500/50 transition-colors shadow-xs"
          >
            <div className="flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 text-emerald-500" />
              <span className="font-mono font-medium">schema <strong className="text-emerald-500">{schema}</strong></span>
            </div>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>

          {schemaMenuOpen && (
            <div className="absolute top-11 left-2 right-2 z-30 rounded-md border border-border bg-popover text-popover-foreground shadow-xl py-1 text-xs">
              {['public', 'auth'].map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setSchema(s);
                    setSchemaMenuOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-1.5 text-left transition-colors font-mono',
                    schema === s
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <span>{s}</span>
                  {schema === s && <Check className="h-3 w-3" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* New table button + Search */}
        <div className="p-2 space-y-1.5 border-b border-border/60">
          <Button
            size="sm"
            variant="outline"
            className="w-full h-7 text-xs justify-start gap-1.5 border-border bg-background hover:bg-muted shadow-xs"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-3.5 w-3.5 text-emerald-500" /> New table
          </Button>
          <div className="relative">
            <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
            <Input
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="Search tables..."
              className="h-7 pl-7 text-xs bg-background border-border font-mono"
            />
          </div>
        </div>

        {/* Table list */}
        <div className="flex-1 overflow-y-auto py-1">
          {tablesLoading ? (
            <div className="px-3 py-4 text-xs text-muted-foreground flex items-center gap-2">
              <RefreshCw className="h-3 w-3 animate-spin text-emerald-400" />
              <span>Loading tables...</span>
            </div>
          ) : filteredTables.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              <Table2 className="h-6 w-6 mx-auto mb-2 opacity-30" />
              <span>No tables in {schema}</span>
            </div>
          ) : (
            filteredTables.map((t) => (
              <div
                key={t.name}
                onClick={() => openTable(t.name)}
                className={cn(
                  'w-full flex items-center justify-between gap-1.5 px-3 py-1.5 text-xs text-left cursor-pointer group transition-colors',
                  activeTable === t.name
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                )}
              >
                <div className="flex items-center gap-2 truncate">
                  <Table2 className={cn('h-3.5 w-3.5 shrink-0', activeTable === t.name ? 'text-emerald-500' : 'opacity-60')} />
                  <span className="truncate font-mono">{t.name}</span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDropTableTarget(t.name);
                    }}
                    className="h-5 w-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive text-muted-foreground transition-all"
                    title={`Drop table ${t.name}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  <Globe className="h-2.5 w-2.5 shrink-0 opacity-40" />
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ── Main Area ─────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Table tabs bar (Supabase style) */}
        <div className="flex h-9 shrink-0 items-center border-b border-border bg-muted/40 px-1 gap-1 overflow-x-auto no-scrollbar">
          {openTabs.map((name) => (
            <div
              key={name}
              onClick={() => { setActiveTable(name); setActiveTab('data'); }}
              className={cn(
                'flex items-center gap-2 h-7 px-3 rounded-t text-xs cursor-pointer select-none group transition-all shrink-0 border',
                activeTable === name
                  ? 'bg-background text-foreground border-border border-b-transparent font-medium shadow-xs'
                  : 'bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/60'
              )}
            >
              <Table2 className="h-3 w-3 text-emerald-500" />
              <span className="font-mono">{name}</span>
              <button
                onClick={(e) => closeTab(name, e)}
                className="h-3.5 w-3.5 rounded-sm flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-muted"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}

          <button
            onClick={() => setCreateOpen(true)}
            className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted ml-1 shrink-0"
            title="Create new table"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {activeTable ? (
          <>
            {/* ── Supabase Toolbar ──────────────────────────────── */}
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-background px-3 gap-2">
              {/* Left: filter + sort + rls badge */}
              <div className="flex items-center gap-1.5 flex-1 max-w-2xl">
                {/* Search / Filter input */}
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    placeholder={`Filter by ${columns[0]?.name ?? 'id'}, ${columns[1]?.name ?? 'name'}…`}
                    className="h-7 pl-8 pr-2 w-full text-xs bg-background border-border font-mono"
                  />
                  {filterText && (
                    <button
                      onClick={() => setFilterText('')}
                      className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>

                <div className="h-4 w-px bg-border mx-1" />

                {/* Sort indicator button */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (columns.length > 0 && columns[0]) handleSort(columns[0].name);
                  }}
                  className={cn(
                    'h-7 gap-1.5 text-xs px-2',
                    sortCol ? 'text-emerald-500 bg-emerald-500/10' : 'text-muted-foreground hover:text-foreground'
                  )}
                  title={sortCol ? `Sorted by ${sortCol} (${sortDir})` : 'Sort records'}
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  <span>{sortCol ? `${sortCol} ${sortDir}` : 'Sort'}</span>
                </Button>

                {/* RLS policies badge */}
                <div className="flex items-center gap-1.5 h-7 px-2 rounded text-xs font-medium border border-dashed border-border bg-muted/30 text-muted-foreground">
                  <Shield className="h-3 w-3 text-emerald-500" />
                  <span>RLS policies</span>
                </div>
              </div>

              {/* Right: Actions */}
              <div className="flex items-center gap-2">
                {/* Delete selected rows button */}
                {selected.size > 0 && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setDeleteConfirmOpen(true)}
                    className="h-7 gap-1.5 px-2.5 text-xs font-semibold bg-red-600 hover:bg-red-500 text-white"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Delete {selected.size} row{selected.size > 1 ? 's' : ''}</span>
                  </Button>
                )}

                {/* Role indicator */}
                <div className="hidden sm:flex items-center gap-1 h-7 px-2.5 rounded text-xs border border-border bg-muted/40 text-muted-foreground">
                  Role <span className="font-semibold text-foreground font-mono">postgres</span>
                </div>

                {/* Refresh */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                  title="Refresh records"
                  onClick={() => loadTableData(activeTable, page)}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', gridLoading && 'animate-spin text-emerald-400')} />
                </Button>

                {/* Insert Row Button */}
                <Button
                  size="sm"
                  onClick={() => setInsertOpen(true)}
                  className="h-7 gap-1.5 px-3 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-sm"
                >
                  <Plus className="h-3.5 w-3.5" /> Insert
                </Button>
              </div>
            </div>

            {/* ── Main View: Data Grid OR Definition Schema ──────── */}
            {activeTab === 'definition' ? (
              /* ── Definition Tab (Schema View) ──────────────────── */
              <div className="flex-1 overflow-auto p-4 space-y-4 bg-background">
                {/* Table Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg border border-border bg-card">
                    <div className="text-[11px] text-muted-foreground">Table Name</div>
                    <div className="text-sm font-semibold font-mono text-emerald-500 mt-0.5">{schema}.{activeTable}</div>
                  </div>
                  <div className="p-3 rounded-lg border border-border bg-card">
                    <div className="text-[11px] text-muted-foreground">Columns</div>
                    <div className="text-sm font-semibold font-mono text-foreground mt-0.5">{columns.length} columns</div>
                  </div>
                  <div className="p-3 rounded-lg border border-border bg-card">
                    <div className="text-[11px] text-muted-foreground">Live Rows</div>
                    <div className="text-sm font-semibold font-mono text-foreground mt-0.5">{total} records</div>
                  </div>
                  <div className="p-3 rounded-lg border border-border bg-card">
                    <div className="text-[11px] text-muted-foreground">Disk Size</div>
                    <div className="text-sm font-semibold font-mono text-foreground mt-0.5">
                      {activeTableSummary?.sizeBytes ? `${(activeTableSummary.sizeBytes / 1024).toFixed(1)} KB` : '8.0 KB'}
                    </div>
                  </div>
                </div>

                {/* Definition Header */}
                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-2">
                    <Columns className="h-4 w-4 text-emerald-500" />
                    <h3 className="text-sm font-semibold text-foreground">Column Definitions</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyTableDdl}
                      className="h-7 gap-1.5 text-xs border-border bg-background hover:bg-muted"
                    >
                      {copiedDdl ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                      <span>{copiedDdl ? 'Copied DDL' : 'Copy DDL'}</span>
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setDropTableTarget(activeTable)}
                      className="h-7 gap-1.5 text-xs bg-red-600 hover:bg-red-500 text-white"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>Drop Table</span>
                    </Button>
                  </div>
                </div>

                {/* Columns Table */}
                <div className="rounded-md border border-border overflow-hidden bg-card">
                  <table className="w-full text-xs border-collapse">
                    <thead className="bg-muted/50 border-b border-border text-muted-foreground font-medium">
                      <tr>
                        <th className="px-3 py-2 text-left">Column</th>
                        <th className="px-3 py-2 text-left">Type</th>
                        <th className="px-3 py-2 text-left">Default</th>
                        <th className="px-3 py-2 text-left">Nullable</th>
                        <th className="px-3 py-2 text-left">Key</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {columns.map((col) => (
                        <tr key={col.name} className="hover:bg-muted/30 transition-colors">
                          <td className="px-3 py-2 font-mono font-medium text-foreground flex items-center gap-2">
                            {col.isPrimary && <Key className="h-3 w-3 text-amber-500" />}
                            <span>{col.name}</span>
                          </td>
                          <td className="px-3 py-2">
                            <span className="font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded text-[11px]">
                              {col.dataType}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-muted-foreground">
                            {col.defaultValue ? col.defaultValue : <span className="opacity-40 italic">None</span>}
                          </td>
                          <td className="px-3 py-2">
                            {col.isNullable ? (
                              <span className="text-muted-foreground">Nullable</span>
                            ) : (
                              <span className="text-amber-500 font-semibold">NOT NULL</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {col.isPrimary ? (
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500 font-bold text-[10px]">
                                PRIMARY KEY
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              /* ── Data Grid Tab (Supabase Spreadsheet) ───────────── */
              <div className="flex-1 overflow-auto">
                {gridError ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center text-sm text-muted-foreground">
                      <p className="text-red-500 font-medium">Error loading data</p>
                      <p className="mt-1">{gridError}</p>
                      <Button size="sm" className="mt-3" onClick={() => loadTableData(activeTable, page)}>Retry</Button>
                    </div>
                  </div>
                ) : (
                  <table className="w-full text-xs border-collapse min-w-max">
                    <thead className="sticky top-0 z-10 bg-muted/50">
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
                            onClick={() => handleSort(col.name)}
                            className="px-3 py-2 text-left font-medium text-muted-foreground border-r border-border whitespace-nowrap min-w-[140px] group hover:bg-muted/80 cursor-pointer select-none"
                          >
                            <div className="flex items-center gap-2">
                              {col.isPrimary && (
                                <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold flex items-center gap-0.5">
                                  <Key className="h-2 w-2" /> PK
                                </span>
                              )}
                              <span className={cn('font-mono', sortCol === col.name ? 'text-emerald-400 font-bold' : 'text-foreground')}>
                                {col.name}
                              </span>
                              <span className="text-[10px] text-muted-foreground/60 font-normal">{shortType(col.dataType)}</span>
                              {sortCol === col.name ? (
                                sortDir === 'asc' ? (
                                  <ArrowUp className="h-3 w-3 text-emerald-400 ml-auto" />
                                ) : (
                                  <ArrowDown className="h-3 w-3 text-emerald-400 ml-auto" />
                                )
                              ) : (
                                <ChevronDown className="h-3 w-3 ml-auto opacity-0 group-hover:opacity-60" />
                              )}
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
                      ) : displayedRows.length === 0 ? (
                        <tr>
                          <td colSpan={columns.length + 1} className="py-16 text-center text-muted-foreground">
                            {filterText ? (
                              <span>No rows match the filter &ldquo;{filterText}&rdquo;.</span>
                            ) : (
                              <span>No rows in this table yet. Click <strong className="text-foreground">Insert</strong> to add one.</span>
                            )}
                          </td>
                        </tr>
                      ) : (
                        displayedRows.map((row, i) => (
                          <tr
                            key={i}
                            className={cn(
                              'border-b border-border/40 hover:bg-white/[0.03] transition-colors group',
                              selected.has(i) && 'bg-emerald-500/5'
                            )}
                          >
                            <td className="w-10 px-3 py-1.5 border-r border-border/50">
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="checkbox"
                                  checked={selected.has(i)}
                                  onChange={() => toggleRow(i)}
                                  className="h-3.5 w-3.5 rounded accent-emerald-500"
                                />
                                {columns.some((c) => !c.isPrimary) && (
                                  <button
                                    onClick={() => {
                                      const editableCol = columns.find((c) => !c.isPrimary);
                                      if (editableCol) startEditing(i, editableCol, row[editableCol.name]);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-emerald-500 transition-opacity"
                                    title="Edit row"
                                  >
                                    <Pencil className="h-2.5 w-2.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                            {columns.map((col) => {
                              const val = row[col.name];
                              const str = cellStr(val);
                              const isNull = val === null || val === undefined;
                              const isEditing = editingCell?.rowIndex === i && editingCell?.colName === col.name;

                              return (
                                <td
                                  key={col.name}
                                  onDoubleClick={() => startEditing(i, col, val)}
                                  className={cn(
                                    'px-3 py-1.5 border-r border-border/50 whitespace-nowrap max-w-[280px] overflow-hidden text-ellipsis transition-colors',
                                    !col.isPrimary && 'cursor-cell hover:bg-emerald-500/5',
                                    isEditing && 'p-0 bg-emerald-500/10'
                                  )}
                                  title={!col.isPrimary ? 'Double-click to edit' : undefined}
                                >
                                  {isEditing ? (
                                    <input
                                      autoFocus
                                      disabled={savingCell}
                                      value={editValue}
                                      onChange={(e) => setEditValue(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          saveCellEdit(i, col);
                                        } else if (e.key === 'Escape') {
                                          setEditingCell(null);
                                        }
                                      }}
                                      onBlur={() => saveCellEdit(i, col)}
                                      className="w-full h-full px-3 py-1 font-mono text-xs bg-background border-2 border-emerald-500 rounded-none outline-none text-foreground shadow-inner"
                                    />
                                  ) : isNull ? (
                                    <span className="text-muted-foreground/40 italic text-[11px]">NULL</span>
                                  ) : (
                                    <span
                                      className={cn(
                                        'font-mono',
                                        col.isPrimary ? 'text-amber-400/90' : 'text-foreground',
                                        typeof val === 'boolean' ? 'text-purple-400 font-semibold' : '',
                                        typeof val === 'number' ? 'text-blue-400' : ''
                                      )}
                                    >
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
            )}

            {/* ── Bottom Bar (Data / Definition + Pagination) ─── */}
            <div className="flex h-9 shrink-0 items-center justify-between border-t border-border bg-muted/40 px-3">
              {/* Tabs: Data / Definition */}
              <div className="flex items-center gap-1">
                {(['data', 'definition'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      'h-6 px-3 text-xs rounded capitalize transition-colors font-medium',
                      activeTab === tab
                        ? 'bg-background text-emerald-400 border border-border/60 shadow-sm'
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
                  <span className="text-emerald-400 font-semibold mr-2">{selected.size} selected</span>
                )}
                <span>
                  {total === 0 ? '0 records' : `${startRow}–${endRow} of ${total} records`}
                </span>
                <span className="text-muted-foreground/40">|</span>
                <span>{PAGE_SIZE} rows</span>
                <div className="flex items-center gap-1 ml-1">
                  <button
                    onClick={() => loadTableData(activeTable, page - 1)}
                    disabled={page <= 1 || gridLoading}
                    className="h-5 w-5 flex items-center justify-center rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="font-mono">Page {page} of {totalPages}</span>
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
          /* Empty State — No Table Selected */
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground p-6">
            <Table2 className="h-12 w-12 opacity-20 text-emerald-400" />
            <h4 className="text-sm font-semibold text-foreground">No table selected</h4>
            <p className="text-xs max-w-sm">Select a table from the sidebar to inspect its records and definition, or create a new table.</p>
            <Button size="sm" onClick={() => setCreateOpen(true)} className="mt-2 bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" /> New table
            </Button>
          </div>
        )}
      </div>

      {/* ── Create Table Modal ─────────────────────────────────── */}
      <CreateTableModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectSlug={slug}
        onSuccess={() => { loadTables(schema); }}
      />

      {/* ── Insert Row Modal ───────────────────────────────────── */}
      {activeTable && (
        <InsertRowModal
          open={insertOpen}
          onOpenChange={setInsertOpen}
          projectSlug={slug}
          tableName={activeTable}
          schema={schema}
          columns={columns}
          onSuccess={() => { loadTableData(activeTable, page); }}
        />
      )}

      {/* ── Delete Rows Confirmation Dialog ───────────────────── */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="max-w-md bg-card text-foreground border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Delete {selected.size} record{selected.size > 1 ? 's' : ''}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Are you sure you want to permanently delete the {selected.size} selected row{selected.size > 1 ? 's' : ''} from <strong className="text-foreground font-mono">{schema}.{activeTable}</strong>? This action cannot be reversed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-3 border-t border-border flex items-center justify-between sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDeleteConfirmOpen(false)}
              className="text-xs text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingRows}
              size="sm"
              onClick={handleDeleteSelectedRows}
              className="text-xs bg-red-600 hover:bg-red-500 text-white font-semibold"
            >
              {deletingRows ? 'Deleting...' : 'Delete permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Drop Table Confirmation Dialog ─────────────────────── */}
      <Dialog open={!!dropTableTarget} onOpenChange={(open) => !open && setDropTableTarget(null)}>
        <DialogContent className="max-w-md bg-card text-foreground border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Drop Table &ldquo;{dropTableTarget}&rdquo;
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Are you sure you want to drop table <strong className="text-foreground font-mono">{schema}.{dropTableTarget}</strong>? This will permanently delete the table and all its data and dependent objects (CASCADE).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-3 border-t border-border flex items-center justify-between sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDropTableTarget(null)}
              className="text-xs text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={droppingTable}
              size="sm"
              onClick={handleDropTable}
              className="text-xs bg-red-600 hover:bg-red-500 text-white font-semibold"
            >
              {droppingTable ? 'Dropping...' : 'Drop table'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
