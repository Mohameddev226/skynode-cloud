'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import {
  Users,
  Plus,
  Search,
  Shield,
  Key,
  Settings,
  UserCheck,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingSkeleton } from '@/components/shared/loading-skeleton';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import api from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';

interface AppUser {
  id: string;
  email: string;
  createdAt: string;
  lastSignIn?: string;
  confirmed: boolean;
  banned: boolean;
}

interface AuthStats {
  totalUsers: number;
  confirmedUsers: number;
  dailyActiveUsers: number;
}

export default function AuthPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [users, setUsers] = React.useState<AppUser[]>([]);
  const [stats, setStats] = React.useState<AuthStats | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');

  async function fetchData() {
    setLoading(true);
    setError(null);
    const [usersRes, statsRes] = await Promise.all([
      api.get<AppUser[]>(`/api/v1/projects/${slug}/auth/users`),
      api.get<AuthStats>(`/api/v1/projects/${slug}/auth/stats`),
    ]);
    if (!usersRes.success) setError(usersRes.error?.message ?? 'Failed to load users');
    else {
      setUsers(usersRes.data ?? []);
      setStats(statsRes.data ?? null);
    }
    setLoading(false);
  }

  React.useEffect(() => { fetchData(); }, [slug]);

  const filtered = users.filter((u) =>
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton className="h-8 w-32" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[...Array(3)].map((_, i) => <LoadingSkeleton key={i} className="h-24 rounded-lg" />)}
        </div>
        <LoadingSkeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={fetchData} />;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Authentication</h1>
          <p className="text-sm text-muted-foreground">Manage application users and auth configuration</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={fetchData} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Invite user
          </Button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-1">
              <CardDescription className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> Total users
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{stats.totalUsers.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardDescription className="flex items-center gap-1.5">
                <UserCheck className="h-3.5 w-3.5" /> Confirmed
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{stats.confirmedUsers.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardDescription className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5" /> Daily active
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{stats.dailyActiveUsers.toLocaleString()}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="providers">Providers</TabsTrigger>
          <TabsTrigger value="policies">Policies</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          {/* Search */}
          <div className="mb-4 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No users found"
              description={search ? 'No users match your search.' : 'No application users yet. Users will appear here once they sign up.'}
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {/* Table header */}
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2 text-xs font-medium text-muted-foreground">
                    <span>Email</span>
                    <span>Status</span>
                    <span>Last sign in</span>
                    <span>Joined</span>
                  </div>
                  {filtered.map((user) => (
                    <div
                      key={user.id}
                      className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-4 py-3 hover:bg-muted/40 transition-colors"
                    >
                      <span className="text-sm font-medium truncate">{user.email}</span>
                      <div className="flex items-center gap-1.5">
                        {user.banned ? (
                          <Badge variant="destructive" className="text-xs">Banned</Badge>
                        ) : user.confirmed ? (
                          <Badge variant="default" className="text-xs">Confirmed</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Unconfirmed</Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {user.lastSignIn ? formatRelativeTime(user.lastSignIn) : 'Never'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(user.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="providers">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Authentication providers</CardTitle>
              <CardDescription>Configure how users can sign in to your application.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { name: 'Email / Password', icon: Key, enabled: true },
                { name: 'Magic Link', icon: Key, enabled: false },
                { name: 'Google OAuth', icon: Shield, enabled: false },
                { name: 'GitHub OAuth', icon: Shield, enabled: false },
              ].map((provider) => (
                <div key={provider.name} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-2">
                    <provider.icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{provider.name}</span>
                  </div>
                  <Badge variant={provider.enabled ? 'default' : 'secondary'}>
                    {provider.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="policies">
          <Card>
            <CardContent className="py-6">
              <EmptyState
                icon={Shield}
                title="Row-level security policies"
                description="Define who can access what data. Policies will be manageable here once configured in the database."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Auth settings</CardTitle>
              <CardDescription>Configure JWT, session duration, and security settings.</CardDescription>
            </CardHeader>
            <CardContent className="py-4">
              <EmptyState
                icon={Settings}
                title="Coming in Phase 3"
                description="Auth settings will be configurable once the backend auth service is implemented."
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
