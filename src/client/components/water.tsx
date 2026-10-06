import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { formatHours, type TankStatus } from '../lib/types';
import { formatDateTime, formatLitres, istDate, istTime } from '../../shared/format';
import { Button, ErrorBanner, Field, FillBar, Modal, Segmented, cx, useToast } from './ui';
import { Icon } from './icons';

export function TankCard({ tank }: { tank: TankStatus }) {
  const pct = tank.levelPct ?? 0;
  return (
    <div className={cx('card p-4', tank.isLow && 'border-warn-accent bg-warn-soft')}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{tank.name}</h3>
          <div className="text-xs text-muted">{tank.type === 'sump' ? 'Sump' : 'Overhead'}{tank.wingName ? ` · Wing ${tank.wingName}` : ''}</div>
        </div>
        <div className={cx('font-display text-2xl font-bold num', tank.isLow ? 'text-warn' : 'text-ink')}>{tank.levelPct == null ? '—' : `${Math.round(pct)}%`}</div>
      </div>
      <FillBar pct={tank.levelPct} low={tank.isLow} label={`${tank.name} level`} />
      <div className="mt-2 flex flex-wrap justify-between gap-x-3 text-sm">
        <span className="num">{tank.litres == null ? 'No reading' : `${formatLitres(tank.litres)} / ${formatLitres(tank.capacityLitres)}`}</span>
        <span className={cx('font-semibold', tank.isLow ? 'text-warn' : 'text-muted')}>
          {tank.isLow && <Icon name="alert" size={14} className="mr-1 inline align-[-2px]" />}
          {formatHours(tank.hoursLeft)} left
        </span>
      </div>
      <div className="mt-1 text-xs text-muted">Updated {formatDateTime(tank.readingAt)} · {tank.readingSource ?? '—'}</div>
    </div>
  );
}

/** Record whether PMC/PCMC water came today (committee & guards). */
export function LogSupplyModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [came, setCame] = useState<'yes' | 'no'>('yes');
  const [start, setStart] = useState(istTime());
  const [end, setEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api('/municipal/logs', { body: { date: istDate(), came: came === 'yes', actualStart: came === 'yes' ? start || null : null, actualEnd: came === 'yes' ? end || null : null, notes: notes || null } });
      toast("Today's supply logged");
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Log today's municipal supply" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <ErrorBanner error={error} />
        <div>
          <div className="label" id="came-label">Did the water come today?</div>
          <Segmented label="Did the water come today?" value={came} onChange={setCame} options={[{ value: 'yes', label: 'Yes, it came' }, { value: 'no', label: 'No supply' }]} />
        </div>
        {came === 'yes' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Started at">{(id) => <input id={id} type="time" className="input" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
            <Field label="Stopped at">{(id) => <input id={id} type="time" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
          </div>
        )}
        <Field label="Notes (optional)">{(id) => <input id={id} className="input" placeholder={came === 'no' ? 'e.g. pipeline repair, no notice' : 'e.g. low pressure'} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
