import { useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, useApi } from '../lib/api';
import { Button, Card, Empty, ErrorBanner, Field, Loading, Modal, Table, useToast } from './ui';

export type FieldType = 'text' | 'number' | 'time' | 'select' | 'checkbox' | 'rupees' | 'tel';

export interface CrudField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  hint?: string;
  options?: { value: string | number; label: string }[];
  /** For selects: allow an empty choice that maps to null. */
  nullable?: boolean;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface CrudColumn<T> {
  label: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface Props<T extends { id: number }> {
  title: string;
  description?: ReactNode;
  endpoint: string; // e.g. /admin/tanks
  itemName: string; // "tank"
  columns: CrudColumn<T>[];
  fields: CrudField[];
  defaults: Record<string, unknown>;
  /** Show a delete button. Things referenced by history should be deactivated instead. */
  allowDelete?: boolean;
  rowActions?: (row: T, reload: () => void) => ReactNode;
}

type FormState = Record<string, string | boolean>;

function toForm(fields: CrudField[], src: Record<string, unknown>): FormState {
  const out: FormState = {};
  for (const f of fields) {
    const v = src[f.key];
    if (f.type === 'checkbox') out[f.key] = Boolean(v);
    else if (f.type === 'rupees') out[f.key] = v == null ? '' : String(Number(v) / 100);
    else out[f.key] = v == null ? '' : String(v);
  }
  return out;
}

function fromForm(fields: CrudField[], form: FormState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = form[f.key];
    if (f.type === 'checkbox') out[f.key] = Boolean(v);
    else if (f.type === 'number') out[f.key] = v === '' ? null : Number(v);
    else if (f.type === 'rupees') out[f.key] = v === '' ? null : Math.round(Number(v) * 100);
    else if (f.type === 'select') {
      const isNumeric = f.options?.some((o) => typeof o.value === 'number');
      out[f.key] = v === '' ? (f.nullable ? null : '') : isNumeric ? Number(v) : v;
    } else out[f.key] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

/** List + add/edit modal for a simple admin table backed by registerCrud() on the API. */
export function CrudSection<T extends { id: number }>({ title, description, endpoint, itemName, columns, fields, defaults, allowDelete, rowActions }: Props<T>) {
  const { data, error, loading, reload } = useApi<{ items: T[] }>(endpoint);
  const toast = useToast();
  const [editing, setEditing] = useState<{ id: number | null; form: FormState } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (row?: T) => {
    setFormError(null);
    setEditing({ id: row?.id ?? null, form: toForm(fields, (row as Record<string, unknown>) ?? defaults) });
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setFormError(null);
    try {
      const body = fromForm(fields, editing.form);
      await api(editing.id ? `${endpoint}/${editing.id}` : endpoint, { method: editing.id ? 'PUT' : 'POST', body });
      toast(`${itemName[0].toUpperCase()}${itemName.slice(1)} ${editing.id ? 'updated' : 'added'}`);
      setEditing(null);
      void reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: T) {
    if (!window.confirm(`Delete this ${itemName}? This cannot be undone.`)) return;
    try {
      await api(`${endpoint}/${row.id}`, { method: 'DELETE' });
      toast(`${itemName[0].toUpperCase()}${itemName.slice(1)} deleted`);
      void reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  return (
    <Card title={title} action={<Button size="sm" icon="plus" onClick={() => open()}>Add {itemName}</Button>}>
      {description && <p className="-mt-1 mb-3 text-sm text-muted">{description}</p>}
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : !data?.items.length ? (
        <Empty>No {itemName}s yet.</Empty>
      ) : (
        <Table label={title}>
          <thead>
            <tr>
              {columns.map((c) => <th key={c.label} className={`th ${c.className ?? ''}`}>{c.label}</th>)}
              <th className="th text-right"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((row) => (
              <tr key={row.id}>
                {columns.map((c) => <td key={c.label} className={`td ${c.className ?? ''}`}>{c.render(row)}</td>)}
                <td className="td">
                  <div className="flex justify-end gap-1">
                    {rowActions?.(row, reload)}
                    <Button size="sm" variant="ghost" onClick={() => open(row)}>Edit</Button>
                    {allowDelete && <Button size="sm" variant="ghost" className="text-danger" onClick={() => remove(row)}>Delete</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Edit ${itemName}` : `Add ${itemName}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" form="crud-form" busy={busy}>Save</Button>
          </>
        }
      >
        {editing && (
          <form id="crud-form" onSubmit={save} className="space-y-3">
            <ErrorBanner error={formError} />
            {fields.map((f) => {
              const value = editing.form[f.key];
              const set = (v: string | boolean) => setEditing({ ...editing, form: { ...editing.form, [f.key]: v } });
              if (f.type === 'checkbox')
                return (
                  <label key={f.key} className="flex min-h-11 items-center gap-3 font-medium">
                    <input type="checkbox" className="h-5 w-5 accent-[var(--color-primary)]" checked={Boolean(value)} onChange={(e) => set(e.target.checked)} />
                    {f.label}
                  </label>
                );
              return (
                <Field key={f.key} label={f.label} hint={f.hint}>
                  {(id, d) =>
                    f.type === 'select' ? (
                      <select id={id} aria-describedby={d} className="input" required={f.required} value={String(value)} onChange={(e) => set(e.target.value)}>
                        {(f.nullable || value === '') && <option value="">{f.placeholder ?? '—'}</option>}
                        {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <input
                        id={id}
                        aria-describedby={d}
                        className="input"
                        type={f.type === 'rupees' || f.type === 'number' ? 'number' : f.type}
                        inputMode={f.type === 'rupees' ? 'decimal' : f.type === 'number' || f.type === 'tel' ? 'numeric' : undefined}
                        step={f.step ?? (f.type === 'rupees' ? 0.01 : undefined)}
                        min={f.min}
                        max={f.max}
                        required={f.required}
                        placeholder={f.placeholder}
                        value={String(value)}
                        onChange={(e) => set(e.target.value)}
                      />
                    )
                  }
                </Field>
              );
            })}
          </form>
        )}
      </Modal>
    </Card>
  );
}
