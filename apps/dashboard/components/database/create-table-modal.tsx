'use client';

import * as React from 'react';
import { Plus, Trash2, Table2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import api from '@/lib/api';

export interface ColumnDraft {
  id: string; // client-side key
  name: string;
  type: string;
  isPrimary: boolean;
  isNullable: boolean;
  isUnique: boolean;
  defaultValue: string;
}

const COMMON_DATA_TYPES = [
  { label: 'uuid', value: 'uuid' },
  { label: 'text', value: 'text' },
  { label: 'varchar (string)', value: 'varchar' },
  { label: 'integer (int4)', value: 'integer' },
  { label: 'bigint (int8)', value: 'bigint' },
  { label: 'boolean', value: 'boolean' },
  { label: 'timestamp with time zone', value: 'timestamp with time zone' },
  { label: 'jsonb', value: 'jsonb' },
  { label: 'numeric', value: 'numeric' },
  { label: 'float8', value: 'float8' },
];

interface CreateTableModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  onSuccess?: () => void;
}

const DEFAULT_COLUMNS: ColumnDraft[] = [
  {
    id: 'col-1',
    name: 'id',
    type: 'uuid',
    isPrimary: true,
    isNullable: false,
    isUnique: false,
    defaultValue: 'gen_random_uuid()',
  },
  {
    id: 'col-2',
    name: 'created_at',
    type: 'timestamp with time zone',
    isPrimary: false,
    isNullable: false,
    isUnique: false,
    defaultValue: 'now()',
  },
];

export function CreateTableModal({
  open,
  onOpenChange,
  projectSlug,
  onSuccess,
}: CreateTableModalProps) {
  const [tableName, setTableName] = React.useState('');
  const [schema, setSchema] = React.useState('public');
  const [columns, setColumns] = React.useState<ColumnDraft[]>(DEFAULT_COLUMNS);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function resetForm() {
    setTableName('');
    setSchema('public');
    setColumns(DEFAULT_COLUMNS);
    setError(null);
  }

  function handleOpenChange(val: boolean) {
    if (!val) resetForm();
    onOpenChange(val);
  }

  function addColumn() {
    const newCol: ColumnDraft = {
      id: `col-${Date.now()}`,
      name: '',
      type: 'text',
      isPrimary: false,
      isNullable: true,
      isUnique: false,
      defaultValue: '',
    };
    setColumns((prev) => [...prev, newCol]);
  }

  function removeColumn(id: string) {
    if (columns.length <= 1) return;
    setColumns((prev) => prev.filter((c) => c.id !== id));
  }

  function updateColumn(id: string, patch: Partial<ColumnDraft>) {
    setColumns((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const updated = { ...c, ...patch };
        // If primary key, it cannot be nullable
        if (patch.isPrimary) {
          updated.isNullable = false;
        }
        return updated;
      })
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = tableName.trim().toLowerCase();
    if (!trimmedName) {
      setError('Please enter a table name');
      return;
    }

    if (!/^[a-z][a-z0-9_]*$/.test(trimmedName)) {
      setError(
        'Table name must start with a lowercase letter and contain only letters, numbers, and underscores'
      );
      return;
    }

    if (columns.length === 0) {
      setError('A table must have at least one column');
      return;
    }

    const seenNames = new Set<string>();
    for (const col of columns) {
      const colName = col.name.trim().toLowerCase();
      if (!colName) {
        setError('All columns must have a name');
        return;
      }
      if (!/^[a-z_][a-z0-9_]*$/.test(colName)) {
        setError(
          `Column name "${col.name}" is invalid. Use letters, numbers, and underscores only.`
        );
        return;
      }
      if (seenNames.has(colName)) {
        setError(`Duplicate column name: "${colName}"`);
        return;
      }
      seenNames.add(colName);
    }

    const payload = {
      name: trimmedName,
      schema: schema.trim() || 'public',
      columns: columns.map((c) => ({
        name: c.name.trim().toLowerCase(),
        type: c.type,
        isPrimary: c.isPrimary,
        isNullable: c.isNullable,
        isUnique: c.isUnique,
        defaultValue: c.defaultValue.trim() || undefined,
      })),
    };

    setSubmitting(true);
    try {
      const res = await api.post(
        `/api/v1/projects/${projectSlug}/database/tables`,
        payload
      );

      if (!res.success) {
        setError(res.error?.message ?? 'Failed to create table');
        setSubmitting(false);
        return;
      }

      resetForm();
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Table2 className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle>Create new table</DialogTitle>
              <DialogDescription>
                Define columns and constraints for a new PostgreSQL table.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 flex items-start gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden space-y-4">
          {/* Table metadata */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="tableName" className="text-xs font-semibold">
                Table name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="tableName"
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="e.g. products, orders, profiles"
                className="font-mono text-sm"
                autoFocus
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="schema" className="text-xs font-semibold">
                Schema
              </Label>
              <Input
                id="schema"
                value={schema}
                onChange={(e) => setSchema(e.target.value)}
                placeholder="public"
                className="font-mono text-sm"
              />
            </div>
          </div>

          {/* Columns Section */}
          <div className="flex-1 flex flex-col min-h-0 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Columns ({columns.length})
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addColumn}
                className="h-7 text-xs"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add column
              </Button>
            </div>

            {/* Column List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 border border-border rounded-md p-3 bg-muted/20">
              {columns.map((col, index) => (
                <div
                  key={col.id}
                  className="flex flex-col gap-2 p-2.5 rounded-md border border-border/80 bg-card text-card-foreground shadow-sm"
                >
                  <div className="grid grid-cols-12 gap-2 items-center">
                    {/* Name */}
                    <div className="col-span-4">
                      <Input
                        value={col.name}
                        onChange={(e) => updateColumn(col.id, { name: e.target.value })}
                        placeholder={`column_${index + 1}`}
                        className="h-8 font-mono text-xs"
                      />
                    </div>

                    {/* Type */}
                    <div className="col-span-4">
                      <select
                        value={col.type}
                        onChange={(e) => updateColumn(col.id, { type: e.target.value })}
                        className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
                      >
                        {COMMON_DATA_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Default Value */}
                    <div className="col-span-3">
                      <Input
                        value={col.defaultValue}
                        onChange={(e) => updateColumn(col.id, { defaultValue: e.target.value })}
                        placeholder="default value"
                        className="h-8 font-mono text-xs"
                      />
                    </div>

                    {/* Delete */}
                    <div className="col-span-1 flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeColumn(col.id)}
                        disabled={columns.length <= 1}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Constraints checkboxes */}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1 pl-1">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={col.isPrimary}
                        onChange={(e) => updateColumn(col.id, { isPrimary: e.target.checked })}
                        className="rounded border-input text-primary focus:ring-primary h-3.5 w-3.5"
                      />
                      <span>Primary Key</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={col.isNullable}
                        disabled={col.isPrimary}
                        onChange={(e) => updateColumn(col.id, { isNullable: e.target.checked })}
                        className="rounded border-input text-primary focus:ring-primary h-3.5 w-3.5 disabled:opacity-50"
                      />
                      <span>Nullable</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={col.isUnique}
                        onChange={(e) => updateColumn(col.id, { isUnique: e.target.checked })}
                        className="rounded border-input text-primary focus:ring-primary h-3.5 w-3.5"
                      />
                      <span>Unique</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Create table
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
