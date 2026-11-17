'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import {
  Database,
  Shield,
  HardDrive,
  Zap,
  Activity,
  Clock,
  CheckCircle2,
  AlertCircle,
  Table2,
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSkeleton } from '@/components/shared/loading-skeleton';
import { ErrorState } from '@/components/shared/error-state';
import api from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';

interface ProjectDetail {
  id: string;
  name: string;
  slug: string;
  description?: string;
  status: 'active' | 'paused' | 'archived';
  createdAt: string;
  updatedAt: string;
  databaseName?: string;
  region?: string;
}

const serviceCards = [
  {
    label: 'Database',
    description: 'Tables, SQL editor, and schema management',
    icon: Database,
    href: 'database',
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
  },
  {
    label: 'Auth',
    description: 'Users, sessions, and access control',
    icon: Shield,
    href: 'auth',
    color: 'text-green-500',
    bg: 'bg-green-500/10',
  },
  {
    label: 'Storage',
    description: 'File buckets and object management',
    icon: HardDrive,
    href: 'storage',
    color: 'text-orange-500',
    bg: 'bg-orange-500/10',
  },
  {
    label: 'API',
    description: 'Auto-generated REST endpoints and keys',
    icon: Zap,
    href: 'api',
    color: 'text-purple-500',
    bg: 'bg-purple-500/10',
  },
];

export default function ProjectOverviewPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [project, setProject] = React.useState<ProjectDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Live metrics from database tables
  const [tableCount, setTableCount] = React.useState<number | null>(null);
  const [storageKb, setStorageKb] = React.useState<number | null>(null);
  const [recentTables, setRecentTables] = React.useState<{ name: string; rowCount?: number }[]>([]);

  async function fetchProject() {
    setLoading(true);
    setError(null);
    const res = await api.get<ProjectDetail>(`/api/v1/projects/${slug}`);
    if (!res.success) {
      setError(res.error?.message ?? 'Failed to load project');
    } else {
      setProject(res.data ?? null);
    }
    setLoading(false);
  }

  React.useEffect(() => {
    fetchProject();
  }, [slug]);

  React.useEffect(() => {
    api.get<any>(`/api/v1/projects/${slug}/database/tables`).then((res) => {
      if (res.success && res.data) {
        const tables = Array.isArray(res.data) ? res.data : (res.data as any).data ?? [];
        setTableCount(tables.length);
        const totalBytes = tables.reduce((sum: number, t: any) => sum + (t.sizeBytes ?? 0), 0);
        setStorageKb(totalBytes / 1024);
        setRecentTables(tables.slice(0, 6));
      }
    });
  }, [slug]);

  if (loading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton className="h-24 rounded-lg" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <LoadingSkeleton key={i} className="h-32 rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (error || !project) {
    return <ErrorState message={error ?? 'Project not found'} onRetry={fetchProject} />;
  }

  const statusConfig = {
    active: { label: 'Active', icon: CheckCircle2, color: 'text-green-500' },
    paused: { label: 'Paused', icon: AlertCircle, color: 'text-yellow-500' },
    archived: { label: 'Archived', icon: Clock, color: 'text-muted-foreground' },
  };
  const normStatus = (project.status?.toLowerCase() ?? 'active') as 'active' | 'paused' | 'archived';
  const status = statusConfig[normStatus] ?? statusConfig.active;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Project header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
            <Badge
              variant={project.status === 'active' ? 'default' : 'secondary'}
              className="gap-1"
            >
              <status.icon className={`h-3 w-3 ${status.color}`} />
              {status.label}
            </Badge>
          </div>
          {project.description && (
            <p className="text-sm text-muted-foreground">{project.description}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Created {formatRelativeTime(project.createdAt)}
            {project.region && ` · ${project.region}`}
          </p>
        </div>
      </div>

      {/* Quick stats / Infrastructure Overview */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Database</p>
              <p className="text-sm font-semibold truncate max-w-[140px]">
                {tableCount !== null ? `${tableCount} tables` : (project.databaseName ?? 'Provisioned')}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10 text-green-500">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Auth Engine</p>
              <p className="text-sm font-semibold">Enabled</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Storage</p>
              <p className="text-sm font-semibold">
                {storageKb !== null
                  ? storageKb > 1024
                    ? `${(storageKb / 1024).toFixed(1)} MB used`
                    : `${storageKb.toFixed(1)} KB used`
                  : 'S3 / MinIO Active'}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10 text-purple-500">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Region</p>
              <p className="text-sm font-semibold capitalize">{project.region ?? 'Default (Local)'}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Service cards */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wider">Services</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {serviceCards.map((svc) => (
            <Link key={svc.href} href={`/projects/${slug}/${svc.href}`}>
              <Card className="group h-full cursor-pointer transition-all hover:shadow-card-hover hover:border-primary/30">
                <CardHeader className="pb-2">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${svc.bg} mb-2`}>
                    <svc.icon className={`h-5 w-5 ${svc.color}`} />
                  </div>
                  <CardTitle className="text-base group-hover:text-primary transition-colors">
                    {svc.label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-xs">{svc.description}</CardDescription>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent Tables & Quick Access */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Tables ({tableCount ?? 0})
          </h2>
          <Link
            href={`/projects/${slug}/database`}
            className="text-xs text-emerald-500 hover:text-emerald-400 font-medium"
          >
            Open Table Editor →
          </Link>
        </div>
        <Card>
          <CardContent className="p-0 divide-y divide-border">
            {recentTables.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No tables created yet. Click Table Editor to create your first table.
              </div>
            ) : (
              recentTables.map((t) => (
                <div
                  key={t.name}
                  className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-2.5 text-xs font-mono">
                    <Table2 className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="font-semibold text-foreground">{t.name}</span>
                  </div>
                  <Link
                    href={`/projects/${slug}/database`}
                    className="text-xs text-muted-foreground hover:text-emerald-500 transition-colors"
                  >
                    View rows →
                  </Link>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
