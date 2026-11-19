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
  Wifi,
  WifiOff,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/shared/loading-skeleton';
import { ErrorState } from '@/components/shared/error-state';
import { useRealtime } from '@/hooks/use-realtime';
import api from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';

interface ProjectDetail {
  id: string;
  name: string;
  slug: string;
  ref: string;
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

const EVENT_COLORS = {
  INSERT: 'text-emerald-500 bg-emerald-500/10',
  UPDATE: 'text-blue-500 bg-blue-500/10',
  DELETE: 'text-red-500 bg-red-500/10',
};

export default function ProjectOverviewPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [project, setProject] = React.useState<ProjectDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Live metrics
  const [tableCount, setTableCount] = React.useState<number | null>(null);
  const [storageKb, setStorageKb] = React.useState<number | null>(null);
  const [recentTables, setRecentTables] = React.useState<{ name: string; rowCount?: number }[]>([]);

  // Realtime
  const { status: wsStatus, events, clearEvents } = useRealtime(project?.ref ?? null);

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

  const wsIndicator = {
    connected: { icon: Wifi, label: 'Realtime connected', color: 'text-emerald-500' },
    connecting: { icon: Loader2, label: 'Connecting...', color: 'text-yellow-500' },
    disconnected: { icon: WifiOff, label: 'Realtime offline', color: 'text-muted-foreground' },
    error: { icon: WifiOff, label: 'Realtime error', color: 'text-red-500' },
  }[wsStatus];

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
        {/* Realtime status pill */}
        <div className={`flex items-center gap-1.5 text-xs font-medium ${wsIndicator.color}`}>
          <wsIndicator.icon className={`h-3.5 w-3.5 ${wsStatus === 'connecting' ? 'animate-spin' : ''}`} />
          <span>{wsIndicator.label}</span>
        </div>
      </div>

      {/* Quick stats */}
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

      {/* Bottom row: Tables + Realtime Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Tables */}
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

        {/* Realtime Activity Feed */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Realtime Activity
              </h2>
              {wsStatus === 'connected' && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              )}
            </div>
            {events.length > 0 && (
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearEvents}>
                Clear
              </Button>
            )}
          </div>
          <Card>
            <CardContent className="p-0">
              {events.length === 0 ? (
                <div className="p-6 text-center space-y-2">
                  <Activity className="h-6 w-6 text-muted-foreground/40 mx-auto" />
                  <p className="text-xs text-muted-foreground">
                    {wsStatus === 'connected'
                      ? 'Listening for database changes...'
                      : wsStatus === 'connecting'
                      ? 'Connecting to realtime gateway...'
                      : 'API offline — start the API server to see live events'}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border max-h-64 overflow-y-auto">
                  {events.map((ev, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                      <span className={`text-xs font-bold font-mono px-1.5 py-0.5 rounded shrink-0 ${EVENT_COLORS[ev.type]}`}>
                        {ev.type}
                      </span>
                      <span className="text-xs font-mono font-medium">{ev.table}</span>
                      <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
                        {new Date(ev.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
