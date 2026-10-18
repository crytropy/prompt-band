import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Reading, Stamp } from '../types'
import { cellWidth, current, hasLimits, isHot, limitsOf, mergeReading, mmss, percentText, untilText } from './format'

const TTL_MS = 60 * 60 * 1000
const WARN_MS = 5 * 60 * 1000
const STORE_KEY = 'lastSentBySession'
const LIMITS_KEY = 'lastLimits'
const KEEP_SESSIONS = 20
const SEP = '  ·  '

const reading = atom({ plugin: 'prompt-band', key: 'reading' } as const, null as Reading | null)
const lastSentAt = atom({ plugin: 'prompt-band', key: 'lastSentAt' } as const, null as Stamp)
const warnedFor = atom({ plugin: 'prompt-band', key: 'warnedFor' } as const, null as Stamp)

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

async function refresh($: EngineInterface): Promise<void> {
  try {
    await apply($, await $.session.usage())
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
    return result
  })

  // A /clear starts a new conversation: nothing is cached for it yet.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, lastSentAt, () => null)
      await update($, warnedFor, () => null)
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
    const resets = untilText(r.fiveHourResetsAt, now)
    const items = [
      { key: 'ctx', text: `Context ${percentText(r.context)}`, percent: r.context },
      {
        key: '5h',
        text: `5h ${percentText(r.fiveHour)}${resets ? ` (resets in ${resets})` : ''}`,
        percent: r.fiveHour,
      },
      { key: 'wk', text: `Week ${percentText(r.weekly)}`, percent: r.weekly },
    ]
    const usageText = items.map(i => i.text).join(SEP)
    const usage = items.flatMap((i, n) => [
      ...(n > 0
        ? [
            <Text key={`s${n}`} dimColor>
              {SEP}
            </Text>,
          ]
        : []),
      <Text key={i.key} color={isHot(i.percent) ? 'error' : undefined} dimColor={!isHot(i.percent)}>
        {i.text}
      </Text>,
    ])

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
