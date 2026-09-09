import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

export const AUTH_EXPIRED_EVENT = 'nexus:auth-expired'
export const API_BASE_STORAGE_KEY = 'nexus.api-base-url'
export const DEFAULT_API_BASE = (
  import.meta.env.VITE_NEXUS_API_URL || 'https://web.nexusvpn.ltd/api'
).replace(/\/$/, '')

const notifyAuthExpired = () =>
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))

export interface NexusUser {
  id: string
  email: string
  username?: string
}

export interface AuthResponse {
  access_token: string
  user: NexusUser
  emailVerificationSent?: boolean
}

export interface TeamMembership {
  id: string
  name: string
  memberId: string | null
}

export interface VpnConfig {
  success: boolean
  data: {
    memberName?: string
    serviceStatus?: string
    allowed?: number
    upload?: number
    download?: number
    expiresAt?: string
    subscriptionUrl?: string
    error?: string
  }
}

interface TrialService {
  id: number
  status: 'provisioning' | 'active' | 'expired' | 'failed'
  trafficLimit: number
  trafficUsed: number
  trafficRemaining: number
  startedAt: string
  expiresAt: string
}

export interface TrialState {
  eligible: boolean
  reason: string | null
  service: TrialService | null
}

export const normalizeApiBaseUrl = (value: string): string => {
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('API Host 仅支持 http:// 或 https://')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('API Host 不能包含账号、密码、查询参数或锚点')
  }
  return url.toString().replace(/\/$/, '')
}

export const getApiBaseUrl = (): string => {
  const stored = localStorage.getItem(API_BASE_STORAGE_KEY)
  if (!stored) return DEFAULT_API_BASE
  try {
    return normalizeApiBaseUrl(stored)
  } catch {
    localStorage.removeItem(API_BASE_STORAGE_KEY)
    return DEFAULT_API_BASE
  }
}

export const setApiBaseUrl = (value: string): string => {
  const normalized = normalizeApiBaseUrl(value)
  localStorage.setItem(API_BASE_STORAGE_KEY, normalized)
  return normalized
}

export const resetApiBaseUrl = () =>
  localStorage.removeItem(API_BASE_STORAGE_KEY)

const request = async <T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> => {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await tauriFetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers,
  })

  if (response.status === 401 && token) notifyAuthExpired()

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message = Array.isArray(payload?.message)
      ? payload.message.join('；')
      : payload?.message
    throw new Error(message || `请求失败 (${response.status})`)
  }

  return response.json() as Promise<T>
}

const requestText = async (path: string, token: string): Promise<string> => {
  const response = await tauriFetch(`${getApiBaseUrl()}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'text/plain' },
  })
  if (response.status === 401) notifyAuthExpired()
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.message || `请求失败 (${response.status})`)
  }
  return response.text()
}

export const getApiOrigin = () => new URL(getApiBaseUrl()).origin

export const login = (email: string, password: string) =>
  request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

export const register = (email: string, password: string, username: string) =>
  request<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      confirmPassword: password,
      username,
    }),
  })

export const profile = (token: string) =>
  request<NexusUser>('/auth/profile', {}, token)

export const getMyTeams = (token: string) =>
  request<TeamMembership[]>('/teams/my-teams', {}, token)

export const getVpnConfig = (token: string, teamId: string, memberId: string) =>
  request<VpnConfig>(
    `/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(memberId)}/vpn-config`,
    {},
    token,
  )

export const getTrialState = (token: string) =>
  request<TrialState>('/me/trial', {}, token)

export const getTrialSubscription = (token: string) =>
  requestText('/me/trial/subscription?agent=clash-grouping', token)
