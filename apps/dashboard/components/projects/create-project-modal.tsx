'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FolderPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const createProjectSchema = z.object({
  name: z
    .string()
    .min(2, 'Project name must be at least 2 characters')
    .max(50, 'Project name must be at most 50 characters')
    .regex(
      /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/,
      'Name must start with a letter or number and contain only letters, numbers, spaces, hyphens, or underscores'
    ),
  description: z.string().max(200, 'Description must be at most 200 characters').optional(),
});

type CreateProjectValues = z.infer<typeof createProjectSchema>;

interface CreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (project: { name: string; slug: string }) => void;
}

export function CreateProjectModal({ open, onOpenChange, onSuccess }: CreateProjectModalProps) {
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateProjectValues>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { name: '', description: '' },
  });

  const nameValue = watch('name');
  const slugPreview = nameValue
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  async function onSubmit(data: CreateProjectValues) {
    setServerError(null);
    try {
      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      const json = await res.json();

      if (!res.ok) {
        setServerError(json?.error?.message ?? 'Failed to create project. Please try again.');
        return;
      }

      reset();
      onOpenChange(false);
      onSuccess?.({ name: json.data.name, slug: json.data.slug });
    } catch {
      setServerError('Network error. Please check your connection and try again.');
    }
  }

  function handleOpenChange(val: boolean) {
    if (!val) {
      reset();
      setServerError(null);
    }
    onOpenChange(val);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="h-5 w-5 text-primary" />
            Create new project
          </DialogTitle>
          <DialogDescription>
            Each project gets its own isolated database, authentication, storage, and API.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-1">
          {serverError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError}
            </div>
          )}

          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="project-name">Project name</Label>
            <Input
              id="project-name"
              placeholder="My Awesome App"
              {...register('name')}
              aria-invalid={!!errors.name}
            />
            {errors.name ? (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            ) : slugPreview ? (
              <p className="text-xs text-muted-foreground">
                Slug: <span className="font-mono text-foreground">{slugPreview}</span>
              </p>
            ) : null}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="project-description">
              Description{' '}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="project-description"
              placeholder="A short description of what this project is for"
              rows={3}
              {...register('description')}
            />
            {errors.description && (
              <p className="text-xs text-destructive">{errors.description.message}</p>
            )}
          </div>

          {/* Info panel */}
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground text-xs">What gets created:</p>
            <ul className="space-y-0.5 list-none">
              <li>• Dedicated PostgreSQL database</li>
              <li>• Isolated database roles & credentials</li>
              <li>• Application authentication environment</li>
              <li>• Object storage bucket</li>
              <li>• Auto-generated REST API</li>
            </ul>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} loading={isSubmitting}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
