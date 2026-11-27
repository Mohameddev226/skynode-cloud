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
  Ban,
  Trash2,
  CheckCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { EmptyState } from '@/components/shared/empty-state';
import api from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';

interface AppUser {
  id: string;
  email: string;
  full_name: string | null;
  email_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  last_sign_in_at: string | null;
  is_banned: boolean;
}

interface AuthStats {
  totalUsers: number;
  confirmedUsers: number;
  dailyActiveUsers: number;
}

interface UserListResponse {
  users: AppUser[];
  total: number;
}

export default function AuthPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [users, setUsers] = React.useState<AppUser[]>([]);
  const [stats, setStats] = React.useState<AuthStats | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');

  // Create User Modal state
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createEmail, setCreateEmail] = React.useState('');
  const [createPassword, setCreatePassword] = React.useState('');
  const [createFullName, setCreateFullName] = React.useState('');
  const [createLoading, setCreateLoading] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  // Action states
  const [actionLoadingId, setActionLoadingId] = React.useState<string | null>(null);

  async function fetchData() {
    setLoading(true);
    setError(null);
    const usersRes = await api.get<UserListResponse>(`/api/v1/projects/${slug}/auth/admin/users`);

    if (!usersRes.success) {
      setError(usersRes.error?.message ?? 'Failed to load users');
      setLoading(false);
      return;
    }

    setUsers(usersRes.data?.users ?? []);
    const statsRes = await api.get<AuthStats>(`/api/v1/projects/${slug}/auth/admin/stats`);
    setStats(statsRes.success ? (statsRes.data ?? null) : null);
    setLoading(false);
  }

  React.useEffect(() => {
    fetchData();
  }, [slug]);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    if (!createEmail || !createPassword) return;

    setCreateLoading(true);
    setCreateError(null);

    const res = await api.post(`/api/v1/projects/${slug}/auth/admin/users`, {
      email: createEmail,
      password: createPassword,
      full_name: createFullName || undefined,
    });

    if (res.success) {
      setCreateOpen(false);
      setCreateEmail('');
      setCreatePassword('');
      setCreateFullName('');
      await fetchData();
    } else {
      setCreateError(res.error?.message ?? 'Failed to create user');
    }
    setCreateLoading(false);
  }

  async function handleToggleBan(user: AppUser) {
    setActionLoadingId(user.id);
    const action = user.is_banned ? 'unban' : 'ban';
    const res = await api.patch(`/api/v1/projects/${slug}/auth/admin/users/${user.id}/${action}`, {});
    if (res.success) {
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, is_banned: !user.is_banned } : u))
      );
    }
    setActionLoadingId(null);
  }

  async function handleDeleteUser(userId: string) {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) return;
    setActionLoadingId(userId);
    const res = await api.delete(`/api/v1/projects/${slug}/auth/admin/users/${userId}`);
    if (res.success) {
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      if (stats) {
        setStats({ ...stats, totalUsers: Math.max(0, stats.totalUsers - 1) });
      }
    }
    setActionLoadingId(null);
  }

  const filtered = users.filter((u) =>
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    (u.full_name && u.full_name.toLowerCase().includes(search.toLowerCase()))
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton className="h-8 w-32" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <LoadingSkeleton key={i} className="h-24 rounded-lg" />
          ))}
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
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add user
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
              placeholder="Search by email or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No users found"
              description={
                search
                  ? 'No users match your search.'
                  : 'No application users yet. Add your first user to get started.'
              }
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {/* Table header */}
                  <div className="grid grid-cols-[1.5fr_1fr_auto_auto_auto_auto] gap-4 px-4 py-2.5 text-xs font-medium text-muted-foreground bg-muted/20">
                    <span>Email</span>
                    <span>Full name</span>
                    <span>Status</span>
                    <span>Last sign in</span>
                    <span>Joined</span>
                    <span className="text-right">Actions</span>
                  </div>
                  {filtered.map((user) => (
                    <div
                      key={user.id}
                      className="grid grid-cols-[1.5fr_1fr_auto_auto_auto_auto] gap-4 items-center px-4 py-3 hover:bg-muted/40 transition-colors"
                    >
                      <span className="text-sm font-medium truncate">{user.email}</span>
                      <span className="text-sm text-muted-foreground truncate">
                        {user.full_name || '—'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {user.is_banned ? (
                          <Badge variant="destructive" className="text-xs">Banned</Badge>
                        ) : user.email_confirmed_at ? (
                          <Badge variant="default" className="text-xs">Confirmed</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Unconfirmed</Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {user.last_sign_in_at ? formatRelativeTime(user.last_sign_in_at) : 'Never'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(user.created_at)}
                      </span>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={actionLoadingId === user.id}
                          onClick={() => handleToggleBan(user)}
                          title={user.is_banned ? 'Unban user' : 'Ban user'}
                          className="h-8 px-2 text-xs"
                        >
                          {user.is_banned ? (
                            <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <Ban className="h-3.5 w-3.5 text-amber-500" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={actionLoadingId === user.id}
                          onClick={() => handleDeleteUser(user.id)}
                          title="Delete user"
                          className="h-8 px-2 text-xs text-destructive hover:text-destructive"
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
                description="Define who can access what data. Policies can be managed directly via SQL Editor or Database Studio."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Auth settings</CardTitle>
              <CardDescription>JWT, session duration, and security settings for this project.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between py-2 border-b border-border">
                <div>
                  <p className="text-sm font-medium">Access Token Expiry</p>
                  <p className="text-xs text-muted-foreground">Default duration for JWT access tokens</p>
                </div>
                <Badge variant="outline">3600s (1 hour)</Badge>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-border">
                <div>
                  <p className="text-sm font-medium">Refresh Token Expiry</p>
                  <p className="text-xs text-muted-foreground">Session refresh token lifetime</p>
                </div>
                <Badge variant="outline">7 days</Badge>
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium">Password Hash Algorithm</p>
                  <p className="text-xs text-muted-foreground">Per-tenant credential hashing</p>
                </div>
                <Badge variant="outline">Argon2id</Badge>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Application User</DialogTitle>
            <DialogDescription>
              Create a new user in this project&apos;s authentication table.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateUser} className="space-y-4 py-2">
            {createError && (
              <div className="p-3 text-xs bg-destructive/10 text-destructive rounded-md">
                {createError}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Email address</label>
              <Input
                type="email"
                placeholder="user@example.com"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Password</label>
              <Input
                type="password"
                placeholder="Minimum 8 characters"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                minLength={8}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Full Name (optional)</label>
              <Input
                type="text"
                placeholder="Jane Doe"
                value={createFullName}
                onChange={(e) => setCreateFullName(e.target.value)}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={createLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createLoading}>
                {createLoading ? 'Creating...' : 'Create user'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
