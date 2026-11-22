'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Settings, Trash2, AlertTriangle, RefreshCw, Copy } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LoadingSkeleton } from '@/components/shared/loading-skeleton';
import { ErrorState } from '@/components/shared/error-state';
import api from '@/lib/api';

interface ProjectSettings {
  id: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  createdAt: string;
  databaseName: string;
}

const updateSchema = z.object({
  name: z.string().min(2).max(50),
  description: z.string().max(200).optional(),
});
type UpdateValues = z.infer<typeof updateSchema>;

export default function ProjectSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const [settings, setSettings] = React.useState<ProjectSettings | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteConfirm, setDeleteConfirm] = React.useState('');
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);

  const { register, handleSubmit, reset, formState: { errors, isDirty } } =
    useForm<UpdateValues>({ resolver: zodResolver(updateSchema) });

  async function fetchSettings() {
    setLoading(true);
    setError(null);
    const res = await api.get<ProjectSettings>(`/api/v1/projects/${slug}`);
    if (!res.success) setError(res.error?.message ?? 'Failed to load settings');
    else {
      setSettings(res.data ?? null);
      reset({ name: res.data?.name, description: res.data?.description ?? '' });
    }
    setLoading(false);
  }

  React.useEffect(() => { fetchSettings(); }, [slug]);

  async function onSave(data: UpdateValues) {
    setSaving(true);
    const res = await api.patch(`/api/v1/projects/${slug}`, data);
    if (res.success) {
      await fetchSettings();
      if (data.name !== settings?.name) router.replace(`/projects/${data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (deleteConfirm !== settings?.name) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await api.delete(`/api/v1/projects/${slug}`);
    if (res.success) {
      router.push('/projects');
    } else {
      setDeleteError(res.error?.message ?? 'Failed to delete project');
      setDeleting(false);
    }
  }

  async function copyText(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  if (loading) return <div className="space-y-6"><LoadingSkeleton className="h-64 rounded-lg" /></div>;
  if (error || !settings) return <ErrorState message={error ?? 'Not found'} onRetry={fetchSettings} />;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage project configuration</p>
        </div>
        <Button variant="outline" size="icon" onClick={fetchSettings} title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="infrastructure">Infrastructure</TabsTrigger>
          <TabsTrigger value="danger">Danger zone</TabsTrigger>
        </TabsList>

        {/* General */}
        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">General settings</CardTitle>
              <CardDescription>Update your project name and description.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onSave)} className="space-y-4 max-w-md">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Project name</Label>
                  <Input id="name" {...register('name')} aria-invalid={!!errors.name} />
                  {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description">Description <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <Textarea id="description" rows={3} {...register('description')} />
                </div>
                <Button type="submit" disabled={!isDirty || saving} loading={saving}>
                  Save changes
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Infrastructure */}
        <TabsContent value="infrastructure">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Infrastructure details</CardTitle>
              <CardDescription>Read-only information about this project's underlying resources.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { label: 'Project ID', value: settings.id },
                { label: 'Project slug', value: settings.slug },
                { label: 'Database name', value: settings.databaseName },
              ].map(({ label, value }) => (
                <div key={label} className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
                  <div className="flex items-center gap-2">
                    <Input value={value} readOnly className="font-mono text-xs" />
                    <Button variant="outline" size="icon" className="shrink-0" onClick={() => copyText(value, label)}>
                      <Copy className={`h-4 w-4 ${copied === label ? 'text-green-500' : ''}`} />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Danger zone */}
        <TabsContent value="danger">
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="text-base text-destructive flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Danger zone
              </CardTitle>
              <CardDescription>These actions are irreversible. Proceed with extreme caution.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Delete this project</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Permanently deletes the project, database, all data, files, and credentials.
                  </p>
                </div>
                <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete project
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={(v) => { setDeleteOpen(v); setDeleteConfirm(''); setDeleteError(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Delete project
            </DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{settings.name}</strong> and all its data,
              including the database, stored files, and credentials. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {deleteError}
            </div>
          )}

          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Type <strong className="text-foreground">{settings.name}</strong> to confirm deletion:
            </p>
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={settings.name}
              className="font-mono"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteOpen(false); setDeleteConfirm(''); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteConfirm !== settings.name || deleting}
              loading={deleting}
              onClick={handleDelete}
            >
              Delete project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
