'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import {
  HardDrive,
  Plus,
  Folder,
  Upload,
  Search,
  MoreHorizontal,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSkeleton } from '@/components/shared/loading-skeleton';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import api from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';

interface Bucket {
  id: string;
  name: string;
  public: boolean;
  fileCount: number;
  sizeBytes: number;
  createdAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function StoragePage() {
  const params = useParams();
  const slug = params.slug as string;

  const [buckets, setBuckets] = React.useState<Bucket[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');

  async function fetchBuckets() {
    setLoading(true);
    setError(null);
    const res = await api.get<Bucket[]>(`/api/v1/projects/${slug}/storage/buckets`);
    if (!res.success) setError(res.error?.message ?? 'Failed to load buckets');
    else setBuckets(res.data ?? []);
    setLoading(false);
  }

  React.useEffect(() => { fetchBuckets(); }, [slug]);

  const filtered = buckets.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <LoadingSkeleton className="h-8 w-32" />
        <LoadingSkeleton className="h-9 w-28" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(3)].map((_, i) => <LoadingSkeleton key={i} className="h-36 rounded-lg" />)}
      </div>
    </div>
  );

  if (error) return <ErrorState message={error} onRetry={fetchBuckets} />;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Storage</h1>
          <p className="text-sm text-muted-foreground">Manage file buckets and objects</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={fetchBuckets} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New bucket
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search buckets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={HardDrive}
          title="No buckets yet"
          description="Create a storage bucket to start uploading files and assets for this project."
          actionLabel="Create bucket"
          onAction={() => {}}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((bucket) => (
            <Card key={bucket.id} className="group hover:shadow-card-hover hover:border-primary/30 transition-all">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-orange-500/10">
                      <Folder className="h-4 w-4 text-orange-500" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-sm font-medium font-mono truncate">{bucket.name}</CardTitle>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>Browse files</DropdownMenuItem>
                      <DropdownMenuItem>Bucket settings</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive focus:text-destructive">
                        Delete bucket
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{bucket.fileCount.toLocaleString()} files</span>
                  <span>{formatBytes(bucket.sizeBytes)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <Badge variant={bucket.public ? 'default' : 'secondary'} className="text-xs">
                    {bucket.public ? 'Public' : 'Private'}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(bucket.createdAt)}
                  </span>
                </div>
                <Button variant="outline" size="sm" className="w-full gap-1.5 h-7 text-xs">
                  <Upload className="h-3.5 w-3.5" />
                  Upload files
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
