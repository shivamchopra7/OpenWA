import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  MessageSquare,
  Send,
  Webhook,
  Activity,
  Smartphone,
  KeyRound,
  CheckCircle,
  XCircle,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import {
  useSessionsQuery,
  useSessionStatsQuery,
  useWebhooksQuery,
  useApiKeysQuery,
  useStatsOverviewQuery,
  useMessageStatsQuery,
  useStopSessionMutation,
} from '../hooks/queries';
import type { StatsPeriod } from '../services/api';
import { PageHeader } from '../components/PageHeader';
import {
  MessageActivityChart,
  MessagesGauge,
  MessageTypeChart,
  type GaugeSegment,
  type TypeBar,
} from '../components/DashboardCharts';
import './Dashboard.css';

const PERIODS: StatsPeriod[] = ['24h', '7d', '30d'];
const TYPE_COLORS = ['var(--c-blue)', 'var(--c-purple)', 'var(--c-pink)', 'var(--c-yellow)', 'var(--c-green)'];

function CardDots() {
  return (
    <span className="card-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export function Dashboard() {
  const { t } = useTranslation();
  useDocumentTitle(t('dashboard.title'));
  const navigate = useNavigate();
  const { isAdmin } = useRole();
  const [period, setPeriod] = useState<StatsPeriod>('7d');

  const { data: sessions = [], isLoading: loadingSessions, error: sessionsError } = useSessionsQuery();
  const { data: stats } = useSessionStatsQuery();
  const { data: overview, isLoading: loadingOverview } = useStatsOverviewQuery();
  const { data: webhooks = [] } = useWebhooksQuery();
  const apiKeysQuery = useApiKeysQuery(isAdmin);
  // 7d window powers the day-over-day delta + the "top sessions" card; the chart row uses
  // the user-selected period. When period === '7d' react-query dedupes these to one request.
  const { data: kpiSeries, isLoading: loadingKpiSeries } = useMessageStatsQuery('7d');
  const { data: chartSeries, isLoading: loadingChartSeries } = useMessageStatsQuery(period);
  const stopMutation = useStopSessionMutation();

  const error =
    sessionsError instanceof Error ? sessionsError.message : sessionsError ? t('dashboard.loadError') : null;

  // ── Real counts ───────────────────────────────────────────────────────
  const sessionTotal = overview?.sessions.total ?? stats?.total ?? sessions.length;
  const sessionActive = overview?.sessions.active ?? stats?.ready ?? 0;
  const msgSent = overview?.messages.sent ?? 0;
  const msgReceived = overview?.messages.received ?? 0;
  const msgFailed = overview?.messages.failed ?? 0;
  const msgTotal = msgSent + msgReceived;
  const todayTotal = (overview?.messages.today.sent ?? 0) + (overview?.messages.today.received ?? 0);
  const webhookCount = webhooks.length;
  const webhooksActive = webhooks.filter(w => w.active).length;
  const apiKeys = apiKeysQuery.data ?? [];
  const apiKeysAvailable = isAdmin && !apiKeysQuery.isError;
  const apiKeyCount = apiKeys.length;
  const apiKeysActive = apiKeys.filter(k => k.isActive).length;
  const deliveryRate = msgSent + msgFailed > 0 ? (msgSent / (msgSent + msgFailed)) * 100 : null;

  // ── Day-over-day delta for the hero KPI (real, from the 7d series) ──────
  const dayPoints = (kpiSeries?.timeSeries ?? []).map(p => p.sent + p.received);
  const prevDayTotal = dayPoints.length >= 2 ? dayPoints[dayPoints.length - 2] : null;
  const todayDelta =
    prevDayTotal != null && prevDayTotal > 0 ? ((todayTotal - prevDayTotal) / prevDayTotal) * 100 : null;

  // ── Gauge: real message composition (sent / received / failed) ──────────
  const gaugeSegments: GaugeSegment[] = [
    { name: t('dashboard.legend.sent', { defaultValue: 'Sent' }), value: msgSent, color: 'var(--c-green)' },
    { name: t('dashboard.legend.received', { defaultValue: 'Received' }), value: msgReceived, color: 'var(--c-blue)' },
    { name: t('dashboard.legend.failed', { defaultValue: 'Failed' }), value: msgFailed, color: 'var(--c-pink)' },
  ];
  const gaugeTotal = msgSent + msgReceived + msgFailed;

  // ── Top sessions by message volume (last 7 days) ────────────────────────
  const topSessions = (kpiSeries?.bySession ?? [])
    .map(s => ({ ...s, total: s.sent + s.received }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  // ── Messages by type (colorful bars, selected period) ───────────────────
  const typeBars: TypeBar[] = Object.entries(chartSeries?.byType ?? {})
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((b, i) => ({ ...b, color: TYPE_COLORS[i % TYPE_COLORS.length] }));

  const timeSeries = chartSeries?.timeSeries ?? [];

  const summaryRows = [
    {
      key: 'sessions',
      label: t('nav.sessions', { defaultValue: 'Sessions' }),
      value: sessionTotal,
      color: 'blue' as const,
      to: '/sessions',
    },
    {
      key: 'messages',
      label: t('dashboard.summary.messages', { defaultValue: 'Messages' }),
      value: msgTotal,
      color: 'purple' as const,
      to: '/chats',
    },
    {
      key: 'webhooks',
      label: t('nav.webhooks', { defaultValue: 'Webhooks' }),
      value: webhookCount,
      color: 'pink' as const,
      to: '/webhooks',
    },
    {
      key: 'apiKeys',
      label: t('nav.apiKeys', { defaultValue: 'API Keys' }),
      value: apiKeysAvailable ? apiKeyCount : '—',
      color: 'yellow' as const,
      to: isAdmin ? '/api-keys' : '/sessions',
    },
  ];

  const fmt = (n: number | string) => (typeof n === 'number' ? n.toLocaleString() : n);
  const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

  type Kpi = {
    key: string;
    label: string;
    value: string;
    sub: string;
    accent: 'blue' | 'purple' | 'pink' | 'yellow' | 'green';
    icon: typeof Send;
    hero?: boolean;
    delta?: number | null;
  };

  const kpis: Kpi[] = [
    {
      key: 'active',
      label: t('dashboard.stats.activeSessions'),
      value: fmt(sessionActive),
      sub: t('dashboard.kpi.ofTotal', { defaultValue: 'of {{count}} total', count: sessionTotal }),
      accent: 'blue',
      icon: Smartphone,
    },
    {
      key: 'today',
      label: t('dashboard.stats.messagesToday'),
      value: fmt(todayTotal),
      sub:
        prevDayTotal != null
          ? t('dashboard.kpi.yesterday', { defaultValue: '{{count}} yesterday', count: prevDayTotal })
          : t('dashboard.kpi.today', { defaultValue: 'Today' }),
      accent: 'green',
      icon: Activity,
      hero: true,
      delta: todayDelta,
    },
    {
      key: 'total',
      label: t('dashboard.kpi.totalMessages', { defaultValue: 'Total Messages' }),
      value: fmt(msgTotal),
      sub: t('dashboard.kpi.sentReceived', {
        defaultValue: '{{sent}} sent · {{received}} received',
        sent: msgSent.toLocaleString(),
        received: msgReceived.toLocaleString(),
      }),
      accent: 'purple',
      icon: MessageSquare,
    },
    {
      key: 'delivery',
      label: t('dashboard.kpi.deliveryRate', { defaultValue: 'Delivery Rate' }),
      value: deliveryRate != null ? `${deliveryRate.toFixed(1)}%` : '—',
      sub: t('dashboard.kpi.sentFailed', {
        defaultValue: '{{sent}} sent · {{failed}} failed',
        sent: msgSent.toLocaleString(),
        failed: msgFailed.toLocaleString(),
      }),
      accent: 'green',
      icon: CheckCircle,
    },
    {
      key: 'failed',
      label: t('dashboard.kpi.failed', { defaultValue: 'Failed Messages' }),
      value: fmt(msgFailed),
      sub:
        deliveryRate != null
          ? t('dashboard.kpi.delivered', { defaultValue: '{{count}}% delivered', count: deliveryRate.toFixed(1) })
          : t('dashboard.kpi.noFailures', { defaultValue: 'No failures' }),
      accent: 'pink',
      icon: XCircle,
    },
    {
      key: 'webhooks',
      label: t('dashboard.stats.webhooksConfigured'),
      value: fmt(webhookCount),
      sub: t('dashboard.kpi.active', { defaultValue: '{{count}} active', count: webhooksActive }),
      accent: 'yellow',
      icon: Webhook,
    },
    {
      key: 'apiKeys',
      label: t('nav.apiKeys', { defaultValue: 'API Keys' }),
      value: apiKeysAvailable ? fmt(apiKeyCount) : '—',
      sub: apiKeysAvailable
        ? t('dashboard.kpi.active', { defaultValue: '{{count}} active', count: apiKeysActive })
        : t('dashboard.kpi.adminOnly', { defaultValue: 'Admin only' }),
      accent: 'blue',
      icon: KeyRound,
    },
  ];

  const formatLastActive = (date?: string) => {
    if (!date) return t('common.never');
    const diff = Date.now() - new Date(date).getTime();
    if (diff < 60000) return t('common.justNow');
    if (diff < 3600000) return t('common.minAgo', { count: Math.floor(diff / 60000) });
    if (diff < 86400000) return t('common.hoursAgo', { count: Math.floor(diff / 3600000) });
    return new Date(date).toLocaleDateString();
  };

  const formatStatus = (status: string) => t(`sessionStatus.${status}`, { defaultValue: status });

  const handleDisconnect = async (id: string) => {
    try {
      await stopMutation.mutateAsync(id);
    } catch (err) {
      console.error('Failed to disconnect:', err);
    }
  };

  if (error) {
    return (
      <div className="dashboard">
        <div className="error-banner">
          <span className="error-banner-text">{t('dashboard.errorPrefix', { message: error })}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        badge={
          <span className={`status-badge ${sessionActive > 0 ? 'connected' : 'disconnected'}`}>
            {sessionActive > 0 ? t('common.connected') : t('common.disconnected')}
          </span>
        }
      />

      {/* ── Row 1: Summary · Gauge · Top sessions ───────────────────────── */}
      <div className="dash-grid-top">
        {/* Summary — colored category rows */}
        <article className="dash-card dash-card--summary">
          <CardDots />
          <header className="dash-card__head">
            <h2>{t('dashboard.summary.title', { defaultValue: 'Summary' })}</h2>
          </header>
          <div className="summary-list">
            {summaryRows.map(row => (
              <button
                key={row.key}
                type="button"
                className={`summary-row summary-row--${row.color}`}
                onClick={() => navigate(row.to)}
              >
                <span className="summary-row__dot" />
                <span className="summary-row__label">{row.label}</span>
                <span className="summary-row__value">{loadingOverview ? '·' : fmt(row.value)}</span>
              </button>
            ))}
          </div>
        </article>

        {/* Gauge — message composition */}
        <article className="dash-card dash-card--gauge">
          <CardDots />
          <header className="dash-card__head">
            <h2>{t('dashboard.gauge.title', { defaultValue: 'Messages Overview' })}</h2>
          </header>
          {loadingOverview ? (
            <div className="gauge-skeleton">
              <span className="skeleton" style={{ width: 150, height: 150, borderRadius: '50%' }} />
            </div>
          ) : (
            <>
              <MessagesGauge
                segments={gaugeSegments}
                total={gaugeTotal}
                centerLabel={t('dashboard.gauge.center', { defaultValue: 'Total messages' })}
              />
              <div className="gauge-legend">
                {gaugeSegments.map(seg => (
                  <div key={seg.name} className="gauge-legend__item">
                    <span className="gauge-legend__dot" style={{ background: seg.color }} />
                    <span className="gauge-legend__name">{seg.name}</span>
                    <span className="gauge-legend__val">{seg.value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </article>

        {/* Top sessions — mini table */}
        <article className="dash-card dash-card--table">
          <CardDots />
          <header className="dash-card__head">
            <h2>{t('dashboard.topSessions.title', { defaultValue: 'Top Sessions' })}</h2>
            <span className="dash-card__hint">{t('dashboard.topSessions.window', { defaultValue: 'Last 7 days' })}</span>
          </header>
          {loadingKpiSeries ? (
            <div className="mini-table">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="mini-row" aria-hidden="true">
                  <span className="skeleton" style={{ height: 28, width: 28, borderRadius: '50%' }} />
                  <span className="skeleton" style={{ height: 12, width: '60%' }} />
                </div>
              ))}
            </div>
          ) : topSessions.length > 0 ? (
            <div className="mini-table">
              <div className="mini-row mini-row--head">
                <span>{t('dashboard.topSessions.session', { defaultValue: 'Session' })}</span>
                <span>{t('dashboard.legend.sent', { defaultValue: 'Sent' })}</span>
                <span>{t('dashboard.legend.received', { defaultValue: 'Received' })}</span>
                <span>{t('dashboard.topSessions.total', { defaultValue: 'Total' })}</span>
              </div>
              {topSessions.map(s => (
                <div key={s.sessionId} className="mini-row">
                  <span className="mini-session">
                    <span className="mini-avatar">{(s.name || '?').charAt(0).toUpperCase()}</span>
                    <span className="mini-name" title={s.name}>
                      {s.name || s.sessionId.slice(0, 8)}
                    </span>
                  </span>
                  <span className="mini-num">{s.sent.toLocaleString()}</span>
                  <span className="mini-num">{s.received.toLocaleString()}</span>
                  <span className="mini-num mini-num--accent">{s.total.toLocaleString()}</span>
                </div>
              ))}
            </div>
          ) : sessions.length > 0 ? (
            <div className="mini-table">
              {sessions.slice(0, 5).map(s => (
                <div key={s.id} className="mini-row">
                  <span className="mini-session">
                    <span className="mini-avatar">{(s.name || '?').charAt(0).toUpperCase()}</span>
                    <span className="mini-name" title={s.name}>
                      {s.name || s.id.slice(0, 8)}
                    </span>
                  </span>
                  <span className={`status-pill ${s.status}`}>{formatStatus(s.status)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="dash-empty">
              <MessageSquare size={32} strokeWidth={1.5} />
              <p>{t('dashboard.topSessions.empty', { defaultValue: 'No message activity yet' })}</p>
            </div>
          )}
        </article>
      </div>

      {/* ── Row 2: KPI cards (horizontally scrollable) ──────────────────── */}
      <div className="kpi-row" role="list">
        {kpis.map(kpi => {
          const Icon = kpi.icon;
          const hasDelta = kpi.delta != null && Number.isFinite(kpi.delta);
          const up = (kpi.delta ?? 0) >= 0;
          return (
            <div
              key={kpi.key}
              role="listitem"
              className={`kpi-card kpi-card--${kpi.accent}${kpi.hero ? ' kpi-card--hero' : ''}`}
            >
              <div className="kpi-card__top">
                <span className="kpi-card__label">{kpi.label}</span>
                <span className="kpi-card__icon">
                  <Icon size={16} />
                </span>
              </div>
              <div className="kpi-card__value">{loadingOverview ? '—' : kpi.value}</div>
              <div className="kpi-card__foot">
                <span className="kpi-card__sub">{kpi.sub}</span>
                {hasDelta && (
                  <span className={`kpi-delta ${up ? 'up' : 'down'}`}>
                    {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                    {fmtPct(kpi.delta as number)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Row 3: charts ───────────────────────────────────────────────── */}
      <div className="dash-grid-charts">
        <article className="dash-card dash-card--chart">
          <CardDots />
          <header className="dash-card__head">
            <div>
              <h2>{t('dashboard.charts.activity', { defaultValue: 'Message Activity' })}</h2>
              <div className="chart-legend">
                <span className="chart-legend__item">
                  <span className="chart-legend__dot" style={{ background: 'var(--c-green)' }} />
                  {t('dashboard.legend.sent', { defaultValue: 'Sent' })}
                </span>
                <span className="chart-legend__item">
                  <span className="chart-legend__dot" style={{ background: 'var(--c-blue)' }} />
                  {t('dashboard.legend.received', { defaultValue: 'Received' })}
                </span>
              </div>
            </div>
            <div className="period-toggle" role="tablist">
              {PERIODS.map(p => (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={period === p}
                  className={`period-toggle__btn${period === p ? ' active' : ''}`}
                  onClick={() => setPeriod(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </header>
          {loadingChartSeries ? (
            <div className="chart-skeleton">
              <span className="skeleton" style={{ width: '100%', height: 220, borderRadius: 'var(--radius)' }} />
            </div>
          ) : timeSeries.length > 0 ? (
            <MessageActivityChart data={timeSeries} period={period} />
          ) : (
            <div className="dash-empty dash-empty--chart">
              <Activity size={32} strokeWidth={1.5} />
              <p>{t('dashboard.charts.empty', { defaultValue: 'No message activity for this period' })}</p>
            </div>
          )}
        </article>

        <article className="dash-card dash-card--chart">
          <CardDots />
          <header className="dash-card__head">
            <h2>{t('dashboard.charts.byType', { defaultValue: 'Messages by Type' })}</h2>
          </header>
          {loadingChartSeries ? (
            <div className="chart-skeleton">
              <span className="skeleton" style={{ width: '100%', height: 180, borderRadius: 'var(--radius)' }} />
            </div>
          ) : typeBars.length > 0 ? (
            <MessageTypeChart data={typeBars} />
          ) : (
            <div className="dash-empty dash-empty--chart">
              <MessageSquare size={32} strokeWidth={1.5} />
              <p>{t('dashboard.charts.emptyTypes', { defaultValue: 'No messages for this period' })}</p>
            </div>
          )}
        </article>
      </div>

      {/* ── Sessions overview (kept, restyled) ──────────────────────────── */}
      <section className="sessions-section">
        <div className="section-header">
          <h2>{t('dashboard.sessionsOverview')}</h2>
          <span className="section-subtitle">
            {t('dashboard.showingSessions', { shown: sessions.length, total: sessionTotal })}
          </span>
        </div>

        <div className="sessions-table">
          <div className="table-header">
            <span>{t('dashboard.columns.sessionId')}</span>
            <span>{t('dashboard.columns.phone')}</span>
            <span>{t('dashboard.columns.status')}</span>
            <span>{t('dashboard.columns.lastActive')}</span>
            <span>{t('dashboard.columns.actions')}</span>
          </div>
          {loadingSessions ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="table-row" aria-hidden="true">
                <div className="skeleton" style={{ height: 14, width: '80%' }} />
                <div className="skeleton" style={{ height: 14, width: '70%' }} />
                <div className="skeleton" style={{ height: 22, width: 84, borderRadius: 'var(--radius-pill)' }} />
                <div className="skeleton" style={{ height: 14, width: '55%' }} />
                <div className="skeleton" style={{ height: 28, width: 60, borderRadius: 'var(--radius)' }} />
              </div>
            ))
          ) : sessions.length === 0 ? (
            <div className="table-empty">
              <MessageSquare size={40} strokeWidth={1.5} />
              <p>{t('dashboard.noSessions')}</p>
            </div>
          ) : (
            sessions.map(session => (
              <div key={session.id} className="table-row">
                <div className="session-info-cell">
                  <span className="session-id">{session.id.substring(0, 12)}</span>
                  <span className="session-name" title={session.name}>
                    {session.name}
                  </span>
                </div>
                <span className="phone">{session.phone || '—'}</span>
                <span className={`status-pill ${session.status}`}>{formatStatus(session.status)}</span>
                <span className="last-active">{formatLastActive(session.lastActive)}</span>
                <div className="actions">
                  <button className="btn-sm" onClick={() => navigate('/sessions')}>
                    {t('dashboard.view')}
                  </button>
                  {['ready', 'initializing', 'connecting', 'qr_ready'].includes(session.status) && (
                    <button className="btn-sm danger" onClick={() => handleDisconnect(session.id)}>
                      {t('dashboard.disconnect')}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
