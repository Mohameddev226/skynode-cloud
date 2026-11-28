'use client';

import * as React from 'react';
import { KeyRound, Plus, Trash2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LoadingSkeleton } from '@/components/shared/loading-skeleton';
import api from '@/lib/api';
import type { RoleSummary } from './tenants-tab';

interface PermInput {
  resource: string;
  action: string;
}

export function RolesTab({ slug }: { slug: string }) {
  const [roles, setRoles] = React.useState<RoleSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [perms, setPerms] = React.useState<PermInput[]>([{ resource: '*', action: 'read' }]);
  const [saving, setSaving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const fetchRoles = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await api.get<RoleSummary[]>(`/api/v1/projects/${slug}/tenants/roles`);
    if (!res.success) {
      setError(res.error?.message ?? 'Failed to load RBAC roles');
    } else {
      setRoles(Array.isArray(res.data) ? res.data : []);
    }
    setLoading(false);
  }, [slug]);

  React.useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  async function handleCreateRole(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setFormError(null);

    const validPerms = perms.filter((p) => p.resource.trim() && p.action.trim());
    const res = await api.post(`/api/v1/projects/${slug}/tenants/roles`, {
      name: name.trim(),
      description: description.trim() || undefined,
      permissions: validPerms,
    });

    if (!res.success) {
      setFormError(res.error?.message ?? 'Failed to create role');
      setSaving(false);
      return;
    }

    setCreateOpen(false);
    setName('');
    setDescription('');
    setPerms([{ resource: '*', action: 'read' }]);
    setSaving(false);
    await fetchRoles();
  }

  async function handleDeleteRole(role: RoleSummary) {
    if (!confirm(`Delete custom role "${role.name}"?`)) return;
    const res = await api.delete(`/api/v1/projects/${slug}/tenants/roles/${role.id}`);
    if (!res.success) {
      setError(res.error?.message ?? 'Failed to delete role');
      return;
    }
    setRoles((prev) => prev.filter((r) => r.id !== role.id));
  }

  if (loading) {
    return <LoadingSkeleton className="h-48 rounded-lg" />;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-2.5 text-xs bg-destructive/10 text-destructive rounded-md">{error}</div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Project-Wide RBAC Roles</h3>
          <p className="text-xs text-muted-foreground">
            Checked dynamically inside PostgreSQL RLS via <code className="font-mono">auth.has_permission(resource, action)</code>.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          New custom role
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {roles.map((role) => (
          <Card key={role.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {role.is_system ? (
                    <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
                  ) : (
                    <KeyRound className="h-4 w-4 text-primary shrink-0" />
                  )}
                  <CardTitle className="text-sm font-mono">{role.name}</CardTitle>
                  <Badge variant={role.is_system ? 'secondary' : 'outline'} className="text-[10px]">
                    {role.is_system ? 'System' : 'Custom'}
                  </Badge>
                </div>
                {!role.is_system && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-destructive"
                    onClick={() => handleDeleteRole(role)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              {role.description && (
                <CardDescription className="text-xs">{role.description}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap gap-1.5">
                {(role.permissions ?? []).length === 0 ? (
                  <span className="text-xs text-muted-foreground">No permissions assigned</span>
                ) : (
                  (role.permissions ?? []).map((p, idx) => (
                    <Badge key={p.id ?? idx} variant="outline" className="font-mono text-[11px]">
                      {p.resource}:{p.action}
                    </Badge>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create Role Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Custom RBAC Role</DialogTitle>
            <DialogDescription>
              Define a reusable role (e.g. manager, accountant, cashier) with resource/action rules.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateRole} className="space-y-4 py-2">
            {formError && (
              <div className="p-2.5 text-xs bg-destructive/10 text-destructive rounded-md">
                {formError}
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Role Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. station_manager"
                className="font-mono text-xs"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Description</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Manage assigned station sales and shifts"
                className="text-xs"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">Permissions</label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setPerms((prev) => [...prev, { resource: '', action: 'read' }])}
                >
                  + Add rule
                </Button>
              </div>
              {perms.map((perm, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                  <Input
                    value={perm.resource}
                    onChange={(e) =>
                      setPerms((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, resource: e.target.value } : p)),
                      )
                    }
                    placeholder="table or * (e.g. fuel_sales)"
                    className="h-8 text-xs font-mono"
                  />
                  <select
                    value={perm.action}
                    onChange={(e) =>
                      setPerms((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, action: e.target.value } : p)),
                      )
                    }
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs font-mono"
                  >
                    <option value="*">* (all actions)</option>
                    <option value="read">read</option>
                    <option value="create">create</option>
                    <option value="update">update</option>
                    <option value="delete">delete</option>
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-destructive"
                    onClick={() => setPerms((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={perms.length === 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Creating...' : 'Create role'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
