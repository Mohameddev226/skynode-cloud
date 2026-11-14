'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, ChevronRight, LogOut, Settings, User } from 'lucide-react';
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

interface BreadcrumbSegment {
  label: string;
  href?: string;
}

interface TopNavProps {
  user?: {
    name: string;
    email: string;
    avatarUrl?: string;
  };
  breadcrumbs?: BreadcrumbSegment[];
  notificationCount?: number;
  onLogout?: () => void;
}

function buildBreadcrumbs(pathname: string): BreadcrumbSegment[] {
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

export function TopNav({ user, breadcrumbs, notificationCount = 0, onLogout }: TopNavProps) {
  const pathname = usePathname();
  const crumbs = breadcrumbs ?? buildBreadcrumbs(pathname);

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  return (
    <TooltipProvider delayDuration={0}>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
        {/* Breadcrumbs */}
        <nav className="flex flex-1 items-center gap-1 text-sm min-w-0">
          {crumbs.map((crumb, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
              )}
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className={cn(
                    'truncate transition-colors hover:text-foreground',
                    i === crumbs.length - 1
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground'
                  )}
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={cn(
                    'truncate',
                    i === crumbs.length - 1
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground'
                  )}
                >
                  {crumb.label}
                </span>
              )}
            </React.Fragment>
          ))}
        </nav>

        {/* Right side actions */}
        <div className="flex items-center gap-1">
          {/* Notifications */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="relative h-8 w-8">
                <Bell className="h-4 w-4" />
                {notificationCount > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
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
              <button className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="h-7 w-7">
                  <AvatarImage src={user?.avatarUrl} alt={user?.name} />
                  <AvatarFallback className="text-[11px]">{initials}</AvatarFallback>
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
              <DropdownMenuItem asChild className="cursor-pointer gap-2">
                <Link href="/settings/account">
                  <User className="h-4 w-4" />
                  Account
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="cursor-pointer gap-2">
                <Link href="/settings">
                  <Settings className="h-4 w-4" />
                  Platform settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onLogout}
                className="cursor-pointer gap-2 text-destructive focus:text-destructive"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </TooltipProvider>
  );
}
