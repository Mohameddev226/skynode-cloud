'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Database,
  FolderOpen,
  Key,
  LayoutDashboard,
  Settings,
  Shield,
  HardDrive,
  Activity,
  Archive,
  Code,
  ChevronLeft,
  LogOut,
  Moon,
  Sun,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { useTheme } from '@/providers/theme-provider';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
}

const mainNavItems: NavItem[] = [
  { label: 'Dashboard', href: '/projects', icon: LayoutDashboard },
];

const projectNavItems: NavItem[] = [
  { label: 'Table Editor', href: '/database/tables', icon: Database },
  { label: 'SQL Editor', href: '/database/sql', icon: Code },
  { label: 'Authentication', href: '/auth', icon: Shield },
  { label: 'Storage', href: '/storage', icon: FolderOpen },
  { label: 'API', href: '/api', icon: Key },
  { label: 'Realtime', href: '/realtime', icon: Activity },
  { label: 'Backups', href: '/backups', icon: Archive },
  { label: 'Monitoring', href: '/monitoring', icon: HardDrive },
  { label: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { theme, setTheme, resolvedTheme } = useTheme();

  return (
    <aside
      className={cn(
        'flex h-screen flex-col border-r border-border bg-card transition-all duration-200',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        {!collapsed && (
          <Link href="/projects" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
              <span className="text-xs font-bold text-primary-foreground">SN</span>
            </div>
            <span className="text-sm font-semibold text-foreground">SkyNode Cloud</span>
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronLeft
            className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')}
          />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {/* Main nav */}
        {mainNavItems.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
        ))}

        {/* Divider */}
        <div className="my-3 h-px bg-border" />

        {/* Project nav */}
        {!collapsed && (
          <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Project
          </p>
        )}
        {projectNavItems.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-2">
        <button
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground',
            collapsed && 'justify-center px-0',
          )}
        >
          {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {!collapsed && (resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode')}
        </button>

        <button
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground',
            collapsed && 'justify-center px-0',
          )}
        >
          <User className="h-4 w-4" />
          {!collapsed && 'Account'}
        </button>

        <button
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10',
            collapsed && 'justify-center px-0',
          )}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && 'Sign out'}
        </button>
      </div>
    </aside>
  );
}

function NavLink({
  item,
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
        isActive
          ? 'bg-primary/10 text-primary font-medium'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        collapsed && 'justify-center px-0',
      )}
      title={collapsed ? item.label : undefined}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span>{item.label}</span>}
      {!collapsed && item.badge && (
        <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {item.badge}
        </span>
      )}
    </Link>
  );
}
