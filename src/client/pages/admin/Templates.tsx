import { useState } from 'react';
import { api, ApiError, useApi } from '../../lib/api';
import { renderTemplate } from '../../../shared/format';
import { Button, Card, Chip, ErrorBanner, Field, Loading, Modal, PageHeader, useToast } from '../../components/ui';

interface Template { id: number; key: string; language: 'en' | 'mr'; channel: 'whatsapp' | 'sms'; description: string | null; text: string; updatedAt: string }

const PLACEHOLDERS: Record<string, string> = {
  society: 'Sai Samarth Residency CHS', flat: 'B-1104', time: '6:00 AM – 9:30 AM', litres: '1,10,250 L', percent: '46',
  tankers: '4', pmc: 'PMC tomorrow 5:30 AM', code: 'TK-1046', tank: 'B-Wing Overhead', hours: '6',
};

export default function AdminTemplates() {
  const { data, error, loading, reload } = useApi<{ items: Template[] }>('/admin/templates');
  const toast = useToast();
  const [editing, setEditing] = useState<Template | null>(null);
  const [text, setText] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const groups = new Map<string, Template[]>();
  for (const t of data?.items ?? []) groups.set(t.key, [...(groups.get(t.key) ?? []), t]);

  async function save() {
    if (!editing) return;
    setBusy(true);
    setSaveError(null);
    try {
      await api(`/admin/templates/${editing.id}`, { method: 'PUT', body: { text } });
      toast('Template saved');
      setEditing(null);
      void reload();
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Notification templates" subtitle="WhatsApp and SMS texts in English and Marathi. Placeholders in {{double braces}} are filled in automatically." />
      <Card className="mb-4" title="Available placeholders">
        <div className="flex flex-wrap gap-2">
          {Object.keys(PLACEHOLDERS).map((k) => <code key={k} className="rounded-md bg-page px-2 py-1 text-sm ring-1 ring-line">{`{{${k}}}`}</code>)}
        </div>
      </Card>
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <Loading />}
      <div className="grid gap-4 lg:grid-cols-2">
        {[...groups.entries()].map(([key, items]) => (
          <Card key={key} title={<span>{items[0].description ?? key} <span className="text-sm font-normal text-muted">· {key}</span></span>}>
            <div className="space-y-3">
              {items.map((t) => (
                <div key={t.id} className="rounded-xl border border-line p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex gap-1">
                      <Chip tone="blue">{t.language === 'en' ? 'English' : 'मराठी'}</Chip>
                      <Chip>{t.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}</Chip>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => { setSaveError(null); setText(t.text); setEditing(t); }}>Edit</Button>
                  </div>
                  <p lang={t.language} className="whitespace-pre-wrap text-sm">{t.text}</p>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} wide title={`Edit ${editing?.key} (${editing?.language === 'mr' ? 'Marathi' : 'English'}, ${editing?.channel})`} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
        {editing && (
          <div className="space-y-3">
            <ErrorBanner error={saveError} />
            <Field label="Message text" hint={editing.channel === 'sms' ? `${text.length} characters — Marathi SMS splits after ~70 characters per part.` : 'WhatsApp supports *bold* and line breaks.'}>
              {(id, d) => <textarea id={id} aria-describedby={d} lang={editing.language} className="input min-h-36" value={text} onChange={(e) => setText(e.target.value)} />}
            </Field>
            <div>
              <div className="label">Preview with sample values</div>
              <p lang={editing.language} className="whitespace-pre-wrap rounded-xl bg-[#e7f6e7] p-3 text-sm">{renderTemplate(text, PLACEHOLDERS)}</p>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
