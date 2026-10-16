/** The account's rate-limit windows: the same in every session, so kept across sessions. */
export type Limits = {
  fiveHour?: number
  fiveHourResetsAt?: string
  weekly?: number
  weeklyResetsAt?: string
}

export type Reading = Limits & {
  context?: number
}

/** Milliseconds since the epoch, or null before the first main-loop request. */
export type Stamp = number | null

declare module 'claude-code' {
  interface PluginState {
    'prompt-band': {
      reading: Reading | null
      /** When the main loop last sent a request to the model. */
      lastSentAt: Stamp
      /** The `lastSentAt` the five-minute warning was already raised for. */
      warnedFor: Stamp
    }
  }
}
