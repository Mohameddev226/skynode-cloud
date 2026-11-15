'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Cloud,
  ChevronLeft,
  ChevronRight,
  Database,
  Shield,
  HardDrive,
  Zap,
  Code2,
  Settings,
  LayoutDashboard,
  Plus,
  ChevronsUpDown,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTheme } from '@/providers/theme-provider';

/* ─── Types ─────────────────────────────────────── */
interface Project {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'paused' | 'archived';
}

interface SidebarProps {
  projects?: Project[];
  currentProject?: Project | null;
  onCreateProject?: () => void;
}

/* ─── Nav items for a project ───────────────────── */
const projectNavItems = [
  { label: 'Overview',     icon: LayoutDashboard, href: '' },
  { label: 'Database',     icon: Database,         href: '/database' },
  { label: 'Auth',         icon: Shield,           href: '/auth' },
  { label: 'Storage',      icon: HardDrive,        href: '/storage' },
  { label: 'API',          icon: Zap,              href: '/api' },
  { label: 'SQL Editor',   icon: Code2,            href: '/database/sql' },
  { label: 'Settings',     icon: Settings,         href: '/settings' },
];

/* ─── Sidebar ────────────────────────────────────── */
export function Sidebar({ projects = [], currentProject, onCreateProject }: SidebarProps) {
  const safeProjects: Project[] = Array.isArray(projects)
    ? projects
    : Array.isArray((projects as any)?.data)
      ? (projects as any).data
      : [];
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const { theme, setTheme } = useTheme();

  const projectBase = currentProject ? `/projects/${currentProject.slug}` : null;

  function isActive(href: string) {
    if (!projectBase) return false;
    const full = projectBase + href;
    if (href === '') return pathname === projectBase;
    return pathname.startsWith(full);
  }

  const themeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const ThemeIcon = themeIcon;

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'relative flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 ease-in-out',
          collapsed ? 'w-14' : 'w-60'
        )}
      >
        {/* Logo */}
        <div className={cn('flex h-14 items-center border-b border-sidebar-border px-3', collapsed && 'justify-center')}>
          <Link href="/projects" className="flex items-center gap-2 min-w-0">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-glow">
              <Cloud className="h-4 w-4" />
            </div>
            {!collapsed && (
              <span className="truncate text-sm font-semibold text-sidebar-foreground">
                SkyNode Cloud
              </span>
            )}
          </Link>
        </div>

        {/* Project selector */}
        <div className={cn('border-b border-sidebar-border p-2', collapsed && 'flex justify-center')}>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onCreateProject}
                  className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-sidebar-accent text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">New project</TooltipContent>
            </Tooltip>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent transition-colors group">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/10 text-primary text-[10px] font-bold">
                    {currentProject ? (currentProject.name[0] ?? '?').toUpperCase() : '?'}
                  </div>
                  <span className="flex-1 truncate text-left text-sidebar-foreground">
                    {currentProject?.name ?? 'Select project'}
                  </span>
                  <ChevronsUpDown className="h-3.5 w-3.5 text-sidebar-foreground/40 group-hover:text-sidebar-foreground/60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="start">
                <DropdownMenuLabel>Projects</DropdownMenuLabel>
                {safeProjects.map((p: Project) => (
                  <DropdownMenuItem key={p.id} asChild>
                    <Link href={`/projects/${p.slug}`} className="cursor-pointer">
                      <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary text-[10px] font-bold mr-2">
                        {(p.name[0] ?? '?').toUpperCase()}
                      </div>
                      {p.name}
                    </Link>
                  </DropdownMenuItem>
                ))}
                {safeProjects.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={onCreateProject} className="cursor-pointer">
                  <Plus className="h-4 w-4 mr-2 text-muted-foreground" />
                  New project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {currentProject && projectBase ? (
            projectNavItems.map((item) => {
              const active = isActive(item.href);
              const href = projectBase + item.href;
              return collapsed ? (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <Link
                      href={href}
                      className={cn(
                        'flex h-8 w-full items-center justify-center rounded-md transition-colors',
                        active
                          ? 'bg-sidebar-accent text-sidebar-foreground'
                          : 'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              ) : (
                <Link
                  key={item.href}
                  href={href}
                  className={cn(
                    'flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors',
                    active
                      ? 'bg-sidebar-accent text-sidebar-foreground font-medium'
                      : 'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })
          ) : (
            !collapsed && (
              <div className="px-2 py-6 text-center">
                <p className="text-xs text-sidebar-foreground/40">
                  Select or create a project to get started
                </p>
              </div>
            )
          )}
        </nav>

        <Separator className="bg-sidebar-border" />

        {/* Bottom: theme toggle */}
        <div className={cn('p-2', collapsed && 'flex justify-center')}>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
                >
                  <ThemeIcon className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Toggle theme</TooltipContent>
            </Tooltip>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors">
                  <ThemeIcon className="h-4 w-4" />
                  <span>Theme</span>
                  <span className="ml-auto text-xs capitalize opacity-60">{theme}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top">
                <DropdownMenuItem onClick={() => setTheme('light')} className="cursor-pointer gap-2">
                  <Sun className="h-4 w-4" /> Light
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme('dark')} className="cursor-pointer gap-2">
                  <Moon className="h-4 w-4" /> Dark
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme('system')} className="cursor-pointer gap-2">
                  <Monitor className="h-4 w-4" /> System
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Collapse toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-16 h-6 w-6 rounded-full border border-border bg-background shadow-sm hover:bg-accent z-10"
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronLeft className="h-3 w-3" />
          )}
        </Button>
      </aside>
    </TooltipProvider>
  );
}
