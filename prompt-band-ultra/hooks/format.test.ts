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
  percentText,
  shortTokens,
  trendText,
} from './format'

test('red only above 80%', async () => {
  expect(isHot(80)).toBe(false)
  expect(isHot(80.5)).toBe(true)
  expect(isHot(undefined)).toBe(false)
})

test('percent text', async () => {
  expect(percentText(42.4)).toBe('42%')
  expect(percentText(undefined)).toBe('--')
})

test('reading from usage leaves the five-hour window out', async () => {
  const r = mergeReading(null, {
    context: { window: 200000, tokens: 50000, percent: 25 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 85, resetsAt: '2026-10-16T11:30:00Z' },
      { kind: 'seven_day', percentUsed: 12, resetsAt: '2026-10-20T00:00:00Z' },
    ],
  })
  expect(r.context).toBe(25)
  expect('fiveHour' in r).toBe(false)
  expect(r.weekly).toBe(12)
  expect(hasLimits(r)).toBe(true)
  expect(hasLimits({ context: 25 })).toBe(false)
})

test('usage without rate limits keeps the old figures, context does not carry over', async () => {
  const prev = { context: 60, weekly: 12 }
  const r = mergeReading(prev, { context: { window: 200000 }, rateLimits: [] })
  expect(r.context).toBeUndefined()
  expect(r.weekly).toBe(12)
})

test('a kept figure is dropped once its window has reset', async () => {
  const r = { weekly: 12, weeklyResetsAt: '2026-10-20T00:00:00Z' }
  expect(current(r, Date.parse('2026-10-19T23:00:00Z')).weekly).toBe(12)
  expect(current(r, Date.parse('2026-10-20T00:00:00Z')).weekly).toBeUndefined()
})

test('countdown text rounds up to the second', async () => {
  expect(mmss(60 * 60 * 1000)).toBe('60:00')
  expect(mmss(5 * 60 * 1000 - 1)).toBe('5:00')
  expect(mmss(61_001)).toBe('1:02')
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
