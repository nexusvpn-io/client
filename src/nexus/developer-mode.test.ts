import { describe, expect, it } from 'vitest'

import {
  recordDeveloperClick,
  type DeveloperClickState,
} from './developer-mode'

describe('developer mode click sequence', () => {
  it('unlocks after five consecutive clicks', () => {
    const state: DeveloperClickState = { count: 0, lastAt: 0 }
    expect(
      [0, 200, 400, 600, 800].map((now) => recordDeveloperClick(state, now)),
    ).toEqual([false, false, false, false, true])
  })

  it('resets the sequence after a long pause', () => {
    const state: DeveloperClickState = { count: 0, lastAt: 0 }
    for (const now of [0, 200, 400, 600]) recordDeveloperClick(state, now)
    expect(recordDeveloperClick(state, 2200)).toBe(false)
    expect(state.count).toBe(1)
  })
})
