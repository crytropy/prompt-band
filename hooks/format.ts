import type { SessionUsage } from 'claude-code'

import type { Limits, Reading } from '../types'

export const RED_AT = 80

export function isHot(percent: number | undefined): boolean {
  return percent !== undefined && percent > RED_AT
}

export function percentText(percent: number | undefined): string {
  return percent === undefined ? '--' : `${Math.round(percent)}%`
}

/** Time until `resetsAt`, as "3h12m", "45m" or "<1m". */
export function untilText(resetsAt: string | undefined, now: number): string | undefined {
  if (resetsAt === undefined) return undefined
  const ms = Date.parse(resetsAt) - now
  if (Number.isNaN(ms)) return undefined
  const minutes = Math.max(0, Math.floor(ms / 60000))
  if (minutes < 1) return '<1m'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`
}

/**
 * The new figures over the old: a rate-limit window the usage leaves out (a new
 * session before its first response) keeps its old figure.
 */
export function mergeReading(prev: Reading | null, usage: Pick<SessionUsage, 'context' | 'rateLimits'>): Reading {
  const five = usage.rateLimits.find(r => r.kind === 'five_hour')
  const week = usage.rateLimits.find(r => r.kind === 'seven_day')
  return {
    context: usage.context.percent,
    fiveHour: five ? five.percentUsed : prev?.fiveHour,
    fiveHourResetsAt: five ? five.resetsAt : prev?.fiveHourResetsAt,
    weekly: week ? week.percentUsed : prev?.weekly,
    weeklyResetsAt: week ? week.resetsAt : prev?.weeklyResetsAt,
  }
}

export function hasLimits(r: Reading | null | undefined): boolean {
  return r?.fiveHour !== undefined || r?.weekly !== undefined
}

export function limitsOf(r: Reading): Limits {
  const { fiveHour, fiveHourResetsAt, weekly, weeklyResetsAt } = r
  return { fiveHour, fiveHourResetsAt, weekly, weeklyResetsAt }
}

/** A kept figure whose window has since reset no longer holds: drop it. */
export function current(r: Reading, now: number): Reading {
  const isPast = (at: string | undefined) => at !== undefined && Date.parse(at) <= now
  return {
    ...r,
    ...(isPast(r.fiveHourResetsAt) ? { fiveHour: undefined, fiveHourResetsAt: undefined } : {}),
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
