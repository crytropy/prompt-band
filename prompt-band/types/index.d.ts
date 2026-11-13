/** The account's rate-limit windows: the same in every session, so kept across sessions. */
export type Limits = {
  fiveHour?: number
  fiveHourResetsAt?: string
  weekly?: number
  weeklyResetsAt?: string
  /** Fable's own weekly window, from the account's usage endpoint. */
  fable?: number
  fableResetsAt?: string
}

export type Reading = Limits & {
  context?: number
  contextTokens?: number
  contextWindow?: number
}

/** One context reading after a main-loop turn, for the Token Weather trend. */
export type Point = {
  tokens: number
  window: number
}

/** Milliseconds since the epoch, or null before the first main-loop request. */
export type Stamp = number | null

/** The current branch's pull request, in one of the three states the band draws. */
export type Pr = {
  /** Its checks are still running; they passed and it can be merged; it is merged. */
  kind: 'running' | 'ready' | 'merged'
  number: number
  /** Its page on GitHub: what a click on it opens. */
  url: string
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-band': {
      reading: Reading | null
      /** The last turns' context readings, oldest first. */
      history: Point[]
      /** When the main loop last sent a request to the model. */
      lastSentAt: Stamp
      /** The `lastSentAt` the five-minute warning was already raised for. */
      warnedFor: Stamp
      /** The current branch's pull request; null with none to draw. */
      pr: Pr | null
    }
  }
}
