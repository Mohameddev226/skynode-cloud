'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell,
  ChevronRight,
  LogOut,
  Settings,
  User,
  Terminal,
  Search,
  MessageSquare,
  HelpCircle,
  ChevronsUpDown,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ConnectModal } from '@/components/database/connect-modal';

interface BreadcrumbSegment {
  label: string;
  href?: string;
}

interface Project {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'paused' | 'archived';
}

interface TopNavProps {
  user?: {
    name: string;
    email: string;
    avatarUrl?: string;
  };
  projects?: Project[];
  currentProject?: Project | null;
  breadcrumbs?: BreadcrumbSegment[];
  notificationCount?: number;
  onLogout?: () => void;
}

function buildBreadcrumbs(pathname: string | null): BreadcrumbSegment[] {
  if (!pathname) return [];
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: BreadcrumbSegment[] = [];

  if (segments[0] === 'projects') {
    crumbs.push({ label: 'Projects', href: '/projects' });
    if (segments[1]) {
      crumbs.push({ label: segments[1], href: `/projects/${segments[1]}` });
      if (segments[2]) {
        const sectionLabels: Record<string, string> = {
          database: 'Database',
          auth: 'Auth',
          storage: 'Storage',
          api: 'API',
          settings: 'Settings',
          sql: 'SQL Editor',
        };
        crumbs.push({
          label: sectionLabels[segments[2]] ?? segments[2],
          href: segments[3] ? `/projects/${segments[1]}/${segments[2]}` : undefined,
        });
        if (segments[3]) {
          const subLabels: Record<string, string> = { sql: 'SQL Editor', tables: 'Tables' };
          crumbs.push({ label: subLabels[segments[3]] ?? segments[3] });
        }
      }
    }
  }

  return crumbs;
}

export function TopNav({
  user,
  projects = [],
  currentProject,
  breadcrumbs,
  notificationCount = 0,
  onLogout,
}: TopNavProps) {
  const pathname = usePathname();
  const [connectOpen, setConnectOpen] = React.useState(false);
  const crumbs = breadcrumbs ?? buildBreadcrumbs(pathname);

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '?';

  return (
    <TooltipProvider delayDuration={0}>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        {/* Left: Supabase-Style Top Bar Segment Breadcrumbs */}
        <div className="flex items-center gap-2 text-xs min-w-0">
          {/* Lightning Icon */}
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500">
            <Zap className="h-3.5 w-3.5 fill-emerald-500" />
          </div>

          <span className="text-muted-foreground/40 font-mono">/</span>

          {/* Org Selector */}
          <div className="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-muted/60 cursor-pointer font-medium text-foreground">
            <span className="truncate max-w-[120px]">{user?.name ?? 'My Org'}</span>
            <span className="text-[10px] px-1 py-0.2 rounded bg-muted font-bold text-muted-foreground uppercase">
              FREE
            </span>
          </div>

          <span className="text-muted-foreground/40 font-mono">/</span>

          {/* Project Selector Dropdown */}
          {currentProject ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-muted/60 transition-colors font-medium text-foreground">
                  <span className="truncate max-w-[140px]">{currentProject.name}</span>
                  <ChevronsUpDown className="h-3 w-3 text-muted-foreground/60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuLabel className="text-xs">Switch Project</DropdownMenuLabel>
                {projects.map((p) => (
                  <DropdownMenuItem key={p.id} asChild>
                    <Link href={`/projects/${p.slug}`} className="cursor-pointer text-xs">
                      <div className="flex h-4 w-4 items-center justify-center rounded bg-emerald-500/10 text-emerald-500 text-[10px] font-bold mr-2">
                        {(p.name[0] ?? '?').toUpperCase()}
                      </div>
                      <span className="truncate">{p.name}</span>
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link href="/projects" className="text-muted-foreground hover:text-foreground">
              Projects
            </Link>
          )}

          {currentProject && (
            <>
              <span className="text-muted-foreground/40 font-mono">/</span>

              {/* Branch / Production Tag */}
              <div className="flex items-center gap-1.5 px-1.5 py-0.5">
                <span className="font-mono text-[11px] text-muted-foreground">main</span>
                <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.2 rounded font-mono text-amber-500 bg-amber-500/10 border border-amber-500/20">
                  PRODUCTION
                </span>
              </div>

              {/* Connect Button (Supabase Style) */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConnectOpen(true)}
                className="h-6 gap-1 px-2.5 text-[11px] font-semibold border-border/80 hover:border-emerald-500/50 hover:bg-emerald-500/5 hover:text-emerald-500 ml-1 transition-colors"
              >
                <Terminal className="h-3 w-3" />
                Connect
              </Button>
            </>
          )}
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-2">
          {/* Feedback */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-foreground hidden sm:flex gap-1.5"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Feedback
          </Button>

          {/* Search Bar pill */}
          <div className="flex items-center gap-2 rounded-md border border-border bg-background/50 px-2.5 py-1 text-xs text-muted-foreground hidden md:flex cursor-pointer hover:border-muted-foreground/40">
            <Search className="h-3 w-3" />
            <span>Search...</span>
            <kbd className="rounded bg-muted px-1 py-0.2 text-[10px] font-mono text-muted-foreground">
              Ctrl K
            </kbd>
          </div>

          {/* Help / Docs */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                <HelpCircle className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Help & Docs</TooltipContent>
          </Tooltip>

          {/* Notifications */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="relative h-7 w-7 text-muted-foreground">
                <Bell className="h-3.5 w-3.5" />
                {notificationCount > 0 && (
                  <span className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-medium text-white">
                    {notificationCount > 9 ? '9+' : notificationCount}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Notifications</TooltipContent>
          </Tooltip>

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-full p-0.5 hover:ring-2 hover:ring-border transition-all focus-visible:outline-none">
                <Avatar className="h-6 w-6">
                  <AvatarImage src={user?.avatarUrl} alt={user?.name} />
                  <AvatarFallback className="text-[10px] bg-muted font-bold text-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{user?.name ?? 'User'}</p>
                  <p className="text-xs leading-none text-muted-foreground">{user?.email ?? ''}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="cursor-pointer gap-2 text-xs">
                <Link href="/settings/account">
                  <User className="h-3.5 w-3.5" />
                  Account settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="cursor-pointer gap-2 text-xs">
                <Link href="/settings">
                  <Settings className="h-3.5 w-3.5" />
                  Platform settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onLogout}
                className="cursor-pointer gap-2 text-xs text-destructive focus:text-destructive"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {currentProject && (
        <ConnectModal
          open={connectOpen}
          onOpenChange={setConnectOpen}
          projectSlug={currentProject.slug}
          projectName={currentProject.name}
        />
      )}
    </TooltipProvider>
  );
}
