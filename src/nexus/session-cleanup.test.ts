import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cleanupNexusSession } from './session-cleanup'

const mocks = vi.hoisted(() => ({
  deleteProfile: vi.fn(),
  enhanceProfiles: vi.fn(),
  getProfiles: vi.fn(),
  patchVergeConfig: vi.fn(),
  revalidateQueries: vi.fn(),
}))

vi.mock('@/services/cmds', () => ({
  deleteProfile: mocks.deleteProfile,
  enhanceProfiles: mocks.enhanceProfiles,
  getProfiles: mocks.getProfiles,
  patchVergeConfig: mocks.patchVergeConfig,
}))

vi.mock('@/services/query-client', () => ({
  revalidateQueries: mocks.revalidateQueries,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.patchVergeConfig.mockResolvedValue(undefined)
  mocks.deleteProfile.mockResolvedValue(undefined)
  mocks.enhanceProfiles.mockResolvedValue(true)
  mocks.revalidateQueries.mockResolvedValue(undefined)
  mocks.getProfiles.mockResolvedValue({
    current: 'nexus-current',
    items: [
      { uid: 'other', name: 'Personal' },
      { uid: 'nexus-current', name: 'Nexus · Team' },
      {
        uid: 'nexus-old',
        name: 'Renamed',
        url: 'https://api.example/api/teams/t/members/m/vpn-config/subscription/token',
      },
    ],
  })
})

describe('cleanupNexusSession', () => {
  it('disables both connection modes and removes only Nexus profiles', async () => {
    await cleanupNexusSession()

    expect(mocks.patchVergeConfig).toHaveBeenCalledWith({
      enable_system_proxy: false,
      enable_tun_mode: false,
    })
    expect(mocks.deleteProfile.mock.calls).toEqual([
      ['nexus-old'],
      ['nexus-current'],
    ])
    expect(mocks.enhanceProfiles).toHaveBeenCalledOnce()
  })

  it('still removes profiles when disabling the proxy fails', async () => {
    mocks.patchVergeConfig.mockRejectedValue(new Error('proxy failure'))

    await expect(cleanupNexusSession()).rejects.toThrow(
      'Nexus 本地代理数据未能完全清理',
    )
    expect(mocks.deleteProfile).toHaveBeenCalledTimes(2)
  })

  it('reports an incomplete cleanup when the profile index cannot refresh', async () => {
    mocks.enhanceProfiles.mockResolvedValue(false)

    await expect(cleanupNexusSession()).rejects.toThrow(
      'Nexus 本地代理数据未能完全清理',
    )
  })
})
