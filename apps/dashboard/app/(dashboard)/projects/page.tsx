'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Folder,
  Rocket,
  Search,
  MoreVertical,
  Settings,
  Trash2,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { EmptyState } from '@/components/shared/empty-state';
import { LoadingSkeleton } from '@/components/shared/loading-skeleton';
import { ErrorState } from '@/components/shared/error-state';
import { CreateProjectModal } from '@/components/projects/create-project-modal';
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
  const router = useRouter();
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [createOpen, setCreateOpen] = React.useState(false);

  // Deletion modal state
  const [projectToDelete, setProjectToDelete] = React.useState<Project | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = React.useState('');
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  async function fetchProjects() {
    setLoading(true);
    setError(null);

    const res = await api.get<Project[]>('/api/v1/projects');

    if (!res.success) {
      setError(res.error?.message ?? 'Failed to load projects');
      setLoading(false);
      return;
    }

    const list = Array.isArray(res.data)
      ? res.data
      : Array.isArray((res.data as any)?.data)
        ? (res.data as any).data
        : [];

    setProjects(list);
    setLoading(false);
  }

  React.useEffect(() => {
    fetchProjects();
  }, []);

  async function handleDeleteProject() {
    if (!projectToDelete) return;
    if (deleteConfirmInput !== projectToDelete.name) return;

    setDeleting(true);
    setDeleteError(null);

    const res = await api.delete(`/api/v1/projects/${projectToDelete.slug}`);
    if (!res.success) {
      setDeleteError(res.error?.message ?? 'Failed to delete project');
      setDeleting(false);
      return;
    }

    // Successfully deleted: remove from state & close modal
    setProjects((prev) => prev.filter((p) => p.id !== projectToDelete.id));
    setProjectToDelete(null);
    setDeleteConfirmInput('');
    setDeleting(false);
  }

  const filtered = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.slug.toLowerCase().includes(search.toLowerCase())
  );

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
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Create and manage your cloud projects
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Project
        </Button>
      </div>

      {/* Search (only show if there are projects) */}
      {projects.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      )}

      {/* Project list or empty state */}
      {projects.length === 0 ? (
        <EmptyState
          icon={Folder}
          title="No projects yet"
          description="Get started by creating your first project to deploy applications."
          actionLabel="Create Project"
          onAction={() => setCreateOpen(true)}
        />
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No projects match &quot;{search}&quot;
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project) => (
            <div key={project.id} className="relative group">
              <Link href={`/projects/${project.slug}`}>
                <Card className="cursor-pointer transition-all hover:shadow-card-hover hover:border-primary/40 h-full">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <Rocket className="h-4 w-4" />
                        </div>
                        <CardTitle className="text-base group-hover:text-primary transition-colors">
                          {project.name}
                        </CardTitle>
                      </div>

                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
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

                        {/* Card Actions Dropdown */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground opacity-60 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                              }}
                            >
                              <MoreVertical className="h-4 w-4" />
                              <span className="sr-only">Actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="w-44 z-50 bg-card border border-border shadow-lg"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <DropdownMenuItem asChild>
                              <Link href={`/projects/${project.slug}`} className="cursor-pointer flex items-center">
                                <ExternalLink className="mr-2 h-4 w-4" />
                                Open Project
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={`/projects/${project.slug}/settings`} className="cursor-pointer flex items-center">
                                <Settings className="mr-2 h-4 w-4" />
                                Settings
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:bg-destructive/10 focus:text-destructive cursor-pointer flex items-center"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                setProjectToDelete(project);
                                setDeleteConfirmInput('');
                                setDeleteError(null);
                              }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete Project
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
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
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!projectToDelete}
        onOpenChange={(open) => {
          if (!open) {
            setProjectToDelete(null);
            setDeleteConfirmInput('');
            setDeleteError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Delete Project
            </DialogTitle>
            <DialogDescription>
              This will permanently delete{' '}
              <strong className="text-foreground">{projectToDelete?.name}</strong> and all its data,
              including its PostgreSQL database, tables, RLS policies, storage files, and API keys.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {deleteError}
            </div>
          )}

          <div className="space-y-2 py-2">
            <label className="text-xs text-muted-foreground">
              Please type <strong className="text-foreground font-mono">{projectToDelete?.name}</strong> to confirm:
            </label>
            <Input
              value={deleteConfirmInput}
              onChange={(e) => setDeleteConfirmInput(e.target.value)}
              placeholder={projectToDelete?.name}
              className="font-mono text-sm"
              autoFocus
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              disabled={deleting}
              onClick={() => {
                setProjectToDelete(null);
                setDeleteConfirmInput('');
                setDeleteError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteConfirmInput !== projectToDelete?.name || deleting}
              loading={deleting}
              onClick={handleDeleteProject}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create project modal */}
      <CreateProjectModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={(project) => {
          router.push(`/projects/${project.slug}`);
          fetchProjects();
        }}
      />
    </div>
  );
}
