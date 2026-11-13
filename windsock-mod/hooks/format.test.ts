import { expect, test } from 'claude-code/testing'

import {
  addPoint,
  cellWidth,
  current,
  forecastFor,
  hasLimits,
  HISTORY,
  isHot,
  mergeReading,
  mmss,
  modelWeekly,
  percentText,
  prStatus,
  prText,
  shortTokens,
  trendText,
  untilText,
} from './format'

test('red only above 80%', async () => {
  expect(isHot(80)).toBe(false)
  expect(isHot(80.5)).toBe(true)
  expect(isHot(undefined)).toBe(false)
})

test('percent and reset text', async () => {
  expect(percentText(42.4)).toBe('42%')
  expect(percentText(undefined)).toBe('--')
  const now = Date.parse('2026-10-16T10:00:00Z')
  expect(untilText('2026-10-16T13:05:30Z', now)).toBe('3h05m')
  expect(untilText('2026-10-16T10:20:00Z', now)).toBe('20m')
  expect(untilText('2026-10-16T09:00:00Z', now)).toBe('<1m')
})

test('reading from usage', async () => {
  const r = mergeReading(null, {
    context: { window: 200000, tokens: 50000, percent: 25 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 85, resetsAt: '2026-10-16T11:30:00Z' },
      { kind: 'seven_day', percentUsed: 12, resetsAt: '2026-10-20T00:00:00Z' },
    ],
  })
  expect(r.context).toBe(25)
  expect(r.fiveHour).toBe(85)
  expect(r.fiveHourResetsAt).toBe('2026-10-16T11:30:00Z')
  expect(r.weekly).toBe(12)
  expect(hasLimits(r)).toBe(true)
  expect(hasLimits({ context: 25 })).toBe(false)
})

test('usage without rate limits keeps the old figures, context does not carry over', async () => {
  const prev = { context: 60, fiveHour: 40, fiveHourResetsAt: '2026-10-16T11:30:00Z', weekly: 12 }
  const r = mergeReading(prev, { context: { window: 200000 }, rateLimits: [] })
  expect(r.context).toBeUndefined()
  expect(r.fiveHour).toBe(40)
  expect(r.fiveHourResetsAt).toBe('2026-10-16T11:30:00Z')
  expect(r.weekly).toBe(12)
})

test('a kept figure is dropped once its window has reset', async () => {
  const r = { fiveHour: 40, fiveHourResetsAt: '2026-10-16T11:30:00Z', weekly: 12, weeklyResetsAt: '2026-10-20T00:00:00Z' }
  expect(current(r, Date.parse('2026-10-16T11:00:00Z')).fiveHour).toBe(40)
  const after = current(r, Date.parse('2026-10-16T11:30:00Z'))
  expect(after.fiveHour).toBeUndefined()
  expect(after.weekly).toBe(12)
})

test('countdown text rounds up to the second', async () => {
  expect(mmss(60 * 60 * 1000)).toBe('60:00')
  expect(mmss(5 * 60 * 1000 - 1)).toBe('05:00')
  expect(mmss(61_001)).toBe('01:02')
  // Run out, it stays at zero.
  expect(mmss(0)).toBe('00:00')
  expect(mmss(-90_000)).toBe('00:00')
})

test('CJK characters take two cells', async () => {
  expect(cellWidth('Week 12%')).toBe(8)
  expect(cellWidth('快取剩 52:13')).toBe(12)
  expect(cellWidth('，')).toBe(2)
})

test('Token Weather: forecast bands, trend, short tokens', async () => {
  expect(forecastFor(0).word).toBe('Clear')
  expect(forecastFor(25).word).toBe('Cloudy')
  expect(forecastFor(74).word).toBe('Showers')
  expect(forecastFor(89).word).toBe('Storm')
  expect(forecastFor(90).word).toBe('Compact soon')

  const h = [20000, 80000, 160000].reduce((acc, tokens) => addPoint(acc, { tokens, window: 200000 }), [] as { tokens: number; window: number }[])
  expect(trendText(h)).toBe('▲ +80k')
  expect(trendText(h.slice(0, 1))).toBe('')
  expect(trendText([h[2], h[1]])).toBe('▼ 80k')
  expect(trendText([h[1], h[1]])).toBe('steady')

  let long: { tokens: number; window: number }[] = []
  for (let i = 1; i <= 15; i++) long = addPoint(long, { tokens: i, window: 100 })
  expect(long.length).toBe(HISTORY)
  expect(long[0].tokens).toBe(4)

  expect(shortTokens(134400)).toBe('134.4k')
  expect(shortTokens(200000)).toBe('200k')
  expect(shortTokens(1000000)).toBe('1M')
  expect(shortTokens(512)).toBe('512')
})

test('Fable weekly window from the usage endpoint', async () => {
  const body = JSON.stringify({
    seven_day: { utilization: 47, resets_at: '2026-11-16T00:00:00Z' },
    limits: [
      { kind: 'weekly_scoped', scope: { model: { display_name: 'Opus' } }, percent: 10, resets_at: 1763251200 },
      { kind: 'weekly_scoped', scope: { model: { display_name: 'Fable' } }, percent: 23.5, resets_at: 1763251200 },
    ],
  })
  expect(modelWeekly(body, 'Fable')).toEqual({ percent: 23.5, resetsAt: '2025-11-16T00:00:00.000Z' })
  expect(modelWeekly(JSON.stringify({ limits: [{ kind: 'weekly_scoped', scope: { model: { display_name: 'fable' } }, percent: 5, resets_at: '2026-11-16T00:00:00Z' }] }), 'Fable')).toEqual({ percent: 5, resetsAt: '2026-11-16T00:00:00Z' })
  expect(modelWeekly(JSON.stringify({ seven_day: {} }), 'Fable')).toEqual({})
  expect(modelWeekly(JSON.stringify({ limits: [] }), 'Fable')).toEqual({})
  expect(modelWeekly('not json', 'Fable')).toBeNull()
})

test('pull request from gh: checks running, ready to merge, merged, nothing otherwise', async () => {
  const url = 'https://github.com/acme/app/pull/12'
  const view = { number: 12, url, state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' }
  const run = (status: string, conclusion: string) => ({ __typename: 'CheckRun', status, conclusion })
  const status = (state: string) => ({ __typename: 'StatusContext', state })
  const of = (pr: object) => prStatus(JSON.stringify(pr))

  expect(of({ ...view, statusCheckRollup: [run('COMPLETED', 'SUCCESS'), run('QUEUED', '')] })).toEqual({ kind: 'running', number: 12, url })
  expect(of({ ...view, statusCheckRollup: [status('PENDING')] })).toEqual({ kind: 'running', number: 12, url })
  expect(of({ ...view, statusCheckRollup: [run('COMPLETED', 'SUCCESS'), run('COMPLETED', 'SKIPPED'), status('SUCCESS')] })).toEqual({ kind: 'ready', number: 12, url })
  // No checks at all: none is failing.
  expect(of({ ...view, statusCheckRollup: [] })).toEqual({ kind: 'ready', number: 12, url })
  expect(of({ ...view, state: 'MERGED', mergeable: 'UNKNOWN', statusCheckRollup: [run('COMPLETED', 'FAILURE')] })).toEqual({ kind: 'merged', number: 12, url })

  expect(of({ ...view, statusCheckRollup: [run('COMPLETED', 'FAILURE')] })).toBeNull()
  expect(of({ ...view, statusCheckRollup: [status('ERROR')] })).toBeNull()
  expect(of({ ...view, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', statusCheckRollup: [] })).toBeNull()
  expect(of({ ...view, mergeStateStatus: 'BLOCKED', statusCheckRollup: [] })).toBeNull()
  expect(of({ ...view, isDraft: true, statusCheckRollup: [run('IN_PROGRESS', '')] })).toBeNull()
  expect(of({ ...view, state: 'CLOSED', statusCheckRollup: [] })).toBeNull()
  // Not a pull request, or a link that is not a web page.
  expect(prStatus('no pull requests found')).toBeNull()
  expect(of({ ...view, url: 'javascript:alert(1)' })).toBeNull()
  expect(of({ state: 'OPEN' })).toBeNull()

  expect(prText({ kind: 'running', number: 12, url })).toBe('◐ PR #12')
  expect(prText({ kind: 'ready', number: 12, url })).toBe('✓ PR #12')
  expect(prText({ kind: 'merged', number: 7, url })).toBe('● PR #7')
})
