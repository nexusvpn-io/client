import {
  deleteProfile,
  enhanceProfiles,
  getProfiles,
  patchVergeConfig,
} from '@/services/cmds'
import { revalidateQueries } from '@/services/query-client'

const isNexusProfile = (item: IProfileItem | null | undefined) => {
  if (!item) return false
  const isNexusName = item.name?.startsWith('Nexus ·') ?? false
  const isNexusSubscription =
    item.url?.includes('/vpn-config/subscription/') ?? false
  return isNexusName || isNexusSubscription
}

/** Removes account-scoped networking state without depending on mounted UI hooks. */
export async function cleanupNexusSession(): Promise<void> {
  const failures: unknown[] = []

  // Always write both flags. The observed OS proxy can already be off while the persisted
  // preference is still on, and that preference would otherwise reactivate on next launch.
  try {
    await patchVergeConfig({
      enable_system_proxy: false,
      enable_tun_mode: false,
    })
  } catch (error) {
    failures.push(error)
  }

  try {
    const profiles = await getProfiles()
    const nexusProfiles = (profiles.items ?? []).filter(isNexusProfile)
    const orderedProfiles = [...nexusProfiles].sort((left, right) =>
      left.uid === profiles.current
        ? 1
        : right.uid === profiles.current
          ? -1
          : 0,
    )

    for (const item of orderedProfiles) {
      if (item.uid) await deleteProfile(item.uid)
    }
    const enhanced = await enhanceProfiles()
    if (!enhanced) throw new Error('代理配置索引刷新失败')
  } catch (error) {
    failures.push(error)
  }

  await revalidateQueries([
    ['getVergeConfig'],
    ['getSystemProxy'],
    ['getAutotemProxy'],
    ['getProfiles'],
    ['getProxyView'],
    ['getClashConfig'],
  ]).catch((error) => failures.push(error))

  if (failures.length > 0) {
    throw new AggregateError(failures, 'Nexus 本地代理数据未能完全清理')
  }
}
