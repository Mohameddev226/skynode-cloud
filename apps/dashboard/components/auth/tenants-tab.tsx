'use client';

import * as React from 'react';
import {
  Building2,
  Plus,
  Search,
  Users,
  Mail,
  Trash2,
  ShieldAlert,
  CheckCircle2,
  Archive,
  PauseCircle,
  Copy,
  Check,
  UserPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import api from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';

export interface TenantItem {
  id: string;
  slug: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  plan: string;
  metadata?: Record<string, unknown>;
  member_count?: number;
  created_at: string;
  updated_at: string;
}

export interface RoleSummary {
  id: string;
  name: string;
  description?: string | null;
  is_system: boolean;
  permissions?: Array<{ id?: string; resource: string; action: string }>;
}

interface TenantMemberItem {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  role_id: string;
  role_name: string;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  custom_attributes?: Record<string, unknown>;
  created_at: string;
}

interface TenantInvitationItem {
  id: string;
  email: string;
  role_id: string;
  role_name: string;
  token?: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

interface TenantsTabProps {
  slug: string;
  appUsers: Array<{ id: string; email: string; full_name: string | null }>;
}

const STATUS_BADGE: Record<TenantItem['status'], string> = {
  ACTIVE: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  SUSPENDED: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  ARCHIVED: 'bg-muted text-muted-foreground border-border',
};

export function TenantsTab({ slug, appUsers }: TenantsTabProps) {
  const [tenants, setTenants] = React.useState<TenantItem[]>([]);
  const [roles, setRoles] = React.useState<RoleSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<'ALL' | TenantItem['status']>('ALL');

  // Create Tenant modal
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newSlug, setNewSlug] = React.useState('');
  const [newPlan, setNewPlan] = React.useState('STANDARD');
  const [newOwnerId, setNewOwnerId] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  // Manage Tenant Members & Invitations modal
  const [selectedTenant, setSelectedTenant] = React.useState<TenantItem | null>(null);
  const [members, setMembers] = React.useState<TenantMemberItem[]>([]);
  const [invitations, setInvitations] = React.useState<TenantInvitationItem[]>([]);
  const [membersLoading, setMembersLoading] = React.useState(false);
  const [membersError, setMembersError] = React.useState<string | null>(null);

  // Add Member form
  const [memberUserId, setMemberUserId] = React.useState('');
  const [memberEmail, setMemberEmail] = React.useState('');
  const [memberRole, setMemberRole] = React.useState('member');
  const [memberAttrsJson, setMemberAttrsJson] = React.useState('');
  const [addingMember, setAddingMember] = React.useState(false);

  // Invite form
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [inviteRole, setInviteRole] = React.useState('member');
  const [inviting, setInviting] = React.useState(false);
  const [latestInviteToken, setLatestInviteToken] = React.useState<string | null>(null);
  const [copiedToken, setCopiedToken] = React.useState(false);

  const fetchTenantsAndRoles = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const [tenantsRes, rolesRes] = await Promise.all([
      api.get<{ tenants: TenantItem[]; total: number }>(`/api/v1/projects/${slug}/tenants?limit=100`),
      api.get<RoleSummary[]>(`/api/v1/projects/${slug}/tenants/roles`),
    ]);

    if (!tenantsRes.success) {
      setError(tenantsRes.error?.message ?? 'Failed to load tenants');
    } else {
      setTenants(tenantsRes.data?.tenants ?? []);
    }
    if (rolesRes.success && Array.isArray(rolesRes.data)) {
      setRoles(rolesRes.data);
    }
    setLoading(false);
  }, [slug]);

  React.useEffect(() => {
    fetchTenantsAndRoles();
  }, [fetchTenantsAndRoles]);

  async function handleCreateTenant(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);

    const payload: Record<string, unknown> = {
      name: newName.trim(),
      plan: newPlan,
    };
    if (newSlug.trim()) payload.slug = newSlug.trim().toLowerCase();
    if (newOwnerId) payload.owner_user_id = newOwnerId;

    const res = await api.post<TenantItem>(`/api/v1/projects/${slug}/tenants`, payload);
    if (!res.success) {
      setCreateError(res.error?.message ?? 'Failed to create tenant');
      setCreating(false);
      return;
    }

    setCreateOpen(false);
    setNewName('');
    setNewSlug('');
    setNewPlan('STANDARD');
    setNewOwnerId('');
    setCreating(false);
    await fetchTenantsAndRoles();
  }

  async function handleStatusChange(tenant: TenantItem, status: TenantItem['status']) {
    const res = await api.patch(`/api/v1/projects/${slug}/tenants/${tenant.id}/status`, { status });
    if (!res.success) {
      setError(res.error?.message ?? 'Failed to update tenant status');
      return;
    }
    setTenants((prev) => prev.map((t) => (t.id === tenant.id ? { ...t, status } : t)));
  }

  async function handleDeleteTenant(tenant: TenantItem) {
    if (!confirm(`Delete tenant "${tenant.name}" (${tenant.slug}) and all its memberships?`)) return;
    const res = await api.delete(`/api/v1/projects/${slug}/tenants/${tenant.id}`);
    if (!res.success) {
      setError(res.error?.message ?? 'Failed to delete tenant');
      return;
    }
    setTenants((prev) => prev.filter((t) => t.id !== tenant.id));
  }

  async function openManageMembers(tenant: TenantItem) {
    setSelectedTenant(tenant);
    setMembersError(null);
    setLatestInviteToken(null);
    setMembersLoading(true);

    const [memRes, invRes, tenantRolesRes] = await Promise.all([
      api.get<{ members: TenantMemberItem[] }>(`/api/v1/projects/${slug}/tenants/${tenant.id}/members`),
      api.get<{ invitations: TenantInvitationItem[] }>(`/api/v1/projects/${slug}/tenants/${tenant.id}/invitations`),
      api.get<RoleSummary[]>(`/api/v1/projects/${slug}/tenants/${tenant.id}/roles`),
    ]);

    if (!memRes.success) {
      setMembersError(memRes.error?.message ?? 'Failed to load tenant members');
    } else {
      setMembers(memRes.data?.members ?? []);
    }
    setInvitations(invRes.success ? (invRes.data?.invitations ?? []) : []);
    if (tenantRolesRes.success && Array.isArray(tenantRolesRes.data)) {
      setRoles(tenantRolesRes.data);
    }
    setMembersLoading(false);
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTenant || (!memberUserId && !memberEmail.trim())) return;

    let customAttributes: Record<string, unknown> | undefined;
    if (memberAttrsJson.trim()) {
      try {
        customAttributes = JSON.parse(memberAttrsJson);
      } catch {
        setMembersError('Custom attributes must be valid JSON (e.g. {"station_id": "abc"})');
        return;
      }
    }

    setAddingMember(true);
    setMembersError(null);

    const body: Record<string, unknown> = {
      role: memberRole,
    };
    if (memberUserId) body.user_id = memberUserId;
    else if (memberEmail.trim()) body.email = memberEmail.trim();
    if (customAttributes) body.custom_attributes = customAttributes;

    const res = await api.post(`/api/v1/projects/${slug}/tenants/${selectedTenant.id}/members`, body);
    if (!res.success) {
      setMembersError(res.error?.message ?? 'Failed to add member');
      setAddingMember(false);
      return;
    }

    setMemberUserId('');
    setMemberEmail('');
    setMemberAttrsJson('');
    setAddingMember(false);
    await openManageMembers(selectedTenant);
    await fetchTenantsAndRoles();
  }

  async function handleUpdateMemberRole(userId: string, roleName: string) {
    if (!selectedTenant) return;
    const res = await api.patch(
      `/api/v1/projects/${slug}/tenants/${selectedTenant.id}/members/${userId}`,
      { role: roleName },
    );
    if (!res.success) {
      setMembersError(res.error?.message ?? 'Failed to update member role');
      return;
    }
    await openManageMembers(selectedTenant);
  }

  async function handleRemoveMember(userId: string) {
    if (!selectedTenant || !confirm('Remove this user from the tenant?')) return;
    const res = await api.delete(
      `/api/v1/projects/${slug}/tenants/${selectedTenant.id}/members/${userId}`,
    );
    if (!res.success) {
      setMembersError(res.error?.message ?? 'Failed to remove member');
      return;
    }
    await openManageMembers(selectedTenant);
    await fetchTenantsAndRoles();
  }

  async function handleSendInvitation(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTenant || !inviteEmail.trim()) return;
    setInviting(true);
    setMembersError(null);

    const res = await api.post<{ token?: string }>(
      `/api/v1/projects/${slug}/tenants/${selectedTenant.id}/invitations`,
      { email: inviteEmail.trim(), role: inviteRole },
    );
    if (!res.success) {
      setMembersError(res.error?.message ?? 'Failed to create invitation');
      setInviting(false);
      return;
    }

    setInviteEmail('');
    setLatestInviteToken(res.data?.token ?? null);
    setInviting(false);
    await openManageMembers(selectedTenant);
  }

  const filtered = tenants.filter((t) => {
    const matchesStatus = statusFilter === 'ALL' || t.status === statusFilter;
    const q = search.trim().toLowerCase();
    const matchesQuery =
      !q || t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q);
    return matchesStatus && matchesQuery;
  });

  if (loading) {
    return (
      <div className="space-y-3">
        <LoadingSkeleton className="h-10 rounded-md" />
        <LoadingSkeleton className="h-44 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="underline ml-2">Dismiss</button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2 min-w-[240px]">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search tenants by name or slug..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="h-9 rounded-md border border-input bg-background px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>

        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          New tenant
        </Button>
      </div>

      {/* Tenant list */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No tenants found"
          description={
            search || statusFilter !== 'ALL'
              ? 'No organizations match your filter criteria.'
              : 'Create your first tenant organization (e.g., Shell Somalia, Al-Noor School) to isolate application data via auth.tenant_id().'
          }
          action={
            !search && statusFilter === 'ALL' ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> Create first tenant
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              <div className="grid grid-cols-[1.5fr_1fr_auto_auto_auto_auto] gap-4 px-4 py-2.5 text-xs font-medium text-muted-foreground bg-muted/20">
                <span>Organization</span>
                <span>Slug</span>
                <span>Plan</span>
                <span>Members</span>
                <span>Status</span>
                <span className="text-right">Actions</span>
              </div>
              {filtered.map((tenant) => (
                <div
                  key={tenant.id}
                  className="grid grid-cols-[1.5fr_1fr_auto_auto_auto_auto] gap-4 items-center px-4 py-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{tenant.name}</p>
                    <p className="text-[11px] font-mono text-muted-foreground truncate">
                      {tenant.id} · created {formatRelativeTime(tenant.created_at)}
                    </p>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground truncate">
                    {tenant.slug}
                  </span>
                  <Badge variant="outline" className="text-[11px] font-mono">
                    {tenant.plan}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openManageMembers(tenant)}
                    className="h-7 px-2 text-xs gap-1"
                  >
                    <Users className="h-3.5 w-3.5" />
                    {tenant.member_count ?? 0}
                  </Button>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-medium ${STATUS_BADGE[tenant.status]}`}
                  >
                    {tenant.status}
                  </span>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => openManageMembers(tenant)}
                    >
                      Members
                    </Button>
                    {tenant.status === 'ACTIVE' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-amber-500"
                        title="Suspend tenant"
                        onClick={() => handleStatusChange(tenant, 'SUSPENDED')}
                      >
                        <PauseCircle className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-emerald-500"
                        title="Activate tenant"
                        onClick={() => handleStatusChange(tenant, 'ACTIVE')}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {tenant.status !== 'ARCHIVED' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-muted-foreground"
                        title="Archive tenant"
                        onClick={() => handleStatusChange(tenant, 'ARCHIVED')}
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-destructive"
                      title="Delete tenant"
                      onClick={() => handleDeleteTenant(tenant)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create Tenant Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Tenant</DialogTitle>
            <DialogDescription>
              Provision a new isolated organization inside this project&apos;s data plane.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateTenant} className="space-y-4 py-2">
            {createError && (
              <div className="p-2.5 text-xs bg-destructive/10 text-destructive rounded-md">
                {createError}
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Organization Name</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Shell Somalia"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Slug (optional)</label>
                <Input
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value)}
                  placeholder="auto-generated"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Plan</label>
                <select
                  value={newPlan}
                  onChange={(e) => setNewPlan(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-xs"
                >
                  <option value="STANDARD">STANDARD</option>
                  <option value="PRO">PRO</option>
                  <option value="ENTERPRISE">ENTERPRISE</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Initial Owner (optional)</label>
              <select
                value={newOwnerId}
                onChange={(e) => setNewOwnerId(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-xs"
              >
                <option value="">No initial owner (assign later)</option>
                {appUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email} {u.full_name ? `(${u.full_name})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? 'Creating...' : 'Create tenant'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Manage Members & Invitations Modal */}
      <Dialog open={Boolean(selectedTenant)} onOpenChange={(o) => !o && setSelectedTenant(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              {selectedTenant?.name}
              <Badge variant="outline" className="font-mono text-xs">{selectedTenant?.slug}</Badge>
            </DialogTitle>
            <DialogDescription>
              Manage tenant memberships, role assignments, custom attributes, and invitations.
            </DialogDescription>
          </DialogHeader>

          {membersError && (
            <div className="flex items-center gap-2 p-2.5 text-xs bg-destructive/10 text-destructive rounded-md">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>{membersError}</span>
            </div>
          )}

          {membersLoading ? (
            <LoadingSkeleton className="h-32 rounded-md" />
          ) : (
            <div className="space-y-5 py-1">
              {/* Add Existing User */}
              <form onSubmit={handleAddMember} className="rounded-lg border border-border p-3.5 space-y-3 bg-muted/20">
                <p className="text-xs font-semibold flex items-center gap-1.5">
                  <UserPlus className="h-3.5 w-3.5" /> Add User to Tenant
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <select
                    value={memberUserId}
                    onChange={(e) => {
                      setMemberUserId(e.target.value);
                      if (e.target.value) setMemberEmail('');
                    }}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="">Select user or enter email...</option>
                    {appUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.email}</option>
                    ))}
                  </select>
                  <Input
                    type="email"
                    value={memberEmail}
                    onChange={(e) => {
                      setMemberEmail(e.target.value);
                      if (e.target.value) setMemberUserId('');
                    }}
                    placeholder="Or user email"
                    className="h-8 text-xs"
                    disabled={Boolean(memberUserId)}
                  />
                  <select
                    value={memberRole}
                    onChange={(e) => setMemberRole(e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    {(roles.length > 0
                      ? roles
                      : [
                          { id: 'owner', name: 'owner', is_system: true },
                          { id: 'admin', name: 'admin', is_system: true },
                          { id: 'member', name: 'member', is_system: true },
                          { id: 'viewer', name: 'viewer', is_system: true },
                        ]
                    ).map((r) => (
                      <option key={r.id} value={r.name}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={memberAttrsJson}
                    onChange={(e) => setMemberAttrsJson(e.target.value)}
                    placeholder='Optional custom_attributes JSON e.g. {"station_id":"st-01"}'
                    className="h-8 text-xs font-mono flex-1"
                  />
                  <Button type="submit" size="sm" className="h-8 text-xs" disabled={addingMember || (!memberUserId && !memberEmail.trim())}>
                    {addingMember ? 'Adding...' : 'Add member'}
                  </Button>
                </div>
              </form>

              {/* Current Members */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Members ({members.length})
                </p>
                {members.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-3 text-center border border-dashed rounded-md">
                    No active members assigned to this tenant yet.
                  </p>
                ) : (
                  <div className="divide-y divide-border rounded-md border">
                    {members.map((m) => (
                      <div key={m.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">
                            {m.email} {m.full_name ? <span className="text-muted-foreground">({m.full_name})</span> : null}
                          </p>
                          {m.custom_attributes && Object.keys(m.custom_attributes).length > 0 && (
                            <p className="text-[11px] font-mono text-muted-foreground truncate">
                              {JSON.stringify(m.custom_attributes)}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <select
                            value={m.role_name}
                            onChange={(e) => handleUpdateMemberRole(m.user_id, e.target.value)}
                            className="h-7 rounded border border-input bg-background px-1.5 text-xs"
                          >
                            {roles.map((r) => (
                              <option key={r.id} value={r.name}>{r.name}</option>
                            ))}
                          </select>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-destructive"
                            onClick={() => handleRemoveMember(m.user_id)}
                            title="Remove member"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Invitations */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> Invitations ({invitations.length})
                </p>
                <form onSubmit={handleSendInvitation} className="flex items-center gap-2">
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    className="h-8 text-xs flex-1"
                    required
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    {roles.map((r) => (
                      <option key={r.id} value={r.name}>{r.name}</option>
                    ))}
                  </select>
                  <Button type="submit" size="sm" variant="secondary" className="h-8 text-xs" disabled={inviting}>
                    {inviting ? 'Sending...' : 'Invite'}
                  </Button>
                </form>

                {latestInviteToken && (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs">
                    <span className="font-mono truncate">Invite token: {latestInviteToken}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(latestInviteToken);
                        setCopiedToken(true);
                        setTimeout(() => setCopiedToken(false), 1500);
                      }}
                    >
                      {copiedToken ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                )}

                {invitations.length > 0 && (
                  <div className="divide-y divide-border rounded-md border">
                    {invitations.map((inv) => (
                      <div key={inv.id} className="flex items-center justify-between px-3 py-2 text-xs">
                        <span className="truncate">{inv.email}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{inv.role_name}</Badge>
                          <Badge variant={inv.accepted_at ? 'default' : 'secondary'} className="text-[10px]">
                            {inv.accepted_at ? 'Accepted' : 'Pending'}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
