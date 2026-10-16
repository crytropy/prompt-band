import { expect, test } from 'claude-code/testing'

import { cellWidth, current, hasLimits, isHot, mergeReading, mmss, percentText, untilText } from './format'

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
  expect(mmss(5 * 60 * 1000 - 1)).toBe('5:00')
  expect(mmss(61_001)).toBe('1:02')
})

test('CJK characters take two cells', async () => {
  expect(cellWidth('Week 12%')).toBe(8)
  expect(cellWidth('快取剩 52:13')).toBe(12)
  expect(cellWidth('，')).toBe(2)
})
