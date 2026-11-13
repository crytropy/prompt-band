import type { SessionUsage } from 'claude-code'

import type { Limits, Point, Pr, Reading } from '../types'

export const RED_AT = 80
export const HISTORY = 12

// Token Weather's forecast bands, by percent of the window used.
// Single-width text symbols, not emoji: they line up in every terminal font.
export const FORECAST = [
  { upTo: 25, icon: '☀', word: 'Clear', color: 'yellow' },
  { upTo: 50, icon: '☁', word: 'Cloudy', color: 'cyan' },
  { upTo: 75, icon: '☂', word: 'Showers', color: 'blue' },
  { upTo: 90, icon: '☇', word: 'Storm', color: 'magenta' },
  { upTo: Infinity, icon: '↯', word: 'Compact soon', color: 'error' },
] as const

export function forecastFor(percent: number): (typeof FORECAST)[number] {
  return FORECAST.find(f => percent < f.upTo) ?? FORECAST[FORECAST.length - 1]
}

/** The history with a new reading last, at most HISTORY long. */
export function addPoint(history: Point[], point: Point): Point[] {
  return [...history, point].slice(-HISTORY)
}

/** What the last turn added, as "▲ +98.3k", "▼ 12k" or "steady"; empty with fewer than two readings. */
export function trendText(history: Point[]): string {
  if (history.length < 2) return ''
  const delta = history[history.length - 1].tokens - history[history.length - 2].tokens
  if (delta > 0) return `▲ +${shortTokens(delta)}`
  if (delta < 0) return `▼ ${shortTokens(-delta)}`
  return 'steady'
}

/** Tokens as "134.4k", "200k" or "1M". */
export function shortTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`
  return String(n)
}

export function isHot(percent: number | undefined): boolean {
  return percent !== undefined && percent > RED_AT
}

export function percentText(percent: number | undefined): string {
  return percent === undefined ? '--' : `${Math.round(percent)}%`
}

/**
 * The new figures over the old: a weekly window the usage leaves out (a new
 * session before its first response) keeps its old figure. Ultra has no
 * five-hour limit, so a `five_hour` window (an account not yet verified) is left out.
 */
export function mergeReading(prev: Reading | null, usage: Pick<SessionUsage, 'context' | 'rateLimits'>): Reading {
  const week = usage.rateLimits.find(r => r.kind === 'seven_day')
  return {
    context: usage.context.percent,
    contextTokens: usage.context.tokens,
    contextWindow: usage.context.window,
    weekly: week ? week.percentUsed : prev?.weekly,
    weeklyResetsAt: week ? week.resetsAt : prev?.weeklyResetsAt,
    // The session's usage has no per-model window: Fable comes from the usage endpoint alone.
    fable: prev?.fable,
    fableResetsAt: prev?.fableResetsAt,
  }
}

export function hasLimits(r: Reading | null | undefined): boolean {
  return r?.weekly !== undefined || r?.fable !== undefined
}

export function limitsOf(r: Reading): Limits {
  const { weekly, weeklyResetsAt, fable, fableResetsAt } = r
  return { weekly, weeklyResetsAt, fable, fableResetsAt }
}

/**
 * A model's weekly window from the account's usage (`/api/oauth/usage`): its
 * `weekly_scoped` entry in `limits` whose model is named `model`. `{}` when the
 * account has no such window, null when the body is not usage.
 */
export function modelWeekly(body: string, model: string): { percent?: number; resetsAt?: string } | null {
  let usage: unknown
  try {
    usage = JSON.parse(body)
  } catch {
    return null
  }
  if (usage === null || typeof usage !== 'object') return null
  const limits = (usage as { limits?: unknown }).limits
  if (!Array.isArray(limits)) return {}
  const entry = limits.find(
    (l: any) =>
      l !== null &&
      typeof l === 'object' &&
      l.kind === 'weekly_scoped' &&
      typeof l.scope?.model?.display_name === 'string' &&
      l.scope.model.display_name.toLowerCase() === model.toLowerCase(),
  ) as { percent?: unknown; resets_at?: unknown } | undefined
  if (entry === undefined || typeof entry.percent !== 'number') return {}
  const at = entry.resets_at
  const resetsAt =
    typeof at === 'number' ? new Date(at * 1000).toISOString() : typeof at === 'string' ? at : undefined
  return { percent: entry.percent, ...(resetsAt !== undefined ? { resetsAt } : {}) }
}

/** A kept figure whose window has since reset no longer holds: drop it. */
export function current(r: Reading, now: number): Reading {
  const isPast = (at: string | undefined) => at !== undefined && Date.parse(at) <= now
  return {
    ...r,
    ...(isPast(r.weeklyResetsAt) ? { weekly: undefined, weeklyResetsAt: undefined } : {}),
    ...(isPast(r.fableResetsAt) ? { fable: undefined, fableResetsAt: undefined } : {}),
  }
}

/** Milliseconds as "52:13" or "04:59", rounded up to the second; a time that has run out stays "00:00". */
export function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// The three pull-request states the band draws; any other draws nothing.
export const PR_MARK = {
  running: { icon: '◐', color: 'warning' },
  ready: { icon: '✓', color: 'success' },
  merged: { icon: '●', color: 'merged' },
} as const

/** A pull request as the band names it: "✓ PR #12". */
export function prText(pr: Pr): string {
  return `${PR_MARK[pr.kind].icon} PR #${pr.number}`
}

// A check that is not one of these has failed.
const PASSED = ['SUCCESS', 'NEUTRAL', 'SKIPPED']
// GitHub will not merge a pull request in one of these states.
const BLOCKED = ['BLOCKED', 'DIRTY', 'DRAFT', 'BEHIND']

/**
 * The current branch's pull request from `gh pr view --json
 * number,url,state,isDraft,mergeable,mergeStateStatus,statusCheckRollup`:
 * merged, its checks still running, or its checks passed and mergeable (a pull
 * request with no checks has none failing). Null for any other state (a draft,
 * a failed check, a conflict, closed) and for a body that is no pull request.
 */
export function prStatus(body: string): Pr | null {
  let pr: any
  try {
    pr = JSON.parse(body)
  } catch {
    return null
  }
  if (pr === null || typeof pr !== 'object') return null
  const { number, url } = pr
  if (!Number.isInteger(number) || typeof url !== 'string' || !url.startsWith('https://')) return null
  if (pr.state === 'MERGED') return { kind: 'merged', number, url }
  if (pr.state !== 'OPEN' || pr.isDraft === true) return null

  // A check run has a status and a conclusion; a commit status has a state alone.
  const checks: any[] = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup.filter((c: unknown) => c !== null && typeof c === 'object') : []
  const isRunning = (c: any) => (typeof c.status === 'string' ? c.status !== 'COMPLETED' : c.state === 'PENDING' || c.state === 'EXPECTED')
  const hasPassed = (c: any) => PASSED.includes(typeof c.status === 'string' ? c.conclusion : c.state)
  if (checks.some(isRunning)) return { kind: 'running', number, url }
  if (!checks.every(hasPassed)) return null
  if (pr.mergeable !== 'MERGEABLE' || BLOCKED.includes(pr.mergeStateStatus)) return null
  return { kind: 'ready', number, url }
}

/** Terminal cells a text takes: CJK and full-width characters take two. */
export function cellWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    const isWide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6)
    width += isWide ? 2 : 1
  }
  return width
}
