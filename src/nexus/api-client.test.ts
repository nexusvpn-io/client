import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  API_BASE_STORAGE_KEY,
  DEFAULT_API_BASE,
  getApiBaseUrl,
  login,
  normalizeApiBaseUrl,
  resetApiBaseUrl,
  setApiBaseUrl,
} from './api-client'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: mocks.fetch }))

const values = new Map<string, string>()
const storage: Storage = {
  get length() {
    return values.size
  },
  clear: () => values.clear(),
  getItem: (key: string) => values.get(key) ?? null,
  key: (index: number) => [...values.keys()][index] ?? null,
  removeItem: (key: string) => {
    values.delete(key)
  },
  setItem: (key: string, value: string) => {
    values.set(key, value)
  },
}

beforeEach(() => {
  values.clear()
  vi.stubGlobal('localStorage', storage)
  mocks.fetch.mockReset()
})

describe('Nexus API Host', () => {
  it('normalizes and persists a custom API base URL', () => {
    expect(setApiBaseUrl(' https://dev.example.com/api/ ')).toBe(
      'https://dev.example.com/api',
    )
    expect(getApiBaseUrl()).toBe('https://dev.example.com/api')
  })

  it('rejects unsafe or ambiguous URLs', () => {
    expect(() => normalizeApiBaseUrl('file:///tmp/api')).toThrow('http://')
    expect(() => normalizeApiBaseUrl('https://user@example.com/api')).toThrow(
      '不能包含',
    )
    expect(() =>
      normalizeApiBaseUrl('https://example.com/api?debug=1'),
    ).toThrow('不能包含')
  })

  it('uses the latest saved Host for the next request', async () => {
    setApiBaseUrl('http://127.0.0.1:3000/api')
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'token',
        user: { id: '1', email: 'a@b.c' },
      }),
    })

    await login('a@b.c', 'password')

    expect(mocks.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/auth/login',
      expect.any(Object),
    )
  })

  it('restores the configured default Host', () => {
    values.set(API_BASE_STORAGE_KEY, 'https://dev.example.com/api')
    resetApiBaseUrl()
    expect(getApiBaseUrl()).toBe(DEFAULT_API_BASE)
  })
})
