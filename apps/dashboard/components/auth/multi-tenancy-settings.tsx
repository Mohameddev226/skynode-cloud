'use client';

import * as React from 'react';
import { Building2, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import api from '@/lib/api';

interface MultiTenancySettings {
  allow_self_serve_tenants: boolean;
  require_tenant_for_api: boolean;
}

export function MultiTenancySettingsCard({ slug }: { slug: string }) {
  const [settings, setSettings] = React.useState<MultiTenancySettings | null>(null);
  const [savingKey, setSavingKey] = React.useState<string | null>(null);
  const [savedNotice, setSavedNotice] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    api.get<MultiTenancySettings>(`/api/v1/projects/${slug}/tenants/settings`).then((res) => {
      if (!active) return;
      if (res.success && res.data) {
        setSettings(res.data);
      }
    });
    return () => {
      active = false;
    };
  }, [slug]);

  async function toggleSetting(key: keyof MultiTenancySettings, value: boolean) {
    if (!settings) return;
    setSavingKey(key);
    setError(null);
    setSavedNotice(false);

    const res = await api.patch<MultiTenancySettings>(`/api/v1/projects/${slug}/tenants/settings`, {
      [key]: value,
    });

    if (!res.success || !res.data) {
      setError(res.error?.message ?? 'Failed to update multi-tenancy settings');
    } else {
      setSettings(res.data);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2000);
    }
    setSavingKey(null);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Multi-Tenancy Enforcement
            </CardTitle>
            <CardDescription>
              Control tenant provisioning and API gateway isolation behavior for this project.
            </CardDescription>
          </div>
          {savedNotice && (
            <span className="flex items-center gap-1 text-xs text-emerald-500">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="p-2.5 text-xs bg-destructive/10 text-destructive rounded-md">{error}</div>
        )}

        <div className="flex items-center justify-between py-2 border-b border-border gap-4">
          <div>
            <p className="text-sm font-medium">Allow Self-Serve Tenant Creation</p>
            <p className="text-xs text-muted-foreground">
              When enabled, authenticated app users can create their own organizations/workspaces. Disable to restrict creation to service_role.
            </p>
          </div>
          <Switch
            checked={settings?.allow_self_serve_tenants ?? true}
            disabled={!settings || savingKey !== null}
            onCheckedChange={(checked) => toggleSetting('allow_self_serve_tenants', checked)}
          />
        </div>

        <div className="flex items-center justify-between py-2 gap-4">
          <div>
            <p className="text-sm font-medium">Require Active Tenant Header / Claim on REST API</p>
            <p className="text-xs text-muted-foreground">
              Reject authenticated REST API requests unless the JWT or verified <code className="font-mono">X-Tenant-ID</code> resolves to an active tenant membership.
            </p>
          </div>
          <Switch
            checked={settings?.require_tenant_for_api ?? false}
            disabled={!settings || savingKey !== null}
            onCheckedChange={(checked) => toggleSetting('require_tenant_for_api', checked)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
