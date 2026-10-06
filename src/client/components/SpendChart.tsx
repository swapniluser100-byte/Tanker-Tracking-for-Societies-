import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatINR, formatMonth } from '../../shared/format';

interface Point { month: string; spentPaise: number; tankers: number }

/** ₹ in lakhs/thousands for axis ticks: 150000 → "₹1.5L", 45000 → "₹45k" */
function compactINR(rupees: number) {
  if (rupees >= 100000) return `₹${(rupees / 100000).toFixed(rupees % 100000 ? 1 : 0)}L`;
  if (rupees >= 1000) return `₹${Math.round(rupees / 1000)}k`;
  return `₹${rupees}`;
}

/** Single-series bar chart of monthly tanker spend with the budget as a reference line. */
export function SpendChart({ data, budgetPaise }: { data: Point[]; budgetPaise: number }) {
  const rows = data.map((d) => ({ ...d, label: formatMonth(d.month).replace(' 20', " '"), rupees: Math.round(d.spentPaise / 100) }));
  const current = data[data.length - 1]?.month;
  // Round the axis up to a whole step so the budget line is never clipped and ticks stay even (₹50k, ₹1L, …).
  const peak = Math.max(budgetPaise / 100, ...rows.map((r) => r.rupees), 1);
  const step = peak > 200000 ? 50000 : peak > 50000 ? 25000 : 5000;
  const yMax = Math.ceil((peak * 1.05) / step) * step;
  const ticks = Array.from({ length: Math.floor(yMax / step) + 1 }, (_, i) => i * step).filter((_, i, a) => a.length <= 6 || i % 2 === 0);
  return (
    <figure>
      <div className="h-60 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="#E6ECF1" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#C4D0DA' }} tick={{ fill: '#52637A', fontSize: 12 }} />
            <YAxis domain={[0, yMax]} ticks={ticks} tickFormatter={compactINR} tickLine={false} axisLine={false} width={52} tick={{ fill: '#52637A', fontSize: 12 }} />
            {budgetPaise > 0 && (
              <ReferenceLine y={budgetPaise / 100} stroke="#9A3412" strokeDasharray="4 4" label={{ value: 'Budget', position: 'insideTopRight', fill: '#9A3412', fontSize: 12 }} />
            )}
            <Tooltip
              cursor={{ fill: 'rgba(11,99,182,0.06)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as Point & { label: string };
                return (
                  <div className="rounded-lg border border-line bg-white px-3 py-2 text-sm shadow-md">
                    <div className="font-semibold">{formatMonth(p.month)}{p.month === current ? ' (so far)' : ''}</div>
                    <div className="num">{formatINR(p.spentPaise)} · {p.tankers} tankers</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="rupees" fill="#0B63B6" radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">Tanker spend for the last {data.length} months</figcaption>
      <details className="mt-2 text-sm">
        <summary className="inline-flex min-h-11 items-center font-semibold text-primary">Show as table</summary>
        <table className="mt-1 w-full text-left">
          <thead><tr><th className="th">Month</th><th className="th text-right">Spend</th><th className="th text-right">Tankers</th></tr></thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.month}><td className="td">{formatMonth(d.month)}</td><td className="td text-right num">{formatINR(d.spentPaise)}</td><td className="td text-right num">{d.tankers}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
