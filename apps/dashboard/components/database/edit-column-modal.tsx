'use client';

import * as React from 'react';
import { X, Save, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import api from '@/lib/api';

const COLUMN_TYPES = [
  'text',
  'varchar(255)',
  'char(1)',
  'uuid',
  'int2',
  'int4',
  'int8',
  'float4',
  'float8',
  'numeric',
  'numeric(12,2)',
  'bool',
  'date',
  'time',
  'timetz',
  'timestamp',
  'timestamptz',
  'json',
  'jsonb',
  'bytea',
  'inet',
];

export interface EditableColumn {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimary: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  projectSlug: string;
  tableName: string;
  schema?: string;
  column: EditableColumn | null;
  onSuccess: () => void;
}

export function EditColumnModal({
  isOpen,
  onClose,
  projectSlug,
  tableName,
  schema = 'public',
  column,
  onSuccess,
}: Props) {
  const [newName, setNewName] = React.useState('');
  const [type, setType] = React.useState('');
  const [nullable, setNullable] = React.useState(true);
  const [defaultValue, setDefaultValue] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (column) {
      setNewName(column.name);
      setType(column.dataType);
      setNullable(column.isNullable);
      setDefaultValue(column.defaultValue ?? '');
      setError(null);
    }
  }, [column]);

  if (!isOpen || !column) return null;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!column || !newName.trim()) return;

    const payload: Record<string, unknown> = {};
    if (newName.trim() !== column.name) payload.newName = newName.trim();
    if (type.trim() !== column.dataType) payload.type = type.trim();
    if (nullable !== column.isNullable) payload.nullable = nullable;
    const origDefault = column.defaultValue ?? '';
    if (defaultValue.trim() !== origDefault) {
      payload.defaultValue = defaultValue.trim() === '' ? null : defaultValue.trim();
    }

    if (Object.keys(payload).length === 0) {
      onClose();
      return;
    }

    setLoading(true);
    setError(null);
    const res = await api.patch(
      `/api/v1/projects/${projectSlug}/database/tables/${tableName}/columns/${encodeURIComponent(column.name)}?schema=${schema}`,
      payload,
    );

    if (!res.success) {
      setError(res.error?.message ?? 'Failed to update column');
      setLoading(false);
      return;
    }

    setLoading(false);
    onSuccess();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-background shadow-2xl overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Edit Column</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Alter <span className="font-mono text-emerald-500">{schema}.{tableName}.{column.name}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Column Name</label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-8 text-sm font-mono"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Data Type</label>
            <select
              value={COLUMN_TYPES.includes(type) ? type : '__custom'}
              onChange={(e) => {
                if (e.target.value !== '__custom') setType(e.target.value);
              }}
              className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs font-mono"
            >
              {!COLUMN_TYPES.includes(type) && (
                <option value="__custom">{type} (current)</option>
              )}
              {COLUMN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <Input
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="Or custom Postgres type e.g. varchar(120)"
              className="h-7 text-xs font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Default Expression <span className="text-muted-foreground font-normal">(leave empty to DROP DEFAULT)</span>
            </label>
            <Input
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
              placeholder="e.g. now(), 'STANDARD', 0"
              className="h-8 text-xs font-mono"
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => setNullable((v) => !v)}
              className={cn(
                'relative h-5 w-9 rounded-full transition-colors',
                nullable ? 'bg-emerald-500' : 'bg-muted-foreground/30',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                  nullable ? 'translate-x-4' : 'translate-x-0.5',
                )}
              />
            </button>
            <span className="text-xs text-foreground">Allow NULL values</span>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={loading || !newName.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5"
            >
              <Save className="h-3.5 w-3.5" />
              {loading ? 'Saving...' : 'Save changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
