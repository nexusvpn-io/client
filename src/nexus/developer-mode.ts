export interface DeveloperClickState {
  count: number
  lastAt: number
}

export function recordDeveloperClick(
  state: DeveloperClickState,
  now = Date.now(),
): boolean {
  state.count = now - state.lastAt <= 1500 ? state.count + 1 : 1
  state.lastAt = now
  if (state.count < 5) return false
  state.count = 0
  return true
}
