'use client';

import * as React from 'react';
import { X, Plus, Shield, ShieldOff, Trash2, Lock, AlertCircle, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import api from '@/lib/api';

interface Policy {
  name: string;
  command: string;
  permissive: string;
  roles?: string[];
  using_expr: string | null;
  with_check_expr: string | null;
  rls_enabled: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  projectSlug: string;
  tableName: string;
  schema?: string;
}

export function RlsPanel({ isOpen, onClose, projectSlug, tableName, schema = 'public' }: Props) {
  const [policies, setPolicies] = React.useState<Policy[]>([]);
  const [rlsEnabled, setRlsEnabled] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [showCreate, setShowCreate] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Create policy form state
  const [pName, setPName] = React.useState('');
  const [pCmd, setPCmd] = React.useState<'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'>('ALL');
  const [pUsing, setPUsing] = React.useState('');
  const [pWithCheck, setPWithCheck] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [toggling, setToggling] = React.useState(false);
  const [applyingTemplate, setApplyingTemplate] = React.useState<string | null>(null);
  const [tenantColumn, setTenantColumn] = React.useState('tenant_id');

  const fetchPolicies = React.useCallback(async () => {
    if (!tableName) return;
    setLoading(true);
    setError(null);
    const res = await api.get<any>(
      `/api/v1/projects/${projectSlug}/database/tables/${tableName}/policies?schema=${schema}`
    );
    if (!res.success) {
      setError(res.error?.message ?? 'Failed to load policies');
      setLoading(false);
      return;
    }
    const rawData = res.data;
    const data: Policy[] = Array.isArray(rawData) ? rawData : (rawData as any)?.data ?? [];
    setPolicies(data);
    if (data.length > 0 && data[0]) {
      setRlsEnabled(Boolean(data[0].rls_enabled));
    }
    setLoading(false);
  }, [projectSlug, tableName, schema]);

  React.useEffect(() => {
    if (isOpen) {
      fetchPolicies();
    }
  }, [isOpen, fetchPolicies]);

  async function toggleRls() {
    setToggling(true);
    setError(null);
    const res = await api.post(
      `/api/v1/projects/${projectSlug}/database/tables/${tableName}/rls?schema=${schema}`,
      { enabled: !rlsEnabled }
    );
    if (!res.success) {
      setError(res.error?.message ?? 'Failed to toggle RLS');
      setToggling(false);
      return;
    }
    setRlsEnabled((v) => !v);
    await fetchPolicies();
    setToggling(false);
  }

  async function applyTemplate(
    template: 'tenant_isolation' | 'tenant_rbac' | 'public_read_tenant_write' | 'global_read'
  ) {
    setApplyingTemplate(template);
    setError(null);
    const res = await api.post(
      `/api/v1/projects/${projectSlug}/database/tables/${tableName}/rls/template?schema=${schema}`,
      {
        template,
        tenantColumn: tenantColumn.trim() || 'tenant_id',
        resourceName: tableName,
      }
    );
    if (!res.success) {
      setError(res.error?.message ?? 'Failed to apply multi-tenant RLS template');
      setApplyingTemplate(null);
      return;
    }
    setRlsEnabled(true);
    await fetchPolicies();
    setApplyingTemplate(null);
  }

  async function handleCreate() {
    if (!pName.trim()) {
      setError('Policy name is required');
      return;
    }
    setCreating(true);
    setError(null);
    const res = await api.post(
      `/api/v1/projects/${projectSlug}/database/tables/${tableName}/policies?schema=${schema}`,
      {
        name: pName.trim(),
        command: pCmd,
        using: pUsing.trim() || undefined,
        withCheck: pWithCheck.trim() || undefined,
      }
    );
    if (!res.success) {
      setError(res.error?.message ?? 'Failed to create policy');
      setCreating(false);
      return;
    }
    setPName('');
    setPUsing('');
    setPWithCheck('');
    setShowCreate(false);
    await fetchPolicies();
    setCreating(false);
  }

  async function handleDrop(name: string) {
    if (!confirm(`Are you sure you want to drop policy "${name}"?`)) return;
    const res = await api.delete(
      `/api/v1/projects/${projectSlug}/database/tables/${tableName}/policies/${encodeURIComponent(name)}?schema=${schema}`
    );
    if (!res.success) {
      setError(res.error?.message ?? 'Failed to drop policy');
      return;
    }
    await fetchPolicies();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-background shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
              <Lock className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Row Level Security (RLS)</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Table: <span className="font-mono text-emerald-500 font-medium">{tableName}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* RLS Status Bar */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-border bg-muted/20">
          <div className="flex items-center gap-3">
            {rlsEnabled ? (
              <Shield className="h-4 w-4 text-emerald-500 shrink-0" />
            ) : (
              <ShieldOff className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <div>
              <p className="text-xs font-medium text-foreground">
                Row Level Security is{' '}
                <span className={rlsEnabled ? 'text-emerald-500 font-bold' : 'text-amber-500 font-bold'}>
                  {rlsEnabled ? 'ENABLED' : 'DISABLED'}
                </span>
              </p>
              <p className="text-[11px] text-muted-foreground">
                {rlsEnabled
                  ? 'Queries will only return rows that satisfy at least one permissive policy.'
                  : 'All queries bypass row-level security checks.'}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleRls}
            disabled={toggling}
            className="text-xs h-7"
          >
            {toggling ? 'Updating...' : rlsEnabled ? 'Disable RLS' : 'Enable RLS'}
          </Button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
          {error && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* One-Click Multi-Tenant RLS Templates */}
          <div className="rounded-lg border border-border p-3.5 bg-muted/15 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold">Universal Multi-Tenant RLS Templates</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">Tenant col:</span>
                <Input
                  value={tenantColumn}
                  onChange={(e) => setTenantColumn(e.target.value)}
                  className="h-6 w-28 text-[11px] font-mono px-2"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  { id: 'tenant_isolation', label: 'Strict Tenant Isolation' },
                  { id: 'tenant_rbac', label: 'Tenant + RBAC Perms' },
                  { id: 'public_read_tenant_write', label: 'Public Read / Tenant Write' },
                  { id: 'global_read', label: 'Authenticated Global Read' },
                ] as const
              ).map((tpl) => (
                <Button
                  key={tpl.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={applyingTemplate !== null}
                  onClick={() => applyTemplate(tpl.id)}
                  className="h-auto py-1.5 px-2.5 text-[11px] justify-start text-left font-normal"
                >
                  {applyingTemplate === tpl.id ? 'Applying...' : tpl.label}
                </Button>
              ))}
            </div>
          </div>

          {/* New Policy Form (collapsible) */}
          {showCreate && (
            <div className="border border-border/80 rounded-lg p-4 space-y-3 bg-muted/15">
              <div className="flex items-center justify-between pb-1 border-b border-border/40">
                <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  New Policy
                </span>
                <button
                  onClick={() => setShowCreate(false)}
                  className="text-muted-foreground hover:text-foreground text-xs"
                >
                  Cancel
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Policy Name</label>
                  <Input
                    value={pName}
                    onChange={(e) => setPName(e.target.value)}
                    placeholder="e.g. enable_read_access"
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Command</label>
                  <select
                    value={pCmd}
                    onChange={(e) => setPCmd(e.target.value as any)}
                    className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    {['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE'].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  USING Expression <span className="font-normal text-muted-foreground/70">(filter for existing rows)</span>
                </label>
                <Input
                  value={pUsing}
                  onChange={(e) => setPUsing(e.target.value)}
                  placeholder="e.g. true OR auth.uid() = user_id"
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  WITH CHECK Expression <span className="font-normal text-muted-foreground/70">(for INSERT / UPDATE)</span>
                </label>
                <Input
                  value={pWithCheck}
                  onChange={(e) => setPWithCheck(e.target.value)}
                  placeholder="e.g. auth.uid() = user_id"
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={creating || !pName.trim()}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs h-7"
                >
                  {creating ? 'Creating...' : 'Create Policy'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCreate(false)}
                  className="text-xs h-7"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Policy List */}
          {loading ? (
            <div className="text-center py-8 text-xs text-muted-foreground">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent mr-2" />
              Loading policies...
            </div>
          ) : policies.length === 0 ? (
            <div className="text-center py-10 rounded-lg border border-dashed border-border p-6">
              <Lock className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs font-medium text-muted-foreground">No policies defined for this table</p>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                Click &quot;New Policy&quot; below to add access control rules.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {policies.map((p) => (
                <div
                  key={p.name}
                  className="flex items-start justify-between rounded-lg border border-border bg-card p-3 shadow-xs"
                >
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground font-mono">{p.name}</span>
                      <span className="rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.2 text-[10px] font-semibold uppercase">
                        {p.command}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground uppercase">
                        {p.permissive}
                      </span>
                    </div>
                    {p.using_expr && (
                      <p className="text-[11px] text-muted-foreground font-mono truncate">
                        <span className="text-foreground/70 font-semibold">USING:</span> {p.using_expr}
                      </p>
                    )}
                    {p.with_check_expr && (
                      <p className="text-[11px] text-muted-foreground font-mono truncate">
                        <span className="text-foreground/70 font-semibold">WITH CHECK:</span> {p.with_check_expr}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDrop(p.name)}
                    className="ml-3 shrink-0 text-muted-foreground hover:text-destructive p-1.5 rounded hover:bg-destructive/10 transition-colors"
                    title="Drop policy"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-6 py-4 bg-muted/20">
          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">
            Close
          </Button>
          {!showCreate && (
            <Button
              size="sm"
              onClick={() => setShowCreate(true)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              New Policy
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
