'use client';

import * as React from 'react';
import { Plus, AlertCircle, Sparkles, Clock, Key } from 'lucide-react';
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

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimary: boolean;
}

interface InsertRowModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  tableName: string;
  schema?: string;
  columns: ColumnInfo[];
  onSuccess?: () => void;
}

export function InsertRowModal({
  open,
  onOpenChange,
  projectSlug,
  tableName,
  schema = 'public',
  columns,
  onSuccess,
}: InsertRowModalProps) {
  const [formData, setFormData] = React.useState<Record<string, string>>({});
  const [nullFlags, setNullFlags] = React.useState<Record<string, boolean>>({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Initialize form state whenever modal opens or columns change
  React.useEffect(() => {
    if (open) {
      const initial: Record<string, string> = {};
      const nulls: Record<string, boolean> = {};

      columns.forEach((col) => {
        // If it's a primary key uuid or has a default, leave empty or auto
        if (col.defaultValue) {
          initial[col.name] = '';
        } else {
          initial[col.name] = '';
        }
        nulls[col.name] = false;
      });

      setFormData(initial);
      setNullFlags(nulls);
      setError(null);
    }
  }, [open, columns]);

  function handleFieldChange(colName: string, value: string) {
    setFormData((prev) => ({ ...prev, [colName]: value }));
    if (nullFlags[colName]) {
      setNullFlags((prev) => ({ ...prev, [colName]: false }));
    }
  }

  function toggleNull(colName: string) {
    setNullFlags((prev) => {
      const next = !prev[colName];
      if (next) {
        setFormData((f) => ({ ...f, [colName]: '' }));
      }
      return { ...prev, [colName]: next };
    });
  }

  function generateUuid(colName: string) {
    // Generate standard UUID v4
    const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
    handleFieldChange(colName, uuid);
  }

  function setNow(colName: string) {
    handleFieldChange(colName, new Date().toISOString());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Build payload
    const payload: Record<string, any> = {};

    for (const col of columns) {
      const colName = col.name;
      const isNull = nullFlags[colName];
      const rawVal = formData[colName]?.trim();

      if (isNull) {
        payload[colName] = null;
        continue;
      }

      // If user left it completely empty and column has default or is auto-pk, omit it
      if (rawVal === '' || rawVal === undefined) {
        if (col.defaultValue || (col.isPrimary && col.dataType.includes('int'))) {
          // Allow DB default to kick in
          continue;
        }
        if (col.isNullable) {
          continue; // omit, or send null
        }
        // If not nullable and no default, error
        setError(`Column "${colName}" is required and cannot be empty.`);
        setLoading(false);
        return;
      }

      // Cast types
      const dt = col.dataType.toLowerCase();
      if (dt.includes('int') || dt === 'bigint') {
        const num = parseInt(rawVal, 10);
        if (isNaN(num)) {
          setError(`Column "${colName}" must be a valid integer.`);
          setLoading(false);
          return;
        }
        payload[colName] = num;
      } else if (dt.includes('float') || dt.includes('numeric') || dt.includes('real')) {
        const num = parseFloat(rawVal);
        if (isNaN(num)) {
          setError(`Column "${colName}" must be a valid number.`);
          setLoading(false);
          return;
        }
        payload[colName] = num;
      } else if (dt === 'boolean' || dt === 'bool') {
        payload[colName] = rawVal.toLowerCase() === 'true';
      } else if (dt.includes('json')) {
        try {
          payload[colName] = JSON.parse(rawVal);
        } catch {
          setError(`Column "${colName}" must be valid JSON.`);
          setLoading(false);
          return;
        }
      } else {
        payload[colName] = rawVal;
      }
    }

    const res = await api.post(
      `/api/v1/projects/${projectSlug}/database/tables/${tableName}/records?schema=${schema}`,
      payload
    );

    if (!res.success) {
      setError(res.error?.message ?? 'Failed to insert row');
      setLoading(false);
      return;
    }

    setLoading(false);
    onOpenChange(false);
    if (onSuccess) onSuccess();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col bg-card text-foreground border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Plus className="h-4 w-4 text-emerald-500" />
            Insert row into <span className="font-mono text-emerald-500">{schema}.{tableName}</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Provide values for the new record. Fields with database defaults or auto-increments can be left empty.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 p-2.5 rounded-md bg-red-500/10 border border-red-500/30 text-red-500 text-xs">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto space-y-3.5 pr-1 py-1">
          {columns.map((col) => {
            const isNull = nullFlags[col.name];
            const dt = col.dataType.toLowerCase();
            const isUuid = dt.includes('uuid');
            const isTimestamp = dt.includes('time');
            const isBool = dt.includes('bool');

            return (
              <div key={col.name} className="space-y-1.5 p-2 rounded border border-border bg-muted/20">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 font-mono">
                    {col.isPrimary && (
                      <span className="flex items-center gap-0.5 text-[10px] px-1 py-0.2 rounded bg-amber-500/10 text-amber-500 font-bold">
                        <Key className="h-2.5 w-2.5" /> PK
                      </span>
                    )}
                    <span className="font-semibold text-foreground">{col.name}</span>
                    <span className="text-[11px] text-muted-foreground font-normal">({col.dataType})</span>
                  </div>

                  <div className="flex items-center gap-3">
                    {col.defaultValue && (
                      <span className="text-[10px] text-muted-foreground/70 font-mono truncate max-w-[140px]" title={col.defaultValue}>
                        default: {col.defaultValue}
                      </span>
                    )}
                    {col.isNullable && (
                      <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isNull}
                          onChange={() => toggleNull(col.name)}
                          className="h-3 w-3 rounded accent-emerald-500"
                        />
                        <span>NULL</span>
                      </label>
                    )}
                  </div>
                </div>

                {isBool ? (
                  <select
                    disabled={isNull}
                    value={formData[col.name] ?? ''}
                    onChange={(e) => handleFieldChange(col.name, e.target.value)}
                    className="w-full h-8 text-xs rounded border border-border bg-background px-2 text-foreground focus:outline-none focus:border-emerald-500 disabled:opacity-40"
                  >
                    <option value="">(default)</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <div className="relative flex items-center">
                    <Input
                      disabled={isNull}
                      value={formData[col.name] ?? ''}
                      onChange={(e) => handleFieldChange(col.name, e.target.value)}
                      placeholder={
                        isNull
                          ? 'NULL'
                          : col.defaultValue
                          ? `(default: ${col.defaultValue})`
                          : col.isNullable
                          ? 'NULL or value'
                          : 'Required'
                      }
                      className="h-8 text-xs bg-background border-border font-mono disabled:opacity-40"
                    />

                    {/* Quick generation shortcuts */}
                    {isUuid && !isNull && (
                      <button
                        type="button"
                        onClick={() => generateUuid(col.name)}
                        className="absolute right-1.5 h-6 px-1.5 rounded flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30"
                        title="Generate random UUID"
                      >
                        <Sparkles className="h-3 w-3" /> Gen UUID
                      </button>
                    )}

                    {isTimestamp && !isNull && (
                      <button
                        type="button"
                        onClick={() => setNow(col.name)}
                        className="absolute right-1.5 h-6 px-1.5 rounded flex items-center gap-1 text-[10px] text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30"
                        title="Set current UTC timestamp"
                      >
                        <Clock className="h-3 w-3" /> now()
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <DialogFooter className="pt-3 border-t border-border flex items-center justify-between sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs gap-1.5"
            >
              {loading ? 'Saving...' : 'Save row'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
