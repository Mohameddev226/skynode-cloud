'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Folder, Rocket } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadingSkeleton } from '@/components/shared/loading-skeleton';
import { ErrorState } from '@/components/shared/error-state';
import api from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';

interface Project {
  id: string;
  name: string;
  slug: string;
  description?: string;
  status: 'active' | 'paused' | 'archived';
  updatedAt: string;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchProjects() {
    setLoading(true);
    setError(null);

    const res = await api.get<Project[]>('/api/v1/projects');

    if (!res.success) {
      setError(res.error?.message ?? 'Failed to load projects');
      setLoading(false);
      return;
    }

    setProjects(res.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    fetchProjects();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <LoadingSkeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={fetchProjects} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Create and manage your cloud projects
          </p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New Project
        </Button>
      </div>

      {/* Project list or empty state */}
      {projects.length === 0 ? (
        <EmptyState
          icon={Folder}
          title="No projects yet"
          description="Get started by creating your first project to deploy applications."
          actionLabel="Create Project"
          onAction={() => {}}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.slug}`}>
              <Card className="group cursor-pointer transition-shadow hover:shadow-card-hover">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Rocket className="h-4 w-4" />
                      </div>
                      <CardTitle className="text-base">{project.name}</CardTitle>
                    </div>
                    <Badge
                      variant={
                        project.status === 'active'
                          ? 'default'
                          : project.status === 'paused'
                            ? 'secondary'
                            : 'outline'
                      }
                    >
                      {project.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {project.description && (
                    <CardDescription className="mb-2 line-clamp-2">
                      {project.description}
                    </CardDescription>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Updated {formatRelativeTime(project.updatedAt)}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
