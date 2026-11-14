'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  RefreshCw,
  Trash2,
  Table2,
  ChevronLeft,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingSkeleton } from '@/components/shared/loading-skeleton';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import api from '@/lib/api';

interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimary: boolean;
}

interface TableSchemaResponse {
  table: string;
  schema: string;
  columns: ColumnInfo[];
}

interface RecordsResponse {
  rows: Record<string, any>[];
  total: number;
  page: number;
  limit: number;
}

export default function TableDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const tableName = params.tableName as string;

  const [schemaInfo, setSchemaInfo] = React.useState<TableSchemaResponse | null>(null);
  const [recordsData, setRecordsData] = React.useState<RecordsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Pagination & Sort
  const [page, setPage] = React.useState(1);
  const [limit] = React.useState(25);
  const [sortBy, setSortBy] = React.useState<string | undefined>();
  const [sortOrder, setSortOrder] = React.useState<'asc' | 'desc'>('asc');

  // Insert Row Modal
  const [insertOpen, setInsertOpen] = React.useState(false);
  const [insertData, setInsertData] = React.useState<Record<string, string>>({});
  const [inserting, setInserting] = React.useState(false);

  // Drop Table Modal
  const [dropOpen, setDropOpen] = React.useState(false);
  const [dropping, setDropping] = React.useState(false);

  async function fetchData() {
    setLoading(true);
    setError(null);

    const [schemaRes, recordsRes] = await Promise.all([
      api.get<TableSchemaResponse>(`/api/v1/projects/${slug}/database/tables/${tableName}`),
      api.get<RecordsResponse>(
        `/api/v1/projects/${slug}/database/tables/${tableName}/records?page=${page}&limit=${limit}${
          sortBy ? `&sortBy=${sortBy}&sortOrder=${sortOrder}` : ''
        }`,
      ),
    ]);

    if (!schemaRes.success) {
      setError(schemaRes.error?.message ?? 'Failed to load table schema');
    } else {
      setSchemaInfo(schemaRes.data ?? null);
      if (recordsRes.success) {
        setRecordsData(recordsRes.data ?? null);
      }
    }

    setLoading(false);
  }

  React.useEffect(() => {
    fetchData();
  }, [slug, tableName, page, sortBy, sortOrder]);

  async function handleInsertRecord(e: React.FormEvent) {
    e.preventDefault();
    setInserting(true);

    const cleanData: Record<string, any> = {};
    for (const [key, val] of Object.entries(insertData)) {
      if (val.trim() !== '') {
        cleanData[key] = val;
      }
    }

    const res = await api.post(`/api/v1/projects/${slug}/database/tables/${tableName}/records`, cleanData);
    setInserting(false);

    if (res.success) {
      setInsertOpen(false);
      setInsertData({});
      fetchData();
    }
  }

  async function handleDeleteRecord(pkCol: string, idVal: any) {
    if (!confirm('Are you sure you want to delete this row?')) return;
    const res = await api.delete(
      `/api/v1/projects/${slug}/database/tables/${tableName}/records/${idVal}?pk=${pkCol}`,
    );
    if (res.success) {
      fetchData();
    }
  }

  async function handleDropTable() {
    setDropping(true);
    const res = await api.delete(`/api/v1/projects/${slug}/database/tables/${tableName}`);
    setDropping(false);
    if (res.success) {
      router.push(`/projects/${slug}/database`);
    }
  }

  if (loading && !schemaInfo) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton className="h-8 w-48" />
        <LoadingSkeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  if (error || !schemaInfo) {
    return <ErrorState message={error ?? 'Table not found'} onRetry={fetchData} />;
  }

  const primaryKeyCol = schemaInfo.columns.find((c) => c.isPrimary)?.name || 'id';
  const totalPages = recordsData ? Math.ceil(recordsData.total / limit) : 1;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/projects/${slug}/database`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight font-mono">{schemaInfo.table}</h1>
              <Badge variant="secondary" className="text-xs">
                {schemaInfo.schema}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {schemaInfo.columns.length} columns · {recordsData?.total ?? 0} rows
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={fetchData} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={() => setInsertOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Insert row
          </Button>
          <Button variant="destructive" size="icon" onClick={() => setDropOpen(true)} title="Drop table">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Tabs defaultValue="data">
        <TabsList>
          <TabsTrigger value="data">Records</TabsTrigger>
          <TabsTrigger value="schema">Columns & Schema</TabsTrigger>
        </TabsList>

        {/* Records View */}
        <TabsContent value="data" className="space-y-4">
          {!recordsData || recordsData.rows.length === 0 ? (
            <EmptyState
              icon={Table2}
              title="No records found"
              description="This table is currently empty."
              actionLabel="Insert row"
              onAction={() => setInsertOpen(true)}
            />
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {schemaInfo.columns.map((col) => (
                        <th
                          key={col.name}
                          onClick={() => {
                            if (sortBy === col.name) {
                              setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                            } else {
                              setSortBy(col.name);
                              setSortOrder('asc');
                            }
                          }}
                          className="px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground transition-colors"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>{col.name}</span>
                            <span className="text-[10px] text-muted-foreground/60 font-mono">
                              {col.dataType}
                            </span>
                            {col.isPrimary && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                                PK
                              </Badge>
                            )}
                          </div>
                        </th>
                      ))}
                      <th className="px-4 py-2.5 text-right font-medium text-muted-foreground w-12">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recordsData.rows.map((row, idx) => (
                      <tr key={idx} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        {schemaInfo.columns.map((col) => (
                          <td key={col.name} className="px-4 py-2 font-mono whitespace-nowrap max-w-xs truncate">
                            {row[col.name] === null ? (
                              <span className="text-muted-foreground italic text-[11px]">NULL</span>
                            ) : typeof row[col.name] === 'object' ? (
                              JSON.stringify(row[col.name])
                            ) : (
                              String(row[col.name])
                            )}
                          </td>
                        ))}
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDeleteRecord(primaryKeyCol, row[primaryKeyCol])}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>

              {/* Pagination footer */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-muted-foreground">
                <span>
                  Showing {recordsData.rows.length} of {recordsData.total} rows
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                    Previous
                  </Button>
                  <span>
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={page >= totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                    <ChevronRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </TabsContent>

        {/* Schema / Columns View */}
        <TabsContent value="schema">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Column Specifications
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {schemaInfo.columns.map((col) => (
                  <div key={col.name} className="flex items-center justify-between px-6 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{col.name}</span>
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {col.dataType}
                      </Badge>
                      {col.isPrimary && (
                        <Badge variant="default" className="text-[10px]">
                          Primary Key
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{col.isNullable ? 'Nullable' : 'Not null'}</span>
                      {col.defaultValue && (
                        <span className="font-mono text-[11px] bg-muted px-2 py-0.5 rounded">
                          default: {col.defaultValue}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Insert Record Modal */}
      <Dialog open={insertOpen} onOpenChange={setInsertOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Insert row into {schemaInfo.table}</DialogTitle>
            <DialogDescription>Enter column values. Omit values to use defaults or NULL.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInsertRecord} className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {schemaInfo.columns.map((col) => (
              <div key={col.name} className="space-y-1">
                <label className="text-xs font-mono font-medium flex items-center justify-between">
                  <span>{col.name}</span>
                  <span className="text-[10px] text-muted-foreground">{col.dataType}</span>
                </label>
                <Input
                  placeholder={col.defaultValue ? `Default: ${col.defaultValue}` : col.isNullable ? 'NULL' : 'Required'}
                  value={insertData[col.name] ?? ''}
                  onChange={(e) => setInsertData({ ...insertData, [col.name]: e.target.value })}
                  className="font-mono text-xs"
                />
              </div>
            ))}
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setInsertOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={inserting} loading={inserting}>
                Insert
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Drop Table Confirmation */}
      <Dialog open={dropOpen} onOpenChange={setDropOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Drop table {schemaInfo.table}?</DialogTitle>
            <DialogDescription>
              This will permanently delete table <strong>{schemaInfo.table}</strong> and all its records. This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDropOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDropTable} disabled={dropping} loading={dropping}>
              Drop table
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
