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
  Trash2,
  FileText,
  Download,
  X,
  Database,
  Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSkeleton } from '@/components/shared/loading-skeleton';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import api from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';

interface StorageBucket {
  name: string;
  originalName: string;
  createdAt: string;
  isPublic: boolean;
}

interface StorageFile {
  key: string;
  name: string;
  size: number;
  lastModified: string;
}

interface StorageStats {
  totalBuckets: number;
  totalFiles: number;
  totalSizeBytes: number;
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

  const [buckets, setBuckets] = React.useState<StorageBucket[]>([]);
  const [stats, setStats] = React.useState<StorageStats | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');

  // Create bucket modal
  const [createOpen, setCreateOpen] = React.useState(false);
  const [bucketName, setBucketName] = React.useState('');
  const [isPublic, setIsPublic] = React.useState(false);
  const [createLoading, setCreateLoading] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  // File browser drawer / modal
  const [selectedBucket, setSelectedBucket] = React.useState<string | null>(null);
  const [files, setFiles] = React.useState<StorageFile[]>([]);
  const [filesLoading, setFilesLoading] = React.useState(false);
  const [uploadLoading, setUploadLoading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  async function fetchData() {
    setLoading(true);
    setError(null);
    const [bucketsRes, statsRes] = await Promise.all([
      api.get<StorageBucket[]>(`/api/v1/projects/${slug}/storage/buckets`),
      api.get<StorageStats>(`/api/v1/projects/${slug}/storage/stats`),
    ]);

    if (!bucketsRes.success) {
      setError(bucketsRes.error?.message ?? 'Failed to load storage buckets');
    } else {
      setBuckets(bucketsRes.data ?? []);
      setStats(statsRes.data ?? null);
    }
    setLoading(false);
  }

  React.useEffect(() => {
    fetchData();
  }, [slug]);

  async function handleCreateBucket(e: React.FormEvent) {
    e.preventDefault();
    if (!bucketName) return;

    setCreateLoading(true);
    setCreateError(null);

    const res = await api.post(`/api/v1/projects/${slug}/storage/buckets`, {
      name: bucketName,
      isPublic,
    });

    if (res.success) {
      setCreateOpen(false);
      setBucketName('');
      setIsPublic(false);
      await fetchData();
    } else {
      setCreateError(res.error?.message ?? 'Failed to create bucket');
    }
    setCreateLoading(false);
  }

  async function handleDeleteBucket(name: string) {
    if (!confirm(`Are you sure you want to delete bucket "${name}"? It must be empty.`)) return;

    const res = await api.delete(`/api/v1/projects/${slug}/storage/buckets/${name}`);
    if (res.success) {
      if (selectedBucket === name) setSelectedBucket(null);
      await fetchData();
    } else {
      alert(res.error?.message ?? 'Failed to delete bucket');
    }
  }

  async function openFileBrowser(bucketOriginalName: string) {
    setSelectedBucket(bucketOriginalName);
    setFilesLoading(true);
    const res = await api.get<StorageFile[]>(
      `/api/v1/projects/${slug}/storage/buckets/${bucketOriginalName}/files`
    );
    if (res.success) {
      setFiles(res.data ?? []);
    }
    setFilesLoading(false);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedBucket) return;

    setUploadLoading(true);
    try {
      // 1. Get presigned upload URL
      const urlRes = await api.post<{ uploadUrl: string; key: string }>(
        `/api/v1/projects/${slug}/storage/buckets/${selectedBucket}/upload-url`,
        {
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
        }
      );

      if (!urlRes.success || !urlRes.data?.uploadUrl) {
        throw new Error(urlRes.error?.message ?? 'Failed to get upload URL');
      }

      // 2. Upload file directly to S3 / MinIO via presigned URL
      const uploadResp = await fetch(urlRes.data.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
      });

      if (!uploadResp.ok) {
        throw new Error('S3 upload request failed');
      }

      // 3. Refresh file list
      await openFileBrowser(selectedBucket);
    } catch (err: any) {
      alert(err.message ?? 'File upload failed');
    } finally {
      setUploadLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDownloadFile(key: string) {
    if (!selectedBucket) return;
    const res = await api.get<{ downloadUrl: string }>(
      `/api/v1/projects/${slug}/storage/buckets/${selectedBucket}/download-url?key=${encodeURIComponent(key)}`
    );
    if (res.success && res.data?.downloadUrl) {
      window.open(res.data.downloadUrl, '_blank');
    } else {
      alert('Failed to get download URL');
    }
  }

  async function handleDeleteFile(key: string) {
    if (!selectedBucket || !confirm(`Delete file "${key}"?`)) return;
    const res = await api.delete(
      `/api/v1/projects/${slug}/storage/buckets/${selectedBucket}/files?key=${encodeURIComponent(key)}`
    );
    if (res.success) {
      setFiles((prev) => prev.filter((f) => f.key !== key));
    } else {
      alert(res.error?.message ?? 'Failed to delete file');
    }
  }

  const filtered = buckets.filter((b) =>
    b.originalName.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton className="h-8 w-32" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <LoadingSkeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <LoadingSkeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={fetchData} />;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Storage</h1>
          <p className="text-sm text-muted-foreground">Manage multi-tenant object buckets and files</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={fetchData} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New bucket
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-1">
              <CardDescription className="flex items-center gap-1.5">
                <Folder className="h-3.5 w-3.5" /> Total buckets
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{stats.totalBuckets}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardDescription className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Total files
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{stats.totalFiles.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardDescription className="flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5" /> Storage used
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{formatBytes(stats.totalSizeBytes)}</p>
            </CardContent>
          </Card>
        </div>
      )}

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
          description="Create a storage bucket to start uploading files and media assets for this project."
          actionLabel="Create bucket"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((bucket) => (
            <Card
              key={bucket.name}
              className="group hover:shadow-card-hover hover:border-primary/30 transition-all cursor-pointer"
              onClick={() => openFileBrowser(bucket.originalName)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-orange-500/10">
                      <Folder className="h-4 w-4 text-orange-500" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-sm font-medium font-mono truncate">
                        {bucket.originalName}
                      </CardTitle>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openFileBrowser(bucket.originalName)}>
                        Browse files
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => handleDeleteBucket(bucket.originalName)}
                      >
                        Delete bucket
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-mono text-[10px] text-muted-foreground/70 truncate max-w-[150px]">
                    {bucket.name}
                  </span>
                  <span>{formatRelativeTime(bucket.createdAt)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <Badge variant={bucket.isPublic ? 'default' : 'secondary'} className="text-xs">
                    {bucket.isPublic ? 'Public' : 'Private'}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-7 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      openFileBrowser(bucket.originalName);
                    }}
                  >
                    <Layers className="h-3.5 w-3.5" />
                    Browse
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* File Browser Modal */}
      {selectedBucket && (
        <Dialog open={!!selectedBucket} onOpenChange={(open) => !open && setSelectedBucket(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Folder className="h-5 w-5 text-orange-500" />
                <span>Bucket: {selectedBucket}</span>
              </DialogTitle>
              <DialogDescription>
                Upload, download, and manage files in this bucket.
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-xs text-muted-foreground">
                {files.length} file{files.length === 1 ? '' : 's'}
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <Button
                  size="sm"
                  disabled={uploadLoading}
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-1.5 h-8 text-xs"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {uploadLoading ? 'Uploading...' : 'Upload file'}
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[400px]">
              {filesLoading ? (
                <div className="py-8 space-y-2">
                  <LoadingSkeleton className="h-8 w-full" />
                  <LoadingSkeleton className="h-8 w-full" />
                </div>
              ) : files.length === 0 ? (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  No files uploaded yet in this bucket.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {files.map((file) => (
                    <div
                      key={file.key}
                      className="flex items-center justify-between py-2.5 px-1 hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate max-w-xs">{file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatBytes(file.size)} • {formatRelativeTime(file.lastModified)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          onClick={() => handleDownloadFile(file.key)}
                          title="Download"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-destructive hover:text-destructive"
                          onClick={() => handleDeleteFile(file.key)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={() => setSelectedBucket(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Create Bucket Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Storage Bucket</DialogTitle>
            <DialogDescription>
              Create an isolated S3 bucket for storing images, documents, and assets.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateBucket} className="space-y-4 py-2">
            {createError && (
              <div className="p-3 text-xs bg-destructive/10 text-destructive rounded-md">
                {createError}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Bucket name</label>
              <Input
                placeholder="avatars"
                value={bucketName}
                onChange={(e) => setBucketName(e.target.value)}
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Lowercase letters, numbers, and hyphens only.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="isPublic"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              <label htmlFor="isPublic" className="text-xs font-medium cursor-pointer">
                Public bucket (objects can be downloaded without authentication)
              </label>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={createLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createLoading}>
                {createLoading ? 'Creating...' : 'Create bucket'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
