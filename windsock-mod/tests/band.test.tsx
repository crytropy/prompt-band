import { expect, mock, test } from 'claude-code/testing'

const T0 = Date.parse('2026-10-16T10:00:00Z')
const MIN = 60_000

const band = (surface: 'terminal' | 'desktop', bodyColumns = 120) => ({
  plugin: 'windsock-mod',
  surface,
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
})

const step = async ($: any, agentId?: string) => {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1, ...(agentId ? { agentId } : {}) })
  for await (const _ of stream) {
  }
}

test('usage on the left, the cache countdown on the right: the time alone, yellow at 5 minutes with a toast, red at 1 minute, 00:00 once run out', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined } as any
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-1' }) as any)
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000, tokens: 60000, percent: 30 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 85, resetsAt: '2026-10-16T11:30:00Z' },
        { kind: 'seven_day', percentUsed: 12 },
      ],
    },
  }))
  on('ui.render', ($, e) => {
    // Stands for another plugin's band beneath this one.
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
  on('ui.invalidate', () => ({ value: undefined }) as any)
  on('ui.notify', () => ({ value: { isSent: false, reason: 'no-surface' } }) as any)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface))
    expect((await ui.find({ type: 'Text', text: /Cloudy/ }))?.text).toBe('☁ Cloudy 30%')
    expect(await ui.find({ type: 'Text', text: '  60k/200k' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /5h/ }))?.text).toBe('5h 85% (resets in 1h30m)')
    expect(await ui.find({ type: 'Text', text: /^\d\d:\d\d$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
    await ui.unmount()
  }

  await step($)
  await clock.advance(10 * MIN)
  // A subagent's request does not refresh the countdown.
  await step($, 'agent-1')

  for (const surface of ['terminal', 'desktop'] as const) {
    const wide = await $.ui.mount(band(surface, 120))
    expect((await wide.find({ type: 'Text', text: '50:00' }))?.props.color).toBe('subtle')
    expect(await wide.find({ text: /快取/ })).toBeUndefined()
    expect((await wide.find({ type: 'Text', text: /Week/ }))?.text).toBe('Week 12%')
    const wideTree = JSON.stringify(await wide.drawn())
    expect(wideTree).toContain('space-between')
    expect(wideTree).not.toContain('flex-end')
    await wide.unmount()

    const narrow = await $.ui.mount(band(surface, 40))
    expect(await narrow.find({ type: 'Text', text: '50:00' })).toBeDefined()
    const narrowTree = JSON.stringify(await narrow.drawn())
    expect(narrowTree).toContain('flex-end')
    expect(narrowTree).not.toContain('space-between')
    await narrow.unmount()
  }

  await clock.advance(45 * MIN + 1000)
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('05:00')
  await clock.advance(30_000)
  expect(toasts.length).toBe(1)

  // Yellow in the last five minutes, the time alone: no note beside it.
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface))
    expect((await ui.find({ type: 'Text', text: '04:29' }))?.props.color).toBe('warning')
    expect(await ui.find({ text: /續命/ })).toBeUndefined()
    await ui.unmount()
  }

  // Red in the last minute.
  await clock.advance(4 * MIN)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface))
    expect((await ui.find({ type: 'Text', text: '00:29' }))?.props.color).toBe('error')
    await ui.unmount()
  }

  // Run out: it stays 00:00, red, and says nothing else.
  await clock.advance(1 * MIN)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface))
    expect((await ui.find({ type: 'Text', text: '00:00' }))?.props.color).toBe('error')
    expect(await ui.find({ text: /快取/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Cloudy/ })).toBeDefined()
    await ui.unmount()
  }

  // The next main-loop request starts a fresh hour.
  await step($)
  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: '60:00' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
  await ui.unmount()
})

test('5h and Week keep the last figures across sessions until a measurement brings new ones', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  // What an earlier session left in the store.
  const store: Record<string, any> = {
    lastLimits: { fiveHour: 40, fiveHourResetsAt: '2026-10-16T11:30:00Z', weekly: 12, weeklyResetsAt: '2026-10-20T00:00:00Z' },
  }
  on('store.get', (_$, e: any) => ({ value: store[e.key] }) as any)
  on('store.set', (_$, e: any) => {
    store[e.key] = e.value
    return { value: undefined } as any
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-2' }) as any)
  // A new session before its first response: no rate limits yet.
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
  on('ui.invalidate', () => ({ value: undefined }) as any)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  let ui = await $.ui.mount(band('desktop'))
  expect((await ui.find({ type: 'Text', text: /Context/ }))?.text).toBe('Context --')
  expect((await ui.find({ type: 'Text', text: /5h/ }))?.text).toBe('5h 40% (resets in 1h30m)')
  expect((await ui.find({ type: 'Text', text: /Week/ }))?.text).toBe('Week 12%')
  await ui.unmount()

  // A measurement without rate limits leaves them alone.
  await $.session.measure({ context: { window: 200000, tokens: 20000, percent: 10 }, rateLimits: [], changed: ['context'] })
  ui = await $.ui.mount(band('desktop'))
  expect((await ui.find({ type: 'Text', text: /Clear/ }))?.text).toBe('☀ Clear 10%')
  expect((await ui.find({ type: 'Text', text: /5h/ }))?.text).toBe('5h 40% (resets in 1h30m)')
  await ui.unmount()

  await $.session.measure({
    context: { window: 200000, tokens: 20000, percent: 10 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 47, resetsAt: '2026-10-16T11:30:00Z' },
      { kind: 'seven_day', percentUsed: 13, resetsAt: '2026-10-20T00:00:00Z' },
    ],
    changed: ['rateLimits'],
  })
  ui = await $.ui.mount(band('desktop'))
  expect((await ui.find({ type: 'Text', text: /5h/ }))?.text).toBe('5h 47% (resets in 1h30m)')
  expect((await ui.find({ type: 'Text', text: /Week/ }))?.text).toBe('Week 13%')
  await ui.unmount()
  expect(store.lastLimits.fiveHour).toBe(47)

  // Past the five-hour reset the kept figure no longer holds.
  await clock.advance(90 * MIN)
  ui = await $.ui.mount(band('desktop'))
  expect((await ui.find({ type: 'Text', text: /5h/ }))?.text).toBe('5h --')
  expect((await ui.find({ type: 'Text', text: /Week/ }))?.text).toBe('Week 13%')
  await ui.unmount()
})

test('context reads as Token Weather: the last turn growth, no trend when narrow', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-3' }) as any)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
  on('ui.invalidate', () => ({ value: undefined }) as any)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const measure = (tokens: number, changed: ('context' | 'rateLimits')[] = ['context']) =>
    $.session.measure({ context: { window: 200000, tokens, percent: (tokens / 200000) * 100 }, rateLimits: [], changed })

  await measure(20000)
  await measure(80000)
  // A measurement for the limits alone adds no reading.
  await measure(80000, ['rateLimits'])
  await measure(160000)

  let ui = await $.ui.mount(band('terminal', 120))
  expect((await ui.find({ type: 'Text', text: /Storm/ }))?.text).toBe('☇ Storm 80%')
  expect(await ui.find({ type: 'Text', text: '  160k/200k' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /[▁▄█]/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '  ▲ +80k' })).toBeDefined()
  await ui.unmount()

  ui = await $.ui.mount(band('terminal', 45))
  expect(await ui.find({ type: 'Text', text: /Storm/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▲/ })).toBeUndefined()
  await ui.unmount()

  await measure(190000)
  ui = await $.ui.mount(band('terminal', 120))
  expect((await ui.find({ type: 'Text', text: /Compact soon/ }))?.text).toBe('↯ Compact soon 95%')
  await ui.unmount()
})

test('Fable weekly comes before Week, read from the usage endpoint at most every five minutes', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const store: Record<string, any> = {}
  on('store.get', (_$, e: any) => ({ value: store[e.key] }) as any)
  on('store.set', (_$, e: any) => {
    store[e.key] = e.value
    return { value: undefined } as any
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-4' }) as any)
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1000000, tokens: 540200, percent: 54 }, rateLimits: [{ kind: 'seven_day', percentUsed: 47 }] },
  }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }) as any)
  let fable = 23
  const fetched: { url: string; init: any }[] = []
  on('http.fetch', (_$, e: any) => {
    fetched.push(e)
    const text = JSON.stringify({ limits: [{ kind: 'weekly_scoped', scope: { model: { display_name: 'Fable' } }, percent: fable, resets_at: '2026-10-20T00:00:00Z' }] })
    return { value: { status: 200, ok: true, headers: {}, text } } as any
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
  on('ui.invalidate', () => ({ value: undefined }) as any)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(fetched.length).toBe(1)
  expect(fetched[0].url).toBe('https://api.anthropic.com/api/oauth/usage')
  expect(fetched[0].init.auth).toBe('h')

  let ui = await $.ui.mount(band('terminal', 120))
  expect((await ui.find({ type: 'Text', text: /Fable/ }))?.text).toBe('Fable 23%')
  const texts = JSON.stringify(await ui.drawn())
  expect(texts.indexOf('Fable 23%')).toBeLessThan(texts.indexOf('Week 47%'))
  await ui.unmount()
  expect(store.lastLimits.fable).toBe(23)

  // A measurement within five minutes does not ask again.
  fable = 30
  const measure = () =>
    $.session.measure({ context: { window: 1000000, tokens: 540200, percent: 54 }, rateLimits: [{ kind: 'seven_day', percentUsed: 47 }], changed: ['rateLimits'] })
  await measure()
  expect(fetched.length).toBe(1)
  ui = await $.ui.mount(band('terminal', 120))
  expect((await ui.find({ type: 'Text', text: /Fable/ }))?.text).toBe('Fable 23%')
  await ui.unmount()

  await clock.advance(5 * MIN)
  await measure()
  expect(fetched.length).toBe(2)
  ui = await $.ui.mount(band('terminal', 120))
  expect((await ui.find({ type: 'Text', text: /Fable/ }))?.text).toBe('Fable 30%')
  await ui.unmount()
})

test('no Fable window: no Fable group', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-5' }) as any)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [{ kind: 'seven_day', percentUsed: 12 }] } }))
  on('session.authorize', () => ({ value: null }) as any)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
  on('ui.invalidate', () => ({ value: undefined }) as any)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(band('terminal', 120))
  expect(await ui.find({ type: 'Text', text: /Fable/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /Week/ }))?.text).toBe('Week 12%')
  await ui.unmount()
})

test('the branch pull request is a link left of the countdown: checks running, ready to merge, merged, nothing otherwise', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-6' }) as any)
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000, tokens: 60000, percent: 30 }, rateLimits: [{ kind: 'seven_day', percentUsed: 12 }] },
  }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  // What `gh pr view --json ...` prints for the branch.
  const view = { number: 12, url: 'https://github.com/acme/app/pull/12', state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' }
  const check = (status: string, conclusion: string) => ({ __typename: 'CheckRun', status, conclusion })
  let answer = { exitCode: 0, stdout: JSON.stringify({ ...view, statusCheckRollup: [check('COMPLETED', 'SUCCESS'), check('IN_PROGRESS', '')] }) }
  const ran: string[][] = []
  on('process.run', (_$, e: any) => {
    ran.push([...e.argv])
    return { value: { ...answer, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as any
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
  on('ui.invalidate', () => ({ value: undefined }) as any)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  const measure = () =>
    $.session.measure({ context: { window: 200000, tokens: 60000, percent: 30 }, rateLimits: [{ kind: 'seven_day', percentUsed: 12 }], changed: ['rateLimits'] })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(ran.length).toBe(1)
  expect(ran[0].slice(0, 4)).toEqual(['gh', 'pr', 'view', '--json'])

  // Before the first request there is no countdown: the pull request stands alone on the right.
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface))
    expect((await ui.find({ type: 'Link' }))?.props.href).toBe('https://github.com/acme/app/pull/12')
    const mark = await ui.find({ type: 'Text', text: /PR #12/ })
    expect(mark?.text).toBe('◐ PR #12')
    expect(mark?.props.color).toBe('warning')
    expect(await ui.find({ type: 'Text', text: /^\d\d:\d\d$/ })).toBeUndefined()
    await ui.unmount()
  }

  await step($)
  let ui = await $.ui.mount(band('terminal', 120))
  let tree = JSON.stringify(await ui.drawn())
  expect(tree.indexOf('Week 12%')).toBeLessThan(tree.indexOf('PR #12'))
  expect(tree.indexOf('PR #12')).toBeLessThan(tree.indexOf('60:00'))
  expect(tree).toContain('space-between')
  await ui.unmount()

  // Too narrow for one row: the pull request and the countdown go under the usage, to the right.
  ui = await $.ui.mount(band('terminal', 40))
  tree = JSON.stringify(await ui.drawn())
  expect(tree).toContain('flex-end')
  expect(tree.indexOf('PR #12')).toBeLessThan(tree.indexOf('60:00'))
  await ui.unmount()

  // While its checks run the clock asks again each minute.
  answer = { exitCode: 0, stdout: JSON.stringify({ ...view, statusCheckRollup: [check('COMPLETED', 'SUCCESS'), check('COMPLETED', 'SKIPPED')] }) }
  await clock.advance(MIN)
  expect(ran.length).toBe(2)
  ui = await $.ui.mount(band('terminal', 120))
  let mark = await ui.find({ type: 'Text', text: /PR #12/ })
  expect(mark?.text).toBe('✓ PR #12')
  expect(mark?.props.color).toBe('success')
  await ui.unmount()

  // Settled, the clock leaves it five minutes; a turn asks again after one.
  answer = { exitCode: 0, stdout: JSON.stringify({ ...view, state: 'MERGED', mergeable: 'UNKNOWN', statusCheckRollup: [] }) }
  await clock.advance(MIN)
  expect(ran.length).toBe(2)
  await measure()
  await measure()
  expect(ran.length).toBe(3)
  ui = await $.ui.mount(band('terminal', 120))
  mark = await ui.find({ type: 'Text', text: /PR #12/ })
  expect(mark?.text).toBe('● PR #12')
  expect(mark?.props.color).toBe('merged')
  await ui.unmount()

  // A failed check is none of the three: nothing is drawn. The clock finds out by itself.
  answer = { exitCode: 0, stdout: JSON.stringify({ ...view, statusCheckRollup: [check('COMPLETED', 'FAILURE')] }) }
  await clock.advance(5 * MIN)
  expect(ran.length).toBe(4)
  ui = await $.ui.mount(band('terminal', 120))
  expect(await ui.find({ type: 'Link' })).toBeUndefined()
  expect(await ui.find({ text: /PR #/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^\d\d:\d\d$/ })).toBeDefined()
  await ui.unmount()
})

test('no pull request for the branch: no pull request on the band', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-7' }) as any)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [{ kind: 'seven_day', percentUsed: 12 }] } }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'no pull requests found for branch "main"', isStdoutTruncated: false, isStderrTruncated: false } }) as any)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
  on('ui.invalidate', () => ({ value: undefined }) as any)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(band('terminal', 120))
  expect(await ui.find({ type: 'Link' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /Week/ }))?.text).toBe('Week 12%')
  await ui.unmount()
})
