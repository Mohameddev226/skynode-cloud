'use client';

import * as React from 'react';
import { X, Plus, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import api from '@/lib/api';

const COLUMN_TYPES = [
  'text', 'varchar(255)', 'char(1)', 'uuid',
  'int2', 'int4', 'int8', 'float4', 'float8', 'numeric',
  'bool', 'date', 'time', 'timetz', 'timestamp', 'timestamptz',
  'json', 'jsonb', 'bytea', 'inet', 'cidr', 'macaddr',
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  projectSlug: string;
  tableName: string;
  schema?: string;
  onSuccess: () => void;
}

export function AddColumnModal({ isOpen, onClose, projectSlug, tableName, schema = 'public', onSuccess }: Props) {
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState('text');
  const [nullable, setNullable] = React.useState(true);
  const [defaultValue, setDefaultValue] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function reset() {
    setName('');
    setType('text');
    setNullable(true);
    setDefaultValue('');
    setError(null);
  }

  async function handleAdd() {
    if (!name.trim()) {
      setError('Column name is required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.post(
        `/api/v1/projects/${projectSlug}/database/tables/${tableName}/columns?schema=${schema}`,
        {
          name: name.trim(),
          type,
          nullable,
          defaultValue: defaultValue.trim() || undefined,
        }
      );
      reset();
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to add column');
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-background shadow-2xl overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Add Column</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add a new column to <span className="font-mono text-emerald-500">{tableName}</span>
            </p>
          </div>
          <button
            onClick={() => {
              reset();
              onClose();
            }}
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Column Name</label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. status"
              className="h-8 text-sm font-mono"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
                if (e.key === 'Escape') onClose();
              }}
            />
          </div>

          {/* Type */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Data Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {COLUMN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Default value */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Default Value <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
              placeholder="e.g. 'active', now(), 0"
              className="h-8 text-sm font-mono"
            />
          </div>

          {/* Nullable toggle */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => setNullable((v) => !v)}
              className={cn(
                'relative h-5 w-9 rounded-full transition-colors',
                nullable ? 'bg-emerald-500' : 'bg-muted-foreground/30'
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                  nullable ? 'translate-x-4' : 'translate-x-0.5'
                )}
              />
            </button>
            <span className="text-xs text-foreground">Allow NULL values</span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4 bg-muted/20">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={loading || !name.trim()}
            className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5"
          >
            {loading ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Add Column
          </Button>
        </div>
      </div>
    </div>
  );
}
