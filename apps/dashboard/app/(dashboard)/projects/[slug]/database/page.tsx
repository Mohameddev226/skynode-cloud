'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Plus, Table2, Code2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSkeleton } from '@/components/shared/loading-skeleton';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import api from '@/lib/api';

interface TableInfo {
  name: string;
  schema: string;
  rowCount: number;
  sizeBytes: number;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DatabasePage() {
  const params = useParams();
  const slug = params.slug as string;

  const [tables, setTables] = React.useState<TableInfo[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  async function fetchTables() {
    setLoading(true);
    setError(null);
    const res = await api.get<TableInfo[]>(`/api/v1/projects/${slug}/database/tables`);
    if (!res.success) setError(res.error?.message ?? 'Failed to load tables');
    else setTables(res.data ?? []);
    setLoading(false);
  }

  React.useEffect(() => { fetchTables(); }, [slug]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <LoadingSkeleton className="h-8 w-32" />
          <LoadingSkeleton className="h-9 w-28" />
        </div>
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <LoadingSkeleton key={i} className="h-14 rounded-md" />)}
        </div>
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={fetchTables} />;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Database</h1>
          <p className="text-sm text-muted-foreground">Manage tables and run queries</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href={`/projects/${slug}/database/sql`}>
              <Code2 className="mr-2 h-4 w-4" />
              SQL Editor
            </Link>
          </Button>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New table
          </Button>
        </div>
      </div>

      {/* Tables list */}
      {tables.length === 0 ? (
        <EmptyState
          icon={Table2}
          title="No tables yet"
          description="Create your first table to start storing data in this project's database."
          actionLabel="Create table"
          onAction={() => {}}
        />
      ) : (
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Tables ({tables.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <div className="divide-y divide-border">
              {tables.map((table) => (
                <Link
                  key={table.name}
                  href={`/projects/${slug}/database/tables/${table.name}`}
                  className="flex items-center justify-between py-3 hover:bg-muted/40 -mx-4 px-4 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <Table2 className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <span className="text-sm font-medium font-mono">{table.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{table.schema}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <Badge variant="secondary" className="font-mono text-xs">
                      {table.rowCount.toLocaleString()} rows
                    </Badge>
                    <span className="text-xs text-muted-foreground">{formatBytes(table.sizeBytes)}</span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
