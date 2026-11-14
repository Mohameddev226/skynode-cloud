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

  React.useEffect(() => { fetchProject(); }, [slug]);

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
  const status = statusConfig[project.status];

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
              <p className="text-sm font-semibold truncate max-w-[140px]">{project.databaseName ?? 'Provisioned'}</p>
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
              <p className="text-sm font-semibold">S3 / MinIO Active</p>
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

      {/* Activity placeholder */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wider">Recent Activity</h2>
        <Card>
          <CardContent className="flex items-center gap-3 py-5">
            <Activity className="h-5 w-5 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Activity logs will appear here once the project is active and receiving traffic.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
