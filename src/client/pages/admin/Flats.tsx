import { useMemo, useState } from 'react';
import { api, ApiError, useApi } from '../../lib/api';
import { CrudSection } from '../../components/CrudSection';
import { Button, Card, Chip, ErrorBanner, Field, Loading, Modal, PageHeader, Segmented, useToast } from '../../components/ui';

interface Wing { id: number; name: string }
interface Flat { id: number; number: string; wing_id: number; wing: string; residents: number }

export default function AdminFlats() {
  const wings = useApi<{ items: Wing[] }>('/admin/wings');
  const flats = useApi<{ items: Flat[] }>('/admin/flats');
  const toast = useToast();
  const [wingFilter, setWingFilter] = useState('all');
  const [importOpen, setImportOpen] = useState(false);
  const [csv, setCsv] = useState('wing,flat\nA,101\nA,102');
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<{ wingId: string; number: string } | null>(null);

  const visible = useMemo(() => (flats.data?.items ?? []).filter((f) => wingFilter === 'all' || String(f.wing_id) === wingFilter), [flats.data, wingFilter]);
  const reloadAll = () => { void wings.reload(); void flats.reload(); };

  async function runImport() {
    setBusy(true);
    setImportError(null);
    try {
      const r = await api<{ added: number; skipped: number }>('/admin/flats/import', { body: { csv } });
      toast(`Imported ${r.added} flat(s)${r.skipped ? `, ${r.skipped} already existed` : ''}`);
      setImportOpen(false);
      reloadAll();
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function addFlat() {
    if (!adding) return;
    setBusy(true);
    try {
      await api('/admin/flats', { body: { wingId: Number(adding.wingId), number: adding.number } });
      toast(`Flat ${adding.number} added`);
      setAdding(null);
      void flats.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeFlat(f: Flat) {
    if (!window.confirm(`Delete flat ${f.wing}-${f.number}?`)) return;
    try {
      await api(`/admin/flats/${f.id}`, { method: 'DELETE' });
      toast('Flat deleted');
      void flats.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Wings & flats"
        subtitle={flats.data ? `${flats.data.items.length} flats in ${wings.data?.items.length ?? 0} wings` : undefined}
        actions={<Button variant="secondary" icon="upload" onClick={() => setImportOpen(true)}>Import CSV</Button>}
      />
      <div className="space-y-4">
        <CrudSection<Wing>
          title="Wings"
          endpoint="/admin/wings"
          itemName="wing"
          allowDelete
          columns={[{ label: 'Wing', render: (w) => <span className="font-semibold">{w.name}</span> }, { label: 'Flats', render: (w) => flats.data?.items.filter((f) => f.wing_id === w.id).length ?? '—' }]}
          fields={[{ key: 'name', label: 'Wing name', type: 'text', required: true, placeholder: 'A' }]}
          defaults={{ name: '' }}
        />
        <Card
          title="Flats"
          action={
            <div className="flex flex-wrap items-center gap-2">
              {wings.data && (
                <Segmented label="Filter by wing" value={wingFilter} onChange={setWingFilter} options={[{ value: 'all', label: 'All' }, ...wings.data.items.map((w) => ({ value: String(w.id), label: w.name }))]} />
              )}
              <Button size="sm" icon="plus" onClick={() => setAdding({ wingId: String(wings.data?.items[0]?.id ?? ''), number: '' })}>Add flat</Button>
            </div>
          }
        >
          <ErrorBanner error={flats.error} onRetry={flats.reload} />
          {flats.loading && !flats.data ? <Loading /> : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
              {visible.map((f) => (
                <li key={f.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                  <span className="font-semibold num">{f.wing}-{f.number}</span>
                  {f.residents > 0 ? <Chip tone="green">{f.residents}</Chip> : (
                    <button type="button" className="grid h-8 w-8 place-items-center rounded text-muted hover:bg-danger-soft hover:text-danger" aria-label={`Delete flat ${f.wing}-${f.number}`} onClick={() => removeFlat(f)}>×</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm text-muted">Green numbers show residents with app logins. Flats with residents can't be deleted.</p>
        </Card>
      </div>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Bulk import flats from CSV" footer={<><Button variant="secondary" onClick={() => setImportOpen(false)}>Cancel</Button><Button busy={busy} onClick={runImport}>Import</Button></>}>
        <div className="space-y-3">
          <p className="text-sm text-muted">One flat per line as <code className="rounded bg-page px-1">wing,flat</code>. A header row is optional. New wings are created automatically and existing flats are skipped.</p>
          <ErrorBanner error={importError} />
          <Field label="CSV file">
            {(id) => (
              <input id={id} type="file" accept=".csv,text/csv" className="input" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setCsv(await file.text()); }} />
            )}
          </Field>
          <Field label="…or paste CSV">{(id) => <textarea id={id} className="input min-h-40 font-mono text-sm" value={csv} onChange={(e) => setCsv(e.target.value)} />}</Field>
        </div>
      </Modal>

      <Modal open={Boolean(adding)} onClose={() => setAdding(null)} title="Add flat" footer={<><Button variant="secondary" onClick={() => setAdding(null)}>Cancel</Button><Button busy={busy} onClick={addFlat} disabled={!adding?.number || !adding.wingId}>Add</Button></>}>
        {adding && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Wing">
              {(id) => (
                <select id={id} className="input" value={adding.wingId} onChange={(e) => setAdding({ ...adding, wingId: e.target.value })}>
                  {wings.data?.items.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              )}
            </Field>
            <Field label="Flat number">{(id) => <input id={id} className="input" value={adding.number} onChange={(e) => setAdding({ ...adding, number: e.target.value })} placeholder="1104" />}</Field>
          </div>
        )}
      </Modal>
    </>
  );
}
