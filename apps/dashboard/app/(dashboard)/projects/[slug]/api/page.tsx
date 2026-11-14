'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { Zap, Key, Plus, Copy, Eye, EyeOff, RefreshCw, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { LoadingSkeleton } from '@/components/shared/loading-skeleton';
import { ErrorState } from '@/components/shared/error-state';
import api from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  createdAt: string;
  lastUsedAt?: string;
}

interface ProjectApiConfig {
  baseUrl: string;
  anonKey: string;
  serviceKey: string;
}

export default function ApiPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [apiKeys, setApiKeys] = React.useState<ApiKey[]>([]);
  const [config, setConfig] = React.useState<ProjectApiConfig | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showServiceKey, setShowServiceKey] = React.useState(false);
  const [copied, setCopied] = React.useState<string | null>(null);

  async function fetchData() {
    setLoading(true);
    setError(null);
    const [keysRes, configRes] = await Promise.all([
      api.get<ApiKey[]>(`/api/v1/projects/${slug}/api/keys`),
      api.get<ProjectApiConfig>(`/api/v1/projects/${slug}/api/config`),
    ]);
    if (!keysRes.success) setError(keysRes.error?.message ?? 'Failed to load API config');
    else {
      setApiKeys(keysRes.data ?? []);
      setConfig(configRes.data ?? null);
    }
    setLoading(false);
  }

  React.useEffect(() => { fetchData(); }, [slug]);

  async function copyToClipboard(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  if (loading) return (
    <div className="space-y-6">
      <LoadingSkeleton className="h-8 w-32" />
      <LoadingSkeleton className="h-48 rounded-lg" />
      <LoadingSkeleton className="h-64 rounded-lg" />
    </div>
  );
  if (error) return <ErrorState message={error} onRetry={fetchData} />;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API</h1>
          <p className="text-sm text-muted-foreground">REST API endpoints and credentials</p>
        </div>
        <Button variant="outline" size="icon" onClick={fetchData} title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Tabs defaultValue="credentials">
        <TabsList>
          <TabsTrigger value="credentials">Credentials</TabsTrigger>
          <TabsTrigger value="keys">API Keys</TabsTrigger>
          <TabsTrigger value="explorer">Explorer</TabsTrigger>
        </TabsList>

        <TabsContent value="credentials" className="space-y-4">
          {config ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Project credentials</CardTitle>
                <CardDescription>Use these to connect your application to this project.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Base URL */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Project URL</label>
                  <div className="flex items-center gap-2">
                    <Input value={config.baseUrl} readOnly className="font-mono text-xs" />
                    <Button variant="outline" size="icon" className="shrink-0" onClick={() => copyToClipboard(config.baseUrl, 'url')}>
                      <Copy className={`h-4 w-4 ${copied === 'url' ? 'text-green-500' : ''}`} />
                    </Button>
                    <Button variant="outline" size="icon" className="shrink-0" asChild>
                      <a href={config.baseUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>

                <Separator />

                {/* Anon Key */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Anon / Public key</label>
                  <p className="text-xs text-muted-foreground">Safe to use in browser. Respects row-level security policies.</p>
                  <div className="flex items-center gap-2">
                    <Input value={config.anonKey} readOnly className="font-mono text-xs" />
                    <Button variant="outline" size="icon" className="shrink-0" onClick={() => copyToClipboard(config.anonKey, 'anon')}>
                      <Copy className={`h-4 w-4 ${copied === 'anon' ? 'text-green-500' : ''}`} />
                    </Button>
                  </div>
                </div>

                <Separator />

                {/* Service Key */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Service role key</label>
                  <p className="text-xs text-destructive">Never expose this key publicly. It bypasses all security policies.</p>
                  <div className="flex items-center gap-2">
                    <Input
                      value={showServiceKey ? config.serviceKey : '•'.repeat(60)}
                      readOnly
                      className="font-mono text-xs"
                    />
                    <Button variant="outline" size="icon" className="shrink-0" onClick={() => setShowServiceKey(!showServiceKey)}>
                      {showServiceKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button variant="outline" size="icon" className="shrink-0" onClick={() => copyToClipboard(config.serviceKey, 'service')}>
                      <Copy className={`h-4 w-4 ${copied === 'service' ? 'text-green-500' : ''}`} />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                API credentials not yet provisioned for this project.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="keys" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Create scoped API keys for specific use cases.</p>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New API key
            </Button>
          </div>
          {apiKeys.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center space-y-2">
                <Key className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                <p className="text-sm text-muted-foreground">No API keys yet.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {apiKeys.map((key) => (
                    <div key={key.id} className="flex items-center justify-between p-4">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">{key.name}</p>
                        <p className="text-xs font-mono text-muted-foreground">{key.keyPrefix}...</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex gap-1 flex-wrap justify-end">
                          {key.permissions.map((p) => (
                            <Badge key={p} variant="secondary" className="text-xs">{p}</Badge>
                          ))}
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {key.lastUsedAt ? formatRelativeTime(key.lastUsedAt) : 'Never used'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="explorer">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">API Explorer</CardTitle>
              <CardDescription>Browse and test your auto-generated REST endpoints.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-border bg-muted/40 px-4 py-6 text-center space-y-2">
                <Zap className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                <p className="text-sm text-muted-foreground">
                  API Explorer is available after creating database tables and running the provisioning engine.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
