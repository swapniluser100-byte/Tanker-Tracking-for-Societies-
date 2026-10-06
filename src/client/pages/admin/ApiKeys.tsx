import { useState } from 'react';
import { api, ApiError, useApi } from '../../lib/api';
import { formatDateTime } from '../../../shared/format';
import { Button, Card, Chip, Empty, ErrorBanner, Field, Loading, Modal, PageHeader, Table, useToast } from '../../components/ui';

interface Key { id: number; name: string; prefix: string; tank: string | null; last_used_at: string | null; revoked_at: string | null; created_at: string; created_by: string | null }
interface Tank { id: number; name: string }

export default function AdminApiKeys() {
  const keys = useApi<{ items: Key[] }>('/admin/api-keys');
  const tanks = useApi<{ items: Tank[] }>('/admin/tanks');
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [tankId, setTankId] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ key: string }>('/admin/api-keys', { body: { name, tankId: tankId ? Number(tankId) : null } });
      setCreating(false);
      setNewKey(r.key);
      setName('');
      setTankId('');
      void keys.reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(k: Key) {
    if (!window.confirm(`Revoke "${k.name}"? Sensors using it will stop reporting immediately.`)) return;
    try {
      await api(`/admin/api-keys/${k.id}/revoke`, { body: {} });
      toast('Key revoked');
      void keys.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <>
      <PageHeader title="Sensor API keys" subtitle="For ESP32 / IoT tank-level sensors. A key is shown only once — only its hash is stored." actions={<Button icon="plus" onClick={() => setCreating(true)}>Create key</Button>} />
      <div className="space-y-4">
        <Card>
          <ErrorBanner error={keys.error} onRetry={keys.reload} />
          {keys.loading && !keys.data ? <Loading /> : !keys.data?.items.length ? <Empty icon="key">No API keys yet.</Empty> : (
            <Table label="API keys">
              <thead><tr><th className="th">Name</th><th className="th">Key</th><th className="th">Tank</th><th className="th">Last used</th><th className="th">Status</th><th className="th" /></tr></thead>
              <tbody>
                {keys.data.items.map((k) => (
                  <tr key={k.id} className={k.revoked_at ? 'opacity-60' : ''}>
                    <td className="td"><div className="font-semibold">{k.name}</div><div className="text-muted">Created {formatDateTime(k.created_at)}{k.created_by ? ` by ${k.created_by}` : ''}</div></td>
                    <td className="td font-mono text-xs">{k.prefix}…</td>
                    <td className="td">{k.tank ?? 'Any tank'}</td>
                    <td className="td whitespace-nowrap">{formatDateTime(k.last_used_at)}</td>
                    <td className="td">{k.revoked_at ? <Chip tone="red">Revoked</Chip> : <Chip tone="green">Active</Chip>}</td>
                    <td className="td text-right">{!k.revoked_at && <Button size="sm" variant="ghost" className="text-danger" onClick={() => revoke(k)}>Revoke</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title="Sending readings from a sensor">
          <p className="mb-2 text-sm text-muted">POST JSON with the key in the Authorization header. Up to 12 readings per minute per key.</p>
          <pre className="overflow-x-auto rounded-xl bg-sidebar p-4 text-xs leading-relaxed text-sidebar-ink"><code>{`curl -X POST ${origin}/api/readings \\
  -H "Authorization: Bearer js_live_xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"tank_id": 1, "level_pct": 46.5}'

# or raw ultrasonic distance (cm from sensor to water):
  -d '{"tank_id": 1, "distance_cm": 132, "tank_height_cm": 250, "sensor_offset_cm": 20}'`}</code></pre>
        </Card>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Create sensor API key" footer={<><Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button><Button busy={busy} disabled={!name} onClick={create}>Create</Button></>}>
        <div className="space-y-3">
          <ErrorBanner error={err} />
          <Field label="Name" hint="Where the sensor is, e.g. ESP32 – B-wing overhead">{(id, d) => <input id={id} aria-describedby={d} className="input" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Restrict to tank" hint="Recommended: a key that can only report for one tank.">
            {(id, d) => (
              <select id={id} aria-describedby={d} className="input" value={tankId} onChange={(e) => setTankId(e.target.value)}>
                <option value="">Any tank</option>
                {tanks.data?.items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </Field>
        </div>
      </Modal>

      <Modal open={Boolean(newKey)} onClose={() => setNewKey(null)} title="Copy your new API key" footer={<Button onClick={() => setNewKey(null)}>I have saved it</Button>}>
        <div role="alert" className="mb-3 rounded-xl border border-warn-accent/60 bg-warn-soft px-4 py-3 text-sm font-medium text-warn">
          This is the only time the key is shown. Store it in the sensor's firmware now.
        </div>
        <div className="flex gap-2">
          <input readOnly aria-label="New API key" className="input font-mono text-sm" value={newKey ?? ''} onFocus={(e) => e.target.select()} />
          <Button variant="secondary" onClick={async () => { await navigator.clipboard.writeText(newKey ?? ''); toast('Copied'); }}>Copy</Button>
        </div>
      </Modal>
    </>
  );
}
