import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { closeAllConnections } from 'tauri-plugin-mihomo-api'

import nexusLogoWhite from '@/assets/image/nexus-logo-white.svg'
import nexusLogo from '@/assets/image/nexus-logo.svg'
import { SysproxyPrivilegeDialog } from '@/components/layout/sysproxy-privilege-dialog'
import {
  WindowControls,
  WindowResizeHandles,
} from '@/components/layout/window-controller'
import { useGroupDelays } from '@/hooks/use-group-delays'
import { useProfiles } from '@/hooks/use-profiles'
import { useProxySelection } from '@/hooks/use-proxy-selection'
import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { useSystemState } from '@/hooks/use-system-state'
import { useTrafficData } from '@/hooks/use-traffic-data'
import { useVerge } from '@/hooks/use-verge'
import { useVisibility } from '@/hooks/use-visibility'
import {
  useClashConfigData,
  useAppRefreshers,
  useProxiesData,
  useSystemData,
} from '@/providers/app-data-context'
import {
  createProfile,
  deleteProfile,
  enhanceProfiles,
  getProfiles,
  importProfile,
  patchProfile,
  patchClashMode,
  patchProfilesConfig,
  saveProfileFile,
} from '@/services/cmds'
import delayManager from '@/services/delay'
import { requestService } from '@/services/service-request'
import { isInteractableMember, resolveMember } from '@/types/proxy-view'
import parseTraffic from '@/utils/parse-traffic'

import {
  AUTH_EXPIRED_EVENT,
  apiOrigin,
  getMyTeams,
  getTrialState,
  getTrialSubscription,
  getVpnConfig,
  login,
  NexusUser,
  profile,
  register,
} from './api-client'
import './nexus.scss'

const TOKEN_KEY = 'nexus.access-token'
const persistedToken = localStorage.getItem(TOKEN_KEY)

type AuthMode = 'login' | 'register'
type RoutingMode = 'rule' | 'global' | 'direct'

const ROUTING_MODES: { mode: RoutingMode; label: string }[] = [
  { mode: 'rule', label: '规则代理' },
  { mode: 'global', label: '全局代理' },
  { mode: 'direct', label: '直连' },
]

interface Session {
  token: string
  user: NexusUser
}

interface ServiceSummary {
  used: number
  total: number
  expiresAt?: string
  source: 'team' | 'trial'
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '操作失败，请稍后重试'

const NexusBrand = ({ inverted = false }: { inverted?: boolean }) => (
  <div className="nexus-brand">
    <img src={inverted ? nexusLogoWhite : nexusLogo} alt="Nexus VPN" />
  </div>
)

function AuthScreen({
  onAuthenticated,
  notice,
}: {
  onAuthenticated: (session: Session) => void
  notice?: string
}) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result =
        mode === 'login'
          ? await login(email.trim(), password)
          : await register(email.trim(), password, username.trim())
      localStorage.setItem(TOKEN_KEY, result.access_token)
      onAuthenticated({ token: result.access_token, user: result.user })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="nexus-auth">
      <section className="nexus-auth__story">
        <NexusBrand inverted />
        <div className="nexus-auth__copy">
          <p className="nexus-kicker">PRIVATE NETWORK · SIMPLIFIED</p>
          <h1>
            保持连接，<em>专注当下。</em>
          </h1>
          <p>
            一个轻量、安静的桌面网络入口。账户与服务自动同步，无需手动维护配置。
          </p>
        </div>
        <div className="nexus-auth__signal">
          <i />
          <span>加密连接由 Mihomo 内核提供</span>
        </div>
      </section>

      <section className="nexus-auth__panel">
        <div className="nexus-auth__mobile-brand">
          <NexusBrand />
        </div>
        <form className="nexus-form" onSubmit={submit}>
          <div className="nexus-tabs" role="tablist">
            <button
              type="button"
              className={mode === 'login' ? 'active' : ''}
              onClick={() => setMode('login')}
            >
              登录
            </button>
            <button
              type="button"
              className={mode === 'register' ? 'active' : ''}
              onClick={() => setMode('register')}
            >
              注册
            </button>
          </div>
          <header>
            <h2>{mode === 'login' ? '欢迎回来' : '创建账户'}</h2>
            <p>
              {mode === 'login'
                ? '登录后自动同步您的代理服务'
                : '注册 Nexus，开始安全连接'}
            </p>
          </header>
          {notice && <p className="nexus-message">{notice}</p>}
          {mode === 'register' && (
            <label>
              昵称
              <input
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="怎么称呼您"
              />
            </label>
          )}
          <label>
            邮箱
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
            />
          </label>
          <label>
            密码
            <input
              required
              minLength={8}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 8 位，包含大小写字母和数字"
            />
          </label>
          {error && (
            <p className="nexus-error" role="alert">
              {error}
            </p>
          )}
          <button className="nexus-primary" disabled={busy} type="submit">
            {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
          </button>
          <p className="nexus-terms">继续即表示您同意服务条款与隐私政策</p>
        </form>
      </section>
    </main>
  )
}

function Dashboard({
  session,
  onLogout,
}: {
  session: Session
  onLogout: () => void
}) {
  const pageVisible = useVisibility()
  const { profiles, mutateProfiles } = useProfiles()
  const { indicator, toggleSystemProxy } = useSystemProxyState()
  const { isTunModeAvailable } = useSystemState()
  const { verge, patchVerge } = useVerge()
  const { runningMode } = useSystemData()
  const { clashConfig } = useClashConfigData()
  const { proxyView } = useProxiesData()
  const { refreshClashConfig, refreshProxy } = useAppRefreshers()
  const { changeProxy } = useProxySelection({
    onSuccess: () => void refreshProxy(),
  })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [service, setService] = useState<ServiceSummary | null>(null)
  const [selectedGroupName, setSelectedGroupName] = useState('')
  const [testingDelay, setTestingDelay] = useState(false)
  const [switchingRoutingMode, setSwitchingRoutingMode] = useState(false)
  const [optimisticRoutingMode, setOptimisticRoutingMode] =
    useState<RoutingMode | null>(null)
  const [page, setPage] = useState<'connection' | 'nodes'>('connection')
  const [connectionMode, setConnectionMode] = useState<'system' | 'tun'>(() =>
    verge?.enable_tun_mode ? 'tun' : 'system',
  )
  const initialSyncStartedRef = useRef(false)
  const {
    response: { data: traffic },
  } = useTrafficData({ enabled: pageVisible && page === 'connection' })

  const current = useMemo(
    () => profiles?.items?.find((item) => item?.uid === profiles.current),
    [profiles],
  )

  const selectableGroups = useMemo(
    () =>
      proxyView?.groups.filter(
        (group) =>
          !group.hidden &&
          (group.type === 'Selector' || group.type === 'URLTest'),
      ) ?? [],
    [proxyView],
  )

  const proxyGroup = useMemo(() => {
    if (!proxyView) return undefined
    if (clashConfig?.mode?.toLowerCase() === 'global') {
      return proxyView.global ?? undefined
    }
    return (
      selectableGroups.find((group) => group.name === selectedGroupName) ??
      selectableGroups.find((group) =>
        ['节点选择', 'proxy', 'select', '自动选择', 'auto'].some((keyword) =>
          group.name.toLowerCase().includes(keyword.toLowerCase()),
        ),
      ) ??
      selectableGroups[0]
    )
  }, [clashConfig?.mode, proxyView, selectableGroups, selectedGroupName])

  const groupDelays = useGroupDelays(proxyGroup?.name ?? null)

  const nodes = useMemo(() => {
    if (!proxyGroup || !proxyView) return []
    return proxyGroup.members.flatMap((memberRef, memberIndex) => {
      const member = resolveMember(proxyView, memberRef)
      if (member.kind === 'unresolved') return []
      const measuredDelay = groupDelays.of(member)
      const details = member.kind === 'group' ? member.group : member.node
      return [
        {
          key: `${member.kind}:${member.ref.name}:${memberIndex}`,
          name: member.ref.name,
          member,
          delay:
            measuredDelay > 0
              ? measuredDelay
              : details.history.at(-1)?.delay || 0,
        },
      ]
    })
  }, [groupDelays, proxyGroup, proxyView])

  const checkAllDelays = async () => {
    if (!proxyGroup || testingDelay) return
    const targets = nodes
      .map((node) => node.member)
      .filter(isInteractableMember)
      .filter(({ ref }) => ref.name !== 'DIRECT' && ref.name !== 'REJECT')
    if (!targets.length) return

    setTestingDelay(true)
    try {
      await delayManager.checkListDelay(targets, proxyGroup.name, 10000)
      await refreshProxy()
    } catch (cause) {
      setMessage(errorMessage(cause))
    } finally {
      setTestingDelay(false)
    }
  }

  const syncService = useCallback(async () => {
    setBusy(true)
    setMessage('')
    try {
      const teams = await getMyTeams(session.token)
      let targetUrl = ''
      let targetName = ''
      let summary: ServiceSummary | null = null
      for (const membership of teams.filter((team) => team.memberId)) {
        try {
          const config = await getVpnConfig(
            session.token,
            membership.id,
            membership.memberId!,
          )
          if (!config.data.subscriptionUrl) continue
          const subscriptionUrl = new URL(
            config.data.subscriptionUrl,
            apiOrigin,
          )
          subscriptionUrl.searchParams.set('agent', 'clash-grouping')
          targetUrl = subscriptionUrl.toString()
          targetName = `Nexus · ${membership.name}`
          summary = {
            used: (config.data.upload || 0) + (config.data.download || 0),
            total: config.data.allowed || 0,
            expiresAt: config.data.expiresAt,
            source: 'team',
          }
          break
        } catch {
          // Continue looking for another active membership.
        }
      }

      if (targetUrl) {
        const existing = profiles?.items?.find(
          (item) => item?.url === targetUrl,
        )
        if (!existing) {
          await importProfile(targetUrl)
          const imported = await getProfiles()
          const item = imported.items?.find(
            (profileItem) => profileItem?.url === targetUrl,
          )
          if (item?.uid) {
            await patchProfile(item.uid, { name: targetName })
          }
        }
      } else {
        const trial = await getTrialState(session.token)
        if (trial.service?.status !== 'active') {
          throw new Error(
            trial.eligible
              ? '账户暂无服务，可前往官网开通个人试用'
              : '账户暂未分配可用的代理服务',
          )
        }
        const fileData = await getTrialSubscription(session.token)
        targetName = 'Nexus · 个人试用'
        const local = profiles?.items?.find((item) => item?.name === targetName)
        if (local?.uid) {
          await saveProfileFile(local.uid, fileData)
        } else {
          await createProfile(
            { type: 'local', name: targetName, desc: '由 Nexus 账户自动同步' },
            fileData,
          )
        }
        summary = {
          used: trial.service.trafficUsed,
          total: trial.service.trafficLimit,
          expiresAt: trial.service.expiresAt,
          source: 'trial',
        }
      }

      await mutateProfiles()
      const refreshed = await getProfiles()
      const target = refreshed.items?.find((item) =>
        targetUrl ? item?.url === targetUrl : item?.name === targetName,
      )
      if (target?.uid && refreshed.current !== target.uid) {
        const outcome = await patchProfilesConfig({
          ...refreshed,
          current: target.uid,
        })
        if (outcome.status !== 'valid') {
          throw new Error(
            outcome.status === 'busy'
              ? '配置正在更新，请稍后重试'
              : '代理配置未能通过校验',
          )
        }
        await mutateProfiles()
      }

      // A sidecar started without a current profile needs an explicit reload
      // after the subscription is imported and selected.
      if (!(await enhanceProfiles())) {
        throw new Error('代理配置加载失败')
      }
      await Promise.all([refreshProxy(), refreshClashConfig()])
      setService(summary)
      setMessage('服务已同步')
    } catch (cause) {
      setMessage(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }, [
    mutateProfiles,
    profiles?.items,
    refreshClashConfig,
    refreshProxy,
    session.token,
  ])

  useEffect(() => {
    if (initialSyncStartedRef.current) return
    initialSyncStartedRef.current = true
    void syncService()
  }, [syncService])

  const tunConnected = Boolean(verge?.enable_tun_mode && isTunModeAvailable)
  const liveConnectionMode: 'system' | 'tun' | null =
    tunConnected && !indicator
      ? 'tun'
      : indicator && !tunConnected
        ? 'system'
        : null
  if (!busy && liveConnectionMode && liveConnectionMode !== connectionMode) {
    setConnectionMode(liveConnectionMode)
  }
  const connected = connectionMode === 'tun' ? tunConnected : indicator
  const configuredRoutingMode = clashConfig?.mode?.toLowerCase()
  const routingMode: RoutingMode =
    optimisticRoutingMode ??
    (configuredRoutingMode === 'global' || configuredRoutingMode === 'direct'
      ? configuredRoutingMode
      : 'rule')

  const switchConnectionMode = async (nextMode: 'system' | 'tun') => {
    if (busy || nextMode === connectionMode) return

    // When disconnected this is only a preference; the main button will start
    // the selected mode. When connected, migrate the live connection first.
    if (!connected) {
      setConnectionMode(nextMode)
      return
    }

    if (nextMode === 'tun' && !isTunModeAvailable) {
      setMessage('启用 TUN 模式需要授权，完成后将自动切换')
      requestService({
        reason: 'tunNeedsService',
        restore: { enable_tun_mode: true, enable_system_proxy: false },
      })
      return
    }

    const previousMode = connectionMode
    setBusy(true)
    setMessage('')
    try {
      if (nextMode === 'tun') {
        await patchVerge({ enable_tun_mode: true })
        await toggleSystemProxy(false)
        setConnectionMode('tun')
      } else {
        await toggleSystemProxy(true)
        setConnectionMode('system')
        await patchVerge({ enable_tun_mode: false })
      }
    } catch (cause) {
      // Restore the previous single-mode state if the second half fails.
      if (nextMode === 'tun') {
        await toggleSystemProxy(true).catch(() => {})
        await patchVerge({ enable_tun_mode: false }).catch(() => {})
      } else {
        await patchVerge({ enable_tun_mode: true }).catch(() => {})
        await toggleSystemProxy(false).catch(() => {})
      }
      setConnectionMode(previousMode)
      setMessage(`切换连接方式失败：${errorMessage(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  const switchRoutingMode = async (nextMode: RoutingMode) => {
    if (
      busy ||
      switchingRoutingMode ||
      runningMode === 'NotRunning' ||
      nextMode === routingMode
    )
      return

    setSwitchingRoutingMode(true)
    setOptimisticRoutingMode(nextMode)
    setMessage('')
    try {
      if (verge?.auto_close_connection) {
        await closeAllConnections().catch(() => {})
      }
      await patchClashMode(nextMode)
      await Promise.all([refreshClashConfig(), refreshProxy()])
    } catch (cause) {
      setMessage(`切换代理模式失败：${errorMessage(cause)}`)
    } finally {
      setOptimisticRoutingMode(null)
      setSwitchingRoutingMode(false)
    }
  }

  const toggle = async () => {
    setBusy(true)
    setMessage('')
    try {
      if (connectionMode === 'tun') {
        if (!tunConnected && !isTunModeAvailable) {
          requestService({
            reason: 'tunNeedsService',
            restore: { enable_tun_mode: true, enable_system_proxy: false },
          })
          return
        }
        if (!tunConnected && indicator) await toggleSystemProxy(false)
        await patchVerge({ enable_tun_mode: !tunConnected })
      } else {
        if (!indicator && verge?.enable_tun_mode) {
          await patchVerge({ enable_tun_mode: false })
        }
        await toggleSystemProxy(!indicator)
      }
    } catch (cause) {
      setMessage(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    if (busy) return
    setBusy(true)
    setMessage('正在清理本地代理数据…')

    try {
      if (indicator) await toggleSystemProxy(false)
      if (verge?.enable_tun_mode) {
        await patchVerge({ enable_tun_mode: false })
      }

      const latestProfiles = await getProfiles()
      const nexusProfiles = (latestProfiles.items ?? []).filter((item) => {
        if (!item) return false
        const isNexusName = item.name?.startsWith('Nexus ·') ?? false
        const isNexusSubscription =
          item.url?.includes('/vpn-config/subscription/') ?? false
        return isNexusName || isNexusSubscription
      })
      const orderedProfiles = [...nexusProfiles].sort((left, right) =>
        left.uid === latestProfiles.current
          ? 1
          : right.uid === latestProfiles.current
            ? -1
            : 0,
      )

      for (const item of orderedProfiles) {
        if (item.uid) await deleteProfile(item.uid)
      }

      await enhanceProfiles()
      localStorage.removeItem('nexus.access-token')
      onLogout()
    } catch (cause) {
      setMessage(`退出前清理失败：${errorMessage(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  const formatBytes = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`
  const [uploadRate, uploadRateUnit] = parseTraffic(traffic?.up || 0)
  const [downloadRate, downloadRateUnit] = parseTraffic(traffic?.down || 0)
  const percent = service?.total
    ? Math.min(100, (service.used / service.total) * 100)
    : 0

  return (
    <main className="nexus-shell">
      <header className="nexus-topbar" data-tauri-drag-region>
        <NexusBrand />
        <nav className="nexus-nav" aria-label="主导航">
          <button
            type="button"
            className={page === 'connection' ? 'active' : ''}
            onClick={() => setPage('connection')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3v9m6.4-5.4a8 8 0 1 1-12.8 0" />
            </svg>
            连接
          </button>
          <button
            type="button"
            className={page === 'nodes' ? 'active' : ''}
            onClick={() => setPage('nodes')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="4" width="16" height="6" rx="2" />
              <rect x="4" y="14" width="16" height="6" rx="2" />
              <path d="M8 7h.01M8 17h.01" />
            </svg>
            节点
          </button>
        </nav>
        <div className="nexus-account">
          <span>
            {session.user.username || session.user.email.split('@')[0]}
          </span>
          <button disabled={busy} onClick={logout}>
            {busy ? '处理中' : '退出'}
          </button>
        </div>
      </header>
      {page === 'connection' ? (
        <section className="nexus-dashboard">
          <p className="nexus-subtitle">
            {connected
              ? `流量正在通过${connectionMode === 'tun' ? ' TUN' : '系统代理'}传输`
              : current
                ? `已选择 ${current.name}`
                : '正在同步您的服务配置'}
          </p>
          <div className="nexus-connection-options">
            <label>
              <span>接入方式</span>
              <select
                aria-label="接入方式"
                value={connectionMode}
                disabled={busy}
                onChange={(event) =>
                  void switchConnectionMode(
                    event.target.value as 'system' | 'tun',
                  )
                }
              >
                <option value="system">系统代理</option>
                <option value="tun">
                  TUN 模式{!isTunModeAvailable ? ' · 需授权' : ''}
                </option>
              </select>
            </label>
            <label>
              <span>流量策略</span>
              <select
                aria-label="流量策略"
                value={routingMode}
                disabled={
                  busy || switchingRoutingMode || runningMode === 'NotRunning'
                }
                onChange={(event) =>
                  void switchRoutingMode(event.target.value as RoutingMode)
                }
              >
                {ROUTING_MODES.map(({ mode, label }) => (
                  <option value={mode} key={mode}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            className={`nexus-connect ${connected ? 'connected' : ''}`}
            disabled={busy || !current || runningMode === 'NotRunning'}
            onClick={toggle}
            aria-label={connected ? '断开连接' : '连接'}
          >
            <span className="nexus-connect__ring">
              <i />
            </span>
          </button>
          <div className="nexus-status-row">
            <span>
              <i className={connected ? 'online' : ''} />
              {runningMode === 'NotRunning'
                ? '内核未就绪'
                : connected
                  ? `${connectionMode === 'tun' ? 'TUN' : '系统代理'}已连接`
                  : '未连接'}
            </span>
            <button
              type="button"
              className="nexus-sync-service"
              aria-label="同步服务"
              title="同步服务"
              disabled={busy}
              onClick={syncService}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 7v5h-5M4 17v-5h5M6.1 8.5A7 7 0 0 1 18.5 7M17.9 15.5A7 7 0 0 1 5.5 17" />
              </svg>
            </button>
          </div>
          <div
            className="nexus-speed-row"
            role="group"
            aria-label="当前网络速率"
          >
            <div className="upload">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 19V5m-5 5 5-5 5 5" />
              </svg>
              <span>上传</span>
              <strong>
                {uploadRate}
                <small>{uploadRateUnit}/s</small>
              </strong>
            </div>
            <div className="download">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14m5-5-5 5-5-5" />
              </svg>
              <span>下载</span>
              <strong>
                {downloadRate}
                <small>{downloadRateUnit}/s</small>
              </strong>
            </div>
          </div>
          {message && <p className="nexus-message">{message}</p>}
          <div className="nexus-cards">
            <article>
              <span>当前配置</span>
              <strong>{current?.name || '暂无配置'}</strong>
              <small>
                {service?.source === 'trial'
                  ? '个人试用 · 安全本地同步'
                  : '自动跟随账户服务'}
              </small>
            </article>
            <article>
              <span>本期流量</span>
              <strong>
                {service
                  ? `${formatBytes(service.used)} / ${formatBytes(service.total)}`
                  : '—'}
              </strong>
              <div className="nexus-progress">
                <i style={{ width: `${percent}%` }} />
              </div>
            </article>
            <article>
              <span>服务有效期</span>
              <strong>
                {service?.expiresAt
                  ? new Date(service.expiresAt).toLocaleDateString('zh-CN')
                  : '—'}
              </strong>
              <small>到期前保持自动同步</small>
            </article>
          </div>
        </section>
      ) : (
        <section className="nexus-nodes-page">
          <header className="nexus-nodes-page__head">
            <div>
              <p className="nexus-kicker">PROXIES</p>
              <h1>选择节点</h1>
              <span>选择代理组中的出口节点，或测试全部节点延迟。</span>
            </div>
            <button
              type="button"
              className="nexus-delay-button"
              disabled={routingMode === 'direct' || !proxyGroup || testingDelay}
              onClick={checkAllDelays}
            >
              <i />
              {testingDelay ? '测速中…' : '全部测速'}
            </button>
          </header>
          {clashConfig?.mode?.toLowerCase() !== 'global' &&
            selectableGroups.length > 1 && (
              <div className="nexus-group-tabs">
                {selectableGroups.map((group) => (
                  <button
                    type="button"
                    className={group.name === proxyGroup?.name ? 'active' : ''}
                    key={group.name}
                    onClick={() => setSelectedGroupName(group.name)}
                  >
                    {group.name}
                  </button>
                ))}
              </div>
            )}
          {routingMode === 'direct' ? (
            <div className="nexus-node-empty">
              当前为直连模式，切换到规则代理或全局代理后即可选择节点。
            </div>
          ) : proxyGroup && nodes.length > 0 ? (
            <div className="nexus-node-grid">
              {nodes.map((node) => {
                const active = proxyGroup.now === node.name
                const tone =
                  node.delay < 200
                    ? 'good'
                    : node.delay < 800
                      ? 'medium'
                      : 'slow'
                return (
                  <button
                    type="button"
                    className={`nexus-node-card ${active ? 'active' : ''}`}
                    key={node.key}
                    onClick={() =>
                      changeProxy(
                        proxyGroup.name,
                        node.name,
                        proxyGroup.now,
                        proxyGroup.fixed,
                      )
                    }
                  >
                    <span className="nexus-node-card__icon">
                      {active ? '✓' : node.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="nexus-node-card__name">{node.name}</span>
                    <small className={node.delay ? tone : ''}>
                      {node.delay ? `${node.delay} ms` : '未测速'}
                    </small>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="nexus-node-empty">暂无可用节点，请先同步服务。</div>
          )}
        </section>
      )}
    </main>
  )
}

export default function NexusApp() {
  const [session, setSession] = useState<Session | null>(null)
  const [checking, setChecking] = useState(Boolean(persistedToken))
  const [authNotice, setAuthNotice] = useState('')

  useEffect(() => {
    const expireSession = () => {
      localStorage.removeItem(TOKEN_KEY)
      setSession(null)
      setChecking(false)
      setAuthNotice('登录已过期，请重新登录')
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, expireSession)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expireSession)
  }, [])

  useEffect(() => {
    const token = persistedToken
    if (!token) return
    profile(token)
      .then((user) => setSession({ token, user }))
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setChecking(false))
  }, [])

  const content = checking ? (
    <div className="nexus-splash">
      <NexusBrand inverted />
    </div>
  ) : !session ? (
    <AuthScreen
      notice={authNotice}
      onAuthenticated={(nextSession) => {
        setAuthNotice('')
        setSession(nextSession)
      }}
    />
  ) : (
    <Dashboard
      session={session}
      onLogout={() => {
        localStorage.removeItem(TOKEN_KEY)
        setSession(null)
      }}
    />
  )

  return (
    <>
      <div className="nexus-windowbar" data-tauri-drag-region>
        <WindowControls />
      </div>
      <WindowResizeHandles />
      {content}
      <SysproxyPrivilegeDialog />
    </>
  )
}
