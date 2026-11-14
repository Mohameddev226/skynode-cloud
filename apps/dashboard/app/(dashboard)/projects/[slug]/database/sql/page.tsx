'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  Play,
  Clock,
  Copy,
  Trash2,
  ChevronDown,
  History,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import api from '@/lib/api';

// Monaco editor — load client-side only
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

type QueryStatus = 'idle' | 'running' | 'success' | 'error';

const DEFAULT_QUERY = '-- Write your SQL query here\nSELECT 1;\n';

export default function SqlEditorPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [query, setQuery] = React.useState(DEFAULT_QUERY);
  const [result, setResult] = React.useState<QueryResult | null>(null);
  const [queryError, setQueryError] = React.useState<QueryError | null>(null);
  const [status, setStatus] = React.useState<QueryStatus>('idle');
  const [history, setHistory] = React.useState<string[]>([]);
  const [showHistory, setShowHistory] = React.useState(false);

  async function runQuery() {
    if (!query.trim()) return;
    setStatus('running');
    setResult(null);
    setQueryError(null);

    const startTime = Date.now();
    const res = await api.post<QueryResult>(`/api/v1/projects/${slug}/database/query`, {
      sql: query,
    });

    if (!res.success) {
      setQueryError({ message: res.error?.message ?? 'Query failed' });
      setStatus('error');
    } else {
      setResult(res.data ?? null);
      setStatus('success');
      setHistory((prev) => [query, ...prev.slice(0, 19)]);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      runQuery();
    }
  }

  async function copyResults() {
    if (!result) return;
    const csv = [
      result.columns.join(','),
      ...result.rows.map((r) => result.columns.map((c) => JSON.stringify(r[c] ?? '')).join(',')),
    ].join('\n');
    await navigator.clipboard.writeText(csv);
  }

  return (
    <div className="flex flex-col h-full space-y-0 -mt-6 -mx-6" onKeyDown={handleKeyDown}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border px-6 py-2 bg-background sticky top-0 z-10">
        <h1 className="text-sm font-semibold mr-2">SQL Editor</h1>
        <Separator orientation="vertical" className="h-4" />
        <Button
          size="sm"
          onClick={runQuery}
          disabled={status === 'running'}
          loading={status === 'running'}
          className="gap-1.5 h-7 text-xs"
        >
          <Play className="h-3.5 w-3.5" />
          Run
          <span className="text-primary-foreground/60 text-[10px] font-normal">⌘↵</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setQuery(DEFAULT_QUERY)}
          className="h-7 text-xs gap-1.5"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </Button>
        <div className="flex-1" />
        {/* Status badge */}
        {status === 'success' && result && (
          <Badge variant="default" className="gap-1 h-6 text-xs">
            <CheckCircle2 className="h-3 w-3" />
            {result.rowCount} rows · {result.executionTimeMs}ms
          </Badge>
        )}
        {status === 'error' && (
          <Badge variant="destructive" className="gap-1 h-6 text-xs">
            <AlertCircle className="h-3 w-3" />
            Error
          </Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => setShowHistory(!showHistory)}
        >
          <History className="h-3.5 w-3.5" />
          History
          <ChevronDown className={cn('h-3 w-3 transition-transform', showHistory && 'rotate-180')} />
        </Button>
      </div>

      {/* Editor */}
      <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 14rem)' }}>
        {/* Monaco */}
        <div className="flex-1 overflow-hidden">
          <MonacoEditor
            height="100%"
            language="sql"
            value={query}
            onChange={(v) => setQuery(v ?? '')}
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
              padding: { top: 12, bottom: 12 },
            }}
          />
        </div>

        {/* History panel */}
        {showHistory && (
          <div className="w-72 border-l border-border overflow-y-auto bg-background">
            <div className="px-4 py-2 border-b border-border">
              <p className="text-xs font-medium text-muted-foreground">Query history</p>
            </div>
            {history.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">No queries run yet.</p>
            ) : (
              history.map((h, i) => (
                <button
                  key={i}
                  onClick={() => setQuery(h)}
                  className="w-full text-left px-4 py-2.5 hover:bg-muted/50 border-b border-border/50 transition-colors"
                >
                  <p className="text-xs font-mono text-foreground truncate">{h.trim().split('\n')[0]}</p>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Results pane */}
      <div className="border-t border-border bg-background" style={{ maxHeight: '40vh', overflow: 'auto' }}>
        {status === 'idle' && (
          <div className="flex items-center gap-2 px-6 py-3 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Run a query to see results
          </div>
        )}

        {status === 'running' && (
          <div className="flex items-center gap-2 px-6 py-3 text-xs text-muted-foreground">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Executing query...
          </div>
        )}

        {status === 'error' && queryError && (
          <div className="px-6 py-4 space-y-1">
            <div className="flex items-center gap-2 text-destructive text-xs font-medium">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {queryError.message}
            </div>
            {queryError.hint && (
              <p className="text-xs text-muted-foreground pl-6">Hint: {queryError.hint}</p>
            )}
          </div>
        )}

        {status === 'success' && result && (
          <div>
            {/* Results toolbar */}
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-muted/40 sticky top-0">
              <span className="text-xs text-muted-foreground">
                {result.rowCount} row{result.rowCount !== 1 ? 's' : ''} in {result.executionTimeMs}ms
              </span>
              <div className="flex-1" />
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={copyResults}>
                <Copy className="h-3 w-3" />
                Copy CSV
              </Button>
            </div>

            {/* Table */}
            {result.rows.length === 0 ? (
              <p className="px-6 py-3 text-xs text-muted-foreground">Query returned 0 rows.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {result.columns.map((col) => (
                        <th key={col} className="px-4 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        {result.columns.map((col) => (
                          <td key={col} className="px-4 py-1.5 font-mono whitespace-nowrap text-foreground/80">
                            {row[col] === null ? (
                              <span className="text-muted-foreground italic">NULL</span>
                            ) : (
                              String(row[col])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
