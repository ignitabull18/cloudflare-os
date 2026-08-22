import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowClockwise,
  CaretRight,
  ChartLineUp,
  CheckCircle,
  Cloud,
  LockKey,
  Pulse,
  WarningCircle,
} from '@phosphor-icons/react'
import type {
  CloudflareDashboardMetric,
  CloudflareDashboardRange,
  CloudflareDashboardRankedValue,
  CloudflareDashboardSnapshot,
  CloudflareDashboardTrafficPoint,
} from '@gadgets/workshop-shared/cloudflare-gatekeeper'
import { useAuthenticatedApi } from '../AuthContext'
import { useDocumentTitle } from '../useDocumentTitle'

export const Route = createFileRoute('/dashboard')({
  component: CloudflareDashboardPage,
})

type TrendMetric = 'requests' | 'bandwidth' | 'cache-hit-rate' | 'error-rate'

const RANGE_LABELS: Record<CloudflareDashboardRange, string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
}

function formatNumber(value: number, unit: CloudflareDashboardMetric['unit']): string {
  if (unit === 'percent') return `${value.toFixed(value < 1 && value > 0 ? 2 : 1)}%`
  if (unit === 'bytes') {
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
    let scaled = value
    let index = 0
    while (Math.abs(scaled) >= 1000 && index < units.length - 1) {
      scaled /= 1000
      index++
    }
    return `${scaled.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
  }
  if (unit === 'currency') {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value)
  }
  return new Intl.NumberFormat(undefined, {
    notation: Math.abs(value) >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatMetric(metric: CloudflareDashboardMetric): string {
  return metric.value === null ? '—' : formatNumber(metric.value, metric.unit)
}

function comparison(metric: CloudflareDashboardMetric): { label: string; positive: boolean | null } | null {
  if (metric.value === null || metric.previousValue === undefined) return null
  if (metric.previousValue === 0) {
    return metric.value === 0
      ? { label: 'No change', positive: null }
      : { label: 'New activity', positive: true }
  }
  const delta = (metric.value - metric.previousValue) / metric.previousValue * 100
  return {
    label: `${delta >= 0 ? '+' : ''}${delta.toFixed(Math.abs(delta) < 10 ? 1 : 0)}% vs previous`,
    positive: delta === 0 ? null : delta > 0,
  }
}

function MetricCard({ metric, selected, onSelect }: {
  metric: CloudflareDashboardMetric
  selected: boolean
  onSelect: () => void
}) {
  const delta = comparison(metric)
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`min-w-0 cursor-pointer rounded-2xl border p-4 text-left transition-colors ${
        selected ? 'border-kumo-brand bg-kumo-brand-tint' : 'border-kumo-line bg-kumo-base hover:bg-kumo-tint'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="m-0 truncate text-[12px] font-medium leading-4 text-kumo-subtle">{metric.label}</p>
        {metric.status === 'ready' ? (
          <CheckCircle size={14} weight="fill" className="shrink-0 text-kumo-success" />
        ) : metric.status === 'permission-required' ? (
          <LockKey size={14} className="shrink-0 text-kumo-warning" />
        ) : (
          <WarningCircle size={14} className="shrink-0 text-kumo-inactive" />
        )}
      </div>
      <p className="mb-0 mt-2 text-[25px] font-semibold leading-none tracking-[-0.04em] text-kumo-default">
        {formatMetric(metric)}
      </p>
      {delta && (
        <p className="mb-0 mt-2 text-[11px] leading-4 text-kumo-subtle">{delta.label}</p>
      )}
      {metric.status !== 'ready' && metric.note && (
        <p className="mb-0 mt-2 text-[11px] leading-4 text-kumo-subtle">{metric.note}</p>
      )}
    </button>
  )
}

function valueFor(point: CloudflareDashboardTrafficPoint, metric: TrendMetric): number {
  if (metric === 'bandwidth') return point.bandwidth
  if (metric === 'cache-hit-rate') {
    return point.requests > 0 ? point.cachedRequests / point.requests * 100 : 0
  }
  if (metric === 'error-rate') {
    return point.requests > 0 ? point.errors / point.requests * 100 : 0
  }
  return point.requests
}

function formatTimestamp(timestamp: string, range: CloudflareDashboardRange): string {
  const date = new Date(timestamp)
  return range === '24h'
    ? date.toLocaleTimeString([], { hour: 'numeric' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function TrafficChart({ points, metric, range }: {
  points: CloudflareDashboardTrafficPoint[]
  metric: TrendMetric
  range: CloudflareDashboardRange
}) {
  const width = 760
  const height = 238
  const left = 62
  const right = 18
  const top = 18
  const bottom = 32
  const values = points.map(point => valueFor(point, metric))
  const unit: CloudflareDashboardMetric['unit'] = metric === 'bandwidth'
    ? 'bytes'
    : metric.endsWith('rate') ? 'percent' : 'count'
  const max = Math.max(...values, 0)
  const ceiling = max === 0 ? 1 : max * 1.08
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const coordinates = values.map((value, index) => ({
    x: left + (values.length <= 1 ? 0 : index / (values.length - 1) * plotWidth),
    y: top + (1 - value / ceiling) * plotHeight,
  }))
  const line = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ')
  const area = coordinates.length > 0
    ? `${line} L${coordinates.at(-1)?.x},${top + plotHeight} L${coordinates[0].x},${top + plotHeight} Z`
    : ''
  const labels = points.length > 0
    ? [0, Math.floor((points.length - 1) / 2), points.length - 1]
    : []

  if (points.length < 2) {
    return <div className="flex h-56 items-center justify-center text-sm text-kumo-subtle">Not enough observations to draw this trend.</div>
  }
  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metric} trend over ${RANGE_LABELS[range]}`} className="block w-full">
        <defs>
          <linearGradient id="traffic-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f48120" stopOpacity="0.18" />
            <stop offset="1" stopColor="#f48120" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map(step => {
          const y = top + step * plotHeight
          const value = ceiling * (1 - step)
          return (
            <g key={step}>
              <line x1={left} y1={y} x2={width - right} y2={y} stroke="currentColor" className="text-kumo-line" strokeWidth="1" />
              <text x={left - 10} y={y + 4} textAnchor="end" fill="currentColor" className="fill-kumo-inactive text-[11px] tabular-nums">
                {formatNumber(value, unit)}
              </text>
            </g>
          )
        })}
        <path d={area} fill="url(#traffic-fill)" />
        <path d={line} fill="none" stroke="#f48120" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {coordinates.map((point, index) => (
          <circle key={points[index].timestamp} cx={point.x} cy={point.y} r="5" fill="transparent">
            <title>{`${formatTimestamp(points[index].timestamp, range)}: ${formatNumber(values[index], unit)}`}</title>
          </circle>
        ))}
        {labels.map(index => (
          <text key={index} x={coordinates[index].x} y={height - 8} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'} fill="currentColor" className="fill-kumo-inactive text-[11px]">
            {formatTimestamp(points[index].timestamp, range)}
          </text>
        ))}
      </svg>
    </div>
  )
}

function ZoneRanking({ snapshot }: { snapshot: CloudflareDashboardSnapshot }) {
  const visible = snapshot.zones.slice(0, 8)
  const max = Math.max(...visible.map(zone => zone.requests), 1)
  if (visible.length === 0) return null
  return (
    <section aria-labelledby="zones-heading" className="rounded-2xl border border-kumo-line bg-kumo-base p-4 sm:p-5">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 id="zones-heading" className="m-0 text-[15px] font-semibold text-kumo-default">Traffic by zone</h2>
          <p className="mb-0 mt-1 text-[11px] leading-4 text-kumo-subtle">Highest-volume properties during this period</p>
        </div>
        <span className="text-[11px] text-kumo-inactive">Top {visible.length}</span>
      </div>
      <div className="space-y-4">
        {visible.map(zone => (
          <div key={zone.id}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-[12px]">
              <span className="min-w-0 truncate font-medium text-kumo-default">{zone.name}</span>
              <span className="shrink-0 tabular-nums text-kumo-subtle">{formatNumber(zone.requests, 'count')}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-kumo-tint">
              <div className="h-full rounded-full bg-kumo-brand" style={{ width: `${Math.max(zone.requests / max * 100, 1)}%` }} />
            </div>
            <div className="mt-1.5 flex gap-3 text-[10px] text-kumo-inactive">
              <span>{formatNumber(zone.bandwidth, 'bytes')}</span>
              <span>{zone.cacheHitRate.toFixed(1)}% cached</span>
              <span>{zone.errorRate.toFixed(2)}% 5xx</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function RankedAnalysis({
  title,
  subtitle,
  metric,
  items,
  secondaryLabel,
}: {
  title: string
  subtitle: string
  metric: CloudflareDashboardMetric
  items: CloudflareDashboardRankedValue[]
  secondaryLabel?: string
}) {
  const visible = items.slice(0, 6)
  const max = Math.max(...visible.map(item => item.value), 1)
  return (
    <section className="rounded-2xl border border-kumo-line bg-kumo-base p-4 sm:p-5">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-[15px] font-semibold text-kumo-default">{title}</h2>
          <p className="mb-0 mt-1 text-[11px] leading-4 text-kumo-subtle">{subtitle}</p>
        </div>
        <span className="shrink-0 text-[14px] font-semibold tabular-nums text-kumo-default">{formatMetric(metric)}</span>
      </div>
      {metric.status !== 'ready' ? (
        <div className="rounded-xl bg-kumo-tint px-4 py-5 text-center text-[11px] leading-4 text-kumo-subtle">{metric.note}</div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl bg-kumo-tint px-4 py-5 text-center text-[11px] text-kumo-subtle">No activity in this period.</div>
      ) : (
        <div className="space-y-3.5">
          {visible.map(item => (
            <div key={item.id}>
              <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px]">
                <span className="min-w-0 truncate font-medium capitalize text-kumo-default">{item.label}</span>
                <span className="shrink-0 tabular-nums text-kumo-subtle">
                  {formatNumber(item.value, 'count')}
                  {secondaryLabel && item.secondaryValue !== undefined && ` · ${formatNumber(item.secondaryValue, 'count')} ${secondaryLabel}`}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-kumo-tint">
                <div className="h-full rounded-full bg-kumo-brand" style={{ width: `${Math.max(item.value / max * 100, 1)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function CloudflareDashboardPage() {
  useDocumentTitle('Dashboard')
  const { authenticatedApi } = useAuthenticatedApi()
  const [snapshot, setSnapshot] = useState<CloudflareDashboardSnapshot | null>(null)
  const [range, setRange] = useState<CloudflareDashboardRange>('24h')
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('requests')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (accountId?: string, nextRange: CloudflareDashboardRange = '24h') => {
    setLoading(true)
    setError(null)
    try {
      setSnapshot(await authenticatedApi.getCloudflareDashboard(accountId, nextRange))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Cloudflare metrics could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [authenticatedApi])

  useEffect(() => { void load(undefined, '24h') }, [load])

  const permissionGaps = useMemo(() => {
    if (!snapshot) return 0
    return [
      ...snapshot.headline,
      snapshot.securityEvents,
      snapshot.workerRequests,
      snapshot.workerErrors,
      ...snapshot.services,
    ]
      .filter(metric => metric.status === 'permission-required').length
  }, [snapshot])

  const activeMetric = snapshot?.headline.find(metric => metric.id === trendMetric)
  const highestErrorZone = snapshot && snapshot.zones.length > 0
    ? snapshot.zones.reduce((highest, zone) => zone.errorRate > highest.errorRate ? zone : highest)
    : undefined

  const changeRange = (nextRange: CloudflareDashboardRange) => {
    setRange(nextRange)
    void load(snapshot?.account?.id, nextRange)
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem-1px)] bg-kumo-base">
      <main className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-8 sm:py-10">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-kumo-brand">
              <Cloud size={18} weight="fill" />
              <span className="text-[12px] font-semibold uppercase tracking-[0.09em]">Cloudflare operations</span>
            </div>
            <h1 className="m-0 text-3xl font-semibold leading-tight tracking-tight text-kumo-default sm:text-[34px]">Dashboard</h1>
            <p className="mb-0 mt-2 max-w-2xl text-[13px] leading-5 text-kumo-subtle">
              Analyze traffic, caching, reliability, and service footprint across your account.
            </p>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load(snapshot?.account?.id, range)}
            className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 self-start rounded-lg border border-kumo-line bg-kumo-base px-3 text-[13px] font-medium text-kumo-default transition-colors hover:bg-kumo-tint disabled:cursor-default disabled:opacity-50 sm:self-auto"
          >
            <ArrowClockwise size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </header>

        {loading && !snapshot && (
          <div className="rounded-2xl border border-kumo-line bg-kumo-base px-5 py-12 text-center text-sm text-kumo-subtle">Loading Cloudflare analytics…</div>
        )}

        {error && (
          <div className="mb-5 rounded-2xl border border-kumo-danger/30 bg-kumo-danger-tint px-5 py-4">
            <p className="m-0 text-sm font-medium text-kumo-danger">Dashboard refresh failed</p>
            <p className="mb-0 mt-1 text-[12px] leading-4 text-kumo-subtle">{error}</p>
          </div>
        )}

        {snapshot && !snapshot.connected && (
          <section className="rounded-2xl border border-kumo-line bg-kumo-base px-5 py-10 text-center">
            <Cloud size={34} className="mx-auto text-kumo-inactive" />
            <h2 className="mb-0 mt-4 text-lg font-semibold text-kumo-default">Connect Cloudflare</h2>
            <p className="mx-auto mb-0 mt-2 max-w-md text-[13px] leading-5 text-kumo-subtle">Connect Cloudflare API at mcp.cloudflare.com to load account analytics from the full API surface.</p>
            <Link to="/gatekeepers" className="mt-5 inline-flex h-9 items-center rounded-lg bg-kumo-brand px-4 text-[13px] font-medium text-kumo-inverse">Open connections</Link>
          </section>
        )}

        {snapshot?.needsAccountSelection && (
          <section className="rounded-2xl border border-kumo-line bg-kumo-base p-5">
            <h2 className="m-0 text-base font-semibold text-kumo-default">Choose an account</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {snapshot.accounts.map(account => (
                <button key={account.id} type="button" onClick={() => void load(account.id, range)} className="cursor-pointer rounded-xl border border-kumo-line bg-kumo-base px-4 py-3 text-left text-[13px] font-medium text-kumo-default hover:bg-kumo-tint">{account.name}</button>
              ))}
            </div>
          </section>
        )}

        {snapshot?.account && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-kumo-line pb-3">
              <div>
                <p className="m-0 text-[13px] font-semibold text-kumo-default">{snapshot.account.name}</p>
                <p className="mb-0 mt-0.5 text-[11px] text-kumo-inactive">
                  {snapshot.analyticsZonesRead}/{snapshot.analyticsZonesTotal} zones · refreshed {new Date(snapshot.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
              <div className="inline-flex rounded-lg bg-kumo-tint p-0.5">
                {(Object.keys(RANGE_LABELS) as CloudflareDashboardRange[]).map(option => (
                  <button key={option} type="button" disabled={loading} onClick={() => changeRange(option)} className={`h-8 cursor-pointer rounded-md px-3 text-[12px] font-medium transition-colors ${range === option ? 'bg-kumo-base text-kumo-default shadow-sm' : 'text-kumo-subtle'}`}>{option}</button>
                ))}
              </div>
            </div>

            {(snapshot.analyticsNote || permissionGaps > 0) && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-kumo-warning/30 bg-kumo-warning-tint px-4 py-3 text-[12px] text-kumo-subtle">
                <span>{snapshot.analyticsNote ?? `${permissionGaps} metrics need additional read access.`}</span>
                {permissionGaps > 0 && <Link to="/gatekeepers" className="inline-flex items-center gap-1 font-medium text-kumo-warning hover:underline">Reconnect <CaretRight size={12} /></Link>}
              </div>
            )}

            <section aria-labelledby="health-heading">
              <div className="mb-3 flex items-center gap-2">
                <Pulse size={16} className="text-kumo-brand" />
                <h2 id="health-heading" className="m-0 text-[14px] font-semibold text-kumo-default">Account health</h2>
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {snapshot.headline.map(metric => (
                  <MetricCard key={metric.id} metric={metric} selected={trendMetric === metric.id} onSelect={() => setTrendMetric(metric.id as TrendMetric)} />
                ))}
              </div>
            </section>

            <section aria-labelledby="trend-heading" className="rounded-2xl border border-kumo-line bg-kumo-base p-4 sm:p-5">
              <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <ChartLineUp size={16} className="text-kumo-brand" />
                    <h2 id="trend-heading" className="m-0 text-[15px] font-semibold text-kumo-default">{activeMetric?.label ?? 'Traffic'} trend</h2>
                  </div>
                  <p className="mb-0 mt-1 text-[11px] leading-4 text-kumo-subtle">Account total · {RANGE_LABELS[range]} · end-user requests only</p>
                </div>
                {activeMetric && <span className="text-[13px] font-semibold tabular-nums text-kumo-default">{formatMetric(activeMetric)}</span>}
              </div>
              <TrafficChart points={snapshot.traffic} metric={trendMetric} range={range} />
            </section>

            <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
              <ZoneRanking snapshot={snapshot} />
              <section aria-labelledby="attention-heading" className="rounded-2xl border border-kumo-line bg-kumo-base p-4 sm:p-5">
                <h2 id="attention-heading" className="m-0 text-[15px] font-semibold text-kumo-default">What needs attention</h2>
                <p className="mb-5 mt-1 text-[11px] leading-4 text-kumo-subtle">Highest-signal observations from this period</p>
                <div className="space-y-3">
                  <div className="rounded-xl bg-kumo-tint px-4 py-3">
                    <p className="m-0 text-[11px] font-medium text-kumo-subtle">Highest 5xx rate</p>
                    <p className="mb-0 mt-1 text-[14px] font-semibold text-kumo-default">{highestErrorZone?.name ?? 'No zone data'}</p>
                    {highestErrorZone && <p className="mb-0 mt-0.5 text-[11px] text-kumo-inactive">{highestErrorZone.errorRate.toFixed(2)}% across {formatNumber(highestErrorZone.requests, 'count')} requests</p>}
                  </div>
                  <div className="rounded-xl bg-kumo-tint px-4 py-3">
                    <p className="m-0 text-[11px] font-medium text-kumo-subtle">Largest traffic source</p>
                    <p className="mb-0 mt-1 text-[14px] font-semibold text-kumo-default">{snapshot.zones[0]?.name ?? 'No zone data'}</p>
                    {snapshot.zones[0] && <p className="mb-0 mt-0.5 text-[11px] text-kumo-inactive">{formatNumber(snapshot.zones[0].requests, 'count')} requests · {formatNumber(snapshot.zones[0].bandwidth, 'bytes')}</p>}
                  </div>
                  <p className="m-0 text-[10px] leading-4 text-kumo-inactive">These are descriptive signals, not automated incident declarations.</p>
                </div>
              </section>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <RankedAnalysis
                title="Security activity"
                subtitle={snapshot.securityActions.some(item => item.id === 'threats-detected')
                  ? 'Threat detections from range-aligned HTTP analytics'
                  : 'Firewall events ranked by action'}
                metric={snapshot.securityEvents}
                items={snapshot.securityActions}
              />
              <RankedAnalysis
                title="Workers activity"
                subtitle={`${formatMetric(snapshot.workerErrors)} invocation errors · scripts ranked by requests`}
                metric={snapshot.workerRequests}
                items={snapshot.workers}
                secondaryLabel="errors"
              />
            </div>

            <section aria-labelledby="services-heading">
              <h2 id="services-heading" className="mb-3 text-[14px] font-semibold text-kumo-default">Service footprint</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {snapshot.services.map(metric => (
                  <article key={metric.id} className="rounded-xl border border-kumo-line bg-kumo-base p-3">
                    <p className="m-0 truncate text-[11px] text-kumo-subtle">{metric.label}</p>
                    <p className="mb-0 mt-1 text-xl font-semibold tabular-nums text-kumo-default">{formatMetric(metric)}</p>
                  </article>
                ))}
              </div>
            </section>

            <p className="m-0 text-[10px] leading-4 text-kumo-inactive">Read-only analytics through the official Cloudflare API MCP. GraphQL figures are operational analytics, not billing totals.</p>
          </div>
        )}
      </main>
    </div>
  )
}
