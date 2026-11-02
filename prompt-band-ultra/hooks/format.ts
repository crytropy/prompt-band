import type { SessionUsage } from 'claude-code'

import type { Limits, Point, Reading } from '../types'

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
  }
}

export function hasLimits(r: Reading | null | undefined): boolean {
  return r?.weekly !== undefined
}

export function limitsOf(r: Reading): Limits {
  const { weekly, weeklyResetsAt } = r
  return { weekly, weeklyResetsAt }
}

/** A kept figure whose window has since reset no longer holds: drop it. */
export function current(r: Reading, now: number): Reading {
  const isPast = (at: string | undefined) => at !== undefined && Date.parse(at) <= now
  return {
    ...r,
    ...(isPast(r.weeklyResetsAt) ? { weekly: undefined, weeklyResetsAt: undefined } : {}),
  }
}

/** Milliseconds as "52:13", rounded up to the second. */
export function mmss(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
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
