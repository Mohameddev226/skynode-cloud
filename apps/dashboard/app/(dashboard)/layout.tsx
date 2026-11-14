'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { TopNav } from '@/components/layout/top-nav';
import { CreateProjectModal } from '@/components/projects/create-project-modal';
import api from '@/lib/api';

interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  avatarUrl?: string;
}

interface Project {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'paused' | 'archived';
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [createOpen, setCreateOpen] = React.useState(false);

  React.useEffect(() => {
    // Fetch current user
    api.get<AuthUser>('/api/v1/auth/me').then((res) => {
      if (res.success && res.data) setUser(res.data);
      else router.replace('/login');
    });

    // Fetch projects for sidebar
    api.get<Project[]>('/api/v1/projects').then((res) => {
      if (res.success && res.data) setProjects(res.data);
    });
  }, [router]);

  async function handleLogout() {
    await api.post('/api/v1/auth/logout', {});
    router.replace('/login');
  }

  function handleProjectCreated(project: { name: string; slug: string }) {
    router.push(`/projects/${project.slug}`);
    // Refresh projects list
    api.get<Project[]>('/api/v1/projects').then((res) => {
      if (res.success && res.data) setProjects(res.data);
    });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        projects={projects}
        onCreateProject={() => setCreateOpen(true)}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <TopNav
          user={user ? { name: user.fullName, email: user.email, avatarUrl: user.avatarUrl } : undefined}
          onLogout={handleLogout}
        />

        <main className="flex-1 overflow-y-auto">
          <div className="container max-w-6xl mx-auto px-6 py-6">
            {children}
          </div>
        </main>
      </div>

      <CreateProjectModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={handleProjectCreated}
      />
    </div>
  );
}
