import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MessageTimeSeriesPoint, StatsPeriod } from '../services/api';

// ── prefers-reduced-motion (live) ─────────────────────────────────────
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

// Recharts injects these at runtime; keep them optional so we can render the
// element directly via the `content` prop without TS complaints.
interface TooltipEntry {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}
interface InjectedTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
}

function formatTimestamp(ts: string, period: StatsPeriod): string {
  const d = new Date(ts.includes(' ') ? ts.replace(' ', 'T') : ts);
  if (Number.isNaN(d.getTime())) return ts;
  if (period === '24h') return `${String(d.getHours()).padStart(2, '0')}:00`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function SeriesTooltip({
  active,
  payload,
  label,
  period,
}: InjectedTooltipProps & { period?: StatsPeriod }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="dash-tooltip" role="tooltip">
      {label != null && (
        <div className="dash-tooltip__label">
          {period ? formatTimestamp(String(label), period) : String(label)}
        </div>
      )}
      {payload.map(entry => (
        <div key={String(entry.dataKey ?? entry.name)} className="dash-tooltip__row">
          <span className="dash-tooltip__dot" style={{ background: entry.color }} />
          <span className="dash-tooltip__name">{entry.name}</span>
          <span className="dash-tooltip__value">{Number(entry.value ?? 0).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

// ── Message activity: sent vs received over time (area) ────────────────
export function MessageActivityChart({
  data,
  period,
  height = 248,
}: {
  data: MessageTimeSeriesPoint[];
  period: StatsPeriod;
  height?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="dashGradSent" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--c-green)" stopOpacity={0.42} />
            <stop offset="100%" stopColor="var(--c-green)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="dashGradReceived" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--c-blue)" stopOpacity={0.42} />
            <stop offset="100%" stopColor="var(--c-blue)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="timestamp"
          tickFormatter={ts => formatTimestamp(String(ts), period)}
          tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: 'var(--dash-grid)' }}
          minTickGap={24}
        />
        <YAxis
          tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={40}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ stroke: 'var(--dash-grid)', strokeWidth: 1 }}
          content={<SeriesTooltip period={period} />}
        />
        <Area
          type="monotone"
          dataKey="received"
          name="Received"
          stroke="var(--c-blue)"
          strokeWidth={2.5}
          fill="url(#dashGradReceived)"
          isAnimationActive={!reduced}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
        <Area
          type="monotone"
          dataKey="sent"
          name="Sent"
          stroke="var(--c-green)"
          strokeWidth={2.5}
          fill="url(#dashGradSent)"
          isAnimationActive={!reduced}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Radial donut gauge with center total ───────────────────────────────
export interface GaugeSegment {
  name: string;
  value: number;
  color: string;
}

function GaugeTooltip({ active, payload }: InjectedTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  const seg = entry.payload as unknown as GaugeSegment | undefined;
  return (
    <div className="dash-tooltip" role="tooltip">
      <div className="dash-tooltip__row">
        <span className="dash-tooltip__dot" style={{ background: seg?.color }} />
        <span className="dash-tooltip__name">{entry.name}</span>
        <span className="dash-tooltip__value">{Number(entry.value ?? 0).toLocaleString()}</span>
      </div>
    </div>
  );
}

export function MessagesGauge({
  segments,
  total,
  centerLabel,
  height = 208,
}: {
  segments: GaugeSegment[];
  total: number;
  centerLabel: string;
  height?: number;
}) {
  const reduced = useReducedMotion();
  const hasData = total > 0 && segments.some(s => s.value > 0);
  const data = useMemo<GaugeSegment[]>(
    () => (hasData ? segments.filter(s => s.value > 0) : [{ name: 'empty', value: 1, color: 'var(--bg-hover)' }]),
    [hasData, segments],
  );

  return (
    <div className="dash-gauge" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          {hasData && <Tooltip content={<GaugeTooltip />} />}
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="68%"
            outerRadius="98%"
            startAngle={90}
            endAngle={-270}
            paddingAngle={hasData && data.length > 1 ? 3 : 0}
            cornerRadius={hasData ? 7 : 0}
            stroke="none"
            isAnimationActive={!reduced}
          >
            {data.map(seg => (
              <Cell key={seg.name} fill={seg.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="dash-gauge__center">
        <span className="dash-gauge__value">{total.toLocaleString()}</span>
        <span className="dash-gauge__label">{centerLabel}</span>
      </div>
    </div>
  );
}

// ── Messages by type (colorful bars) ───────────────────────────────────
export interface TypeBar {
  type: string;
  count: number;
  color: string;
}

function BarTooltip({ active, payload, label }: InjectedTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  const bar = entry.payload as unknown as TypeBar | undefined;
  return (
    <div className="dash-tooltip" role="tooltip">
      <div className="dash-tooltip__row">
        <span className="dash-tooltip__dot" style={{ background: bar?.color }} />
        <span className="dash-tooltip__name">{String(label)}</span>
        <span className="dash-tooltip__value">{Number(entry.value ?? 0).toLocaleString()}</span>
      </div>
    </div>
  );
}

export function MessageTypeChart({ data, height = 208 }: { data: TypeBar[]; height?: number }) {
  const reduced = useReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barCategoryGap="28%">
        <XAxis
          dataKey="type"
          tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: 'var(--dash-grid)' }}
          interval={0}
        />
        <YAxis
          tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={40}
          allowDecimals={false}
        />
        <Tooltip cursor={{ fill: 'var(--dash-grid)', opacity: 0.4 }} content={<BarTooltip />} />
        <Bar dataKey="count" name="Messages" radius={[6, 6, 0, 0]} isAnimationActive={!reduced}>
          {data.map(bar => (
            <Cell key={bar.type} fill={bar.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
