import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Point, Reading, Stamp } from '../types'
import {
  addPoint,
  cellWidth,
  current,
  forecastFor,
  hasLimits,
  isHot,
  limitsOf,
  mergeReading,
  mmss,
  modelWeekly,
  percentText,
  shortTokens,
  trendText,
} from './format'

const TTL_MS = 60 * 60 * 1000
const WARN_MS = 5 * 60 * 1000
const STORE_KEY = 'lastSentBySession'
const LIMITS_KEY = 'lastLimits'
const KEEP_SESSIONS = 20
const SEP = '   ·   '
// Fable's weekly window is not in the session's usage: read from the account's usage endpoint.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const FABLE = 'Fable'
const FETCH_EVERY_MS = 5 * 60 * 1000

const reading = atom({ plugin: 'prompt-band-ultra', key: 'reading' } as const, null as Reading | null)
const lastSentAt = atom({ plugin: 'prompt-band-ultra', key: 'lastSentAt' } as const, null as Stamp)
const warnedFor = atom({ plugin: 'prompt-band-ultra', key: 'warnedFor' } as const, null as Stamp)
const history = atom({ plugin: 'prompt-band-ultra', key: 'history' } as const, [] as Point[])

/** A piece of the usage row: its text and how it is painted. */
type Part = { text: string; color?: string; dim?: boolean; bold?: boolean }

// The rate-limit windows are the account's: the last ones seen, kept across sessions.
async function keptLimits($: EngineInterface): Promise<Reading | null> {
  const r = await read($, reading)
  if (hasLimits(r)) return r
  return ((await $.store.get(LIMITS_KEY)) ?? null) as Reading | null
}

async function apply($: EngineInterface, usage: Pick<SessionUsage, 'context' | 'rateLimits'>): Promise<void> {
  const merged = mergeReading(await keptLimits($), usage)
  await update($, reading, () => merged)
  if (usage.rateLimits.length > 0) await $.store.set(LIMITS_KEY, limitsOf(merged))
}

// A new turn adds a reading for the trend; a first reading (a resumed session) seeds it.
async function record($: EngineInterface, context: SessionUsage['context'], isNewTurn: boolean): Promise<void> {
  if (!context.tokens || !context.window) return
  const point = { tokens: context.tokens, window: context.window }
  await update($, history, h => (isNewTurn || h.length === 0 ? addPoint(h, point) : h))
}

let fetchedAt: number | null = null

// At most once every FETCH_EVERY_MS; a failed read keeps the last figure.
async function fetchFable($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (fetchedAt !== null && now - fetchedAt < FETCH_EVERY_MS) return
  fetchedAt = now
  try {
    const auth = await $.session.authorize()
    if (auth === null) return
    const res = await $.http.fetch(USAGE_URL, {
      auth: auth.handle,
      headers: { 'anthropic-beta': 'oauth-2025-04-20', 'Content-Type': 'application/json' },
    })
    if (!res.ok) return
    const w = modelWeekly(res.text, FABLE)
    if (w === null) return
    const prev = await keptLimits($)
    const next: Reading = {
      ...(await read($, reading)),
      ...(prev ? limitsOf(prev) : {}),
      fable: w.percent,
      fableResetsAt: w.resetsAt,
    }
    await update($, reading, () => next)
    await $.store.set(LIMITS_KEY, limitsOf(next))
  } catch {
    // keep the last figure
  }
}

async function refresh($: EngineInterface): Promise<void> {
  try {
    const usage = await $.session.usage()
    await apply($, usage)
    await record($, usage.context, false)
  } catch {
    // keep the last reading
  }
}

// Kept per session in $.store so a resumed session picks its countdown back up.
async function remember($: EngineInterface, at: number): Promise<void> {
  const id = await $.session.id()
  const saved = ((await $.store.get(STORE_KEY)) ?? {}) as Record<string, number>
  delete saved[id]
  const entries = [...Object.entries(saved), [id, at] as const].slice(-KEEP_SESSIONS)
  await $.store.set(STORE_KEY, Object.fromEntries(entries))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    await fetchFable($)

    if ((await read($, lastSentAt)) === null) {
      const saved = ((await $.store.get(STORE_KEY)) ?? {}) as Record<string, number>
      const at = saved[await $.session.id()]
      if (at !== undefined) {
        await update($, lastSentAt, () => at)
      }
    }

    $.clock.every(1000, async () => {
      const sent = await read($, lastSentAt)
      if (sent === null) return

      const left = sent + TTL_MS - (await $.clock.now())
      if (left > 0 && left <= WARN_MS && (await read($, warnedFor)) !== sent) {
        await update($, warnedFor, () => sent)
        const text = `主對話的快取剩 ${mmss(left)} 就過期，要續命就趁現在送一句`
        $.ui.toast(text)
        $.ui.notify(text, { title: 'Prompt cache' }).catch(() => undefined)
      }

      $.ui.invalidate('ui.render')
    })

    return result
  })

  // Each main-loop request reads and refreshes the cache; subagents' requests do not count.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const at = await $.clock.now()
      await update($, lastSentAt, () => at)
      await remember($, at)
    }

    return yield* next(e)
  })

  // The engine measures after each main-thread turn and when a window moves a point.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    await apply($, e)
    if (e.changed.includes('context')) await record($, e.context, true)
    await fetchFable($)
    return result
  })

  // A /clear starts a new conversation: nothing is cached for it yet, and its trend starts over.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, lastSentAt, () => null)
      await update($, warnedFor, () => null)
      await update($, history, () => [])
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    // Left: usage.
    const now = await $.clock.now()
    const r = current((await read($, reading)) ?? {}, now)
    const points = await read($, history)

    // Context as Token Weather: forecast, tokens of the window, the last turn's growth.
    const weather = (withTrend: boolean): Part[] => {
      if (r.context === undefined) return [{ text: 'Context --', dim: true }]
      const f = forecastFor(r.context)
      const parts: Part[] = [{ text: `${f.icon} ${f.word} ${percentText(r.context)}`, color: f.color, bold: true }]
      if (r.contextTokens !== undefined && r.contextWindow !== undefined) {
        parts.push({ text: `  ${shortTokens(r.contextTokens)}/${shortTokens(r.contextWindow)}`, dim: true })
      }
      const trend = trendText(points)
      if (withTrend && trend) parts.push({ text: `  ${trend}`, dim: true })
      return parts
    }
    const limit = (text: string, percent: number | undefined): Part[] => [
      { text, color: isHot(percent) ? 'error' : undefined, dim: !isHot(percent) },
    ]
    // Ultra has no five-hour limit. Fable's weekly window comes before the week, once the account reports one.
    const limits = [
      ...(r.fable !== undefined ? [limit(`${FABLE} ${percentText(r.fable)}`, r.fable)] : []),
      limit(`Week ${percentText(r.weekly)}`, r.weekly),
    ]
    const row = (groups: Part[][]): Part[] => groups.flatMap((g, n) => (n > 0 ? [{ text: SEP, dim: true }, ...g] : g))
    const textOf = (parts: Part[]) => parts.map(p => p.text).join('')

    // A narrow body drops the trend before it wraps.
    let usageParts = row([weather(true), ...limits])
    if (cellWidth(textOf(usageParts)) > e.props.bodyColumns) usageParts = row([weather(false), ...limits])
    const usageText = textOf(usageParts)
    const usage = usageParts.map((p, n) => (
      <Text key={`u${n}`} color={p.color} dimColor={p.dim ?? false} weight={p.bold ? 'bold' : 'regular'}>
        {p.text}
      </Text>
    ))

    // Right: the cache countdown, once the main loop has sent a request.
    const sent = await read($, lastSentAt)
    let cacheText = ''
    let cache = null
    if (sent !== null) {
      const left = sent + TTL_MS - (await $.clock.now())
      if (left <= 0) {
        const cell = ' 快取已過期 '
        cacheText = cell
        cache = [
          <Text key="cell" backgroundColor="error" color="inverseText" weight="bold">
            {cell}
          </Text>,
        ]
      } else {
        const isNear = left <= WARN_MS
        const cell = `快取剩 ${mmss(left)}`
        const note = isNear ? ' · 快過期了，要續命就趁現在送一句' : ''
        cacheText = cell + note
        cache = [
          <Text key="cell" color={isNear ? 'warning' : 'subtle'} weight={isNear ? 'bold' : 'regular'}>
            {cell}
          </Text>,
          ...(isNear
            ? [
                <Text key="note" color="warning">
                  {note}
                </Text>,
              ]
            : []),
        ]
      }
    }

    const fits = cache === null || cellWidth(usageText) + 2 + cellWidth(cacheText) <= e.props.bodyColumns

    const band = fits ? (
      <Box key="row" flexDirection="row" justifyContent="space-between">
        <Box key="usage" flexDirection="row">
          {usage}
        </Box>
        {cache === null ? null : (
          <Box key="cache" flexDirection="row">
            {cache}
          </Box>
        )}
      </Box>
    ) : (
      <Box key="rows" flexDirection="column">
        <Box key="usage" flexDirection="row">
          {usage}
        </Box>
        <Box key="cache" flexDirection="row" justifyContent="flex-end">
          {cache}
        </Box>
      </Box>
    )

    // The band is shared: keep what the plugins beneath draw under this one.
    return (
      <Box flexDirection="column">
        {band}
        {await next(e)}
      </Box>
    )
  })
}
