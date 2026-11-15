'use client';

import * as React from 'react';
import { Terminal, Copy, Check, ExternalLink, Database, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface ConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  projectName?: string;
}

export function ConnectModal({
  open,
  onOpenChange,
  projectSlug,
  projectName = 'Project',
}: ConnectModalProps) {
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  // Connection strings based on project convention
  const directUri = `postgresql://postgres:[YOUR-PASSWORD]@localhost:5432/skynode_proj_${projectSlug}`;
  const psqlCmd = `psql -h localhost -p 5432 -U postgres -d skynode_proj_${projectSlug}`;
  const prismaUrl = `DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@localhost:5432/skynode_proj_${projectSlug}?schema=public"`;
  const nodeSnippet = `import { Pool } from 'pg';\n\nconst pool = new Pool({\n  connectionString: process.env.DATABASE_URL,\n});`;
  const pythonSnippet = `import psycopg2\n\nconn = psycopg2.connect(\n    "dbname='skynode_proj_${projectSlug}' user='postgres' host='localhost' port='5432' password='[YOUR-PASSWORD]'"\n)`;

  async function handleCopy(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500">
              <Database className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle>Connect to {projectName}</DialogTitle>
              <DialogDescription>
                Use these connection strings to connect tools and client applications directly to your database.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs defaultValue="uri" className="w-full mt-2">
          <TabsList className="w-full justify-start border-b border-border bg-transparent p-0">
            <TabsTrigger value="uri">URI</TabsTrigger>
            <TabsTrigger value="psql">PSQL</TabsTrigger>
            <TabsTrigger value="prisma">Prisma</TabsTrigger>
            <TabsTrigger value="nodejs">Node.js</TabsTrigger>
            <TabsTrigger value="python">Python</TabsTrigger>
          </TabsList>

          <TabsContent value="uri" className="space-y-3 pt-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">
                Direct Connection String
              </Label>
              <div className="flex items-center gap-2">
                <Input value={directUri} readOnly className="font-mono text-xs" />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopy(directUri, 'uri')}
                  className="gap-1.5 shrink-0"
                >
                  {copiedKey === 'uri' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedKey === 'uri' ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Replace <code className="text-foreground">[YOUR-PASSWORD]</code> with your project database password.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="psql" className="space-y-3 pt-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">
                Terminal psql command
              </Label>
              <div className="flex items-center gap-2">
                <Input value={psqlCmd} readOnly className="font-mono text-xs" />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopy(psqlCmd, 'psql')}
                  className="gap-1.5 shrink-0"
                >
                  {copiedKey === 'psql' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedKey === 'psql' ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="prisma" className="space-y-3 pt-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">
                .env DATABASE_URL
              </Label>
              <div className="flex items-center gap-2">
                <Input value={prismaUrl} readOnly className="font-mono text-xs" />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopy(prismaUrl, 'prisma')}
                  className="gap-1.5 shrink-0"
                >
                  {copiedKey === 'prisma' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedKey === 'prisma' ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="nodejs" className="space-y-3 pt-3">
            <div className="relative rounded-md bg-muted/40 p-3 font-mono text-xs border border-border">
              <pre className="overflow-x-auto">{nodeSnippet}</pre>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleCopy(nodeSnippet, 'node')}
                className="absolute top-2 right-2 h-7 px-2"
              >
                {copiedKey === 'node' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="python" className="space-y-3 pt-3">
            <div className="relative rounded-md bg-muted/40 p-3 font-mono text-xs border border-border">
              <pre className="overflow-x-auto">{pythonSnippet}</pre>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleCopy(pythonSnippet, 'python')}
                className="absolute top-2 right-2 h-7 px-2"
              >
                {copiedKey === 'python' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
