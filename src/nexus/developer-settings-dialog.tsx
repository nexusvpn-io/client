import { type FormEvent, useEffect, useState } from 'react'

import {
  DEFAULT_API_BASE,
  getApiBaseUrl,
  resetApiBaseUrl,
  setApiBaseUrl,
} from './api-client'

interface DeveloperSettingsDialogProps {
  open: boolean
  onClose: () => void
  onApiChanged: (changed: boolean) => Promise<void>
}

export function DeveloperSettingsDialog({
  open,
  onClose,
  onApiChanged,
}: DeveloperSettingsDialogProps) {
  const [apiBase, setApiBase] = useState(getApiBaseUrl)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [busy, onClose, open])

  if (!open) return null

  const apply = async (nextApiBase: string, reset = false) => {
    setBusy(true)
    setError('')
    try {
      const previous = getApiBaseUrl()
      if (reset) resetApiBaseUrl()
      else setApiBaseUrl(nextApiBase)
      const changed = previous !== getApiBaseUrl()
      await onApiChanged(changed)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'API Host 保存失败')
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void apply(apiBase)
  }

  return (
    <div className="nexus-developer-overlay">
      <section
        className="nexus-developer-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nexus-developer-title"
      >
        <div className="nexus-developer-dialog__badge">DEV</div>
        <h2 id="nexus-developer-title">开发者模式</h2>
        <p>修改客户端连接的 API Host。完整地址需要包含 API 路径。</p>
        <form onSubmit={submit}>
          <label>
            API Host
            <input
              type="url"
              required
              spellCheck={false}
              value={apiBase}
              placeholder={DEFAULT_API_BASE}
              disabled={busy}
              onChange={(event) => setApiBase(event.target.value)}
            />
          </label>
          {error && (
            <p className="nexus-error" role="alert">
              {error}
            </p>
          )}
          <small>更换 Host 后会退出当前账号，并清理本地 Nexus 代理配置。</small>
          <div className="nexus-developer-dialog__actions">
            <button
              type="button"
              className="secondary danger"
              disabled={busy || getApiBaseUrl() === DEFAULT_API_BASE}
              onClick={() => void apply(DEFAULT_API_BASE, true)}
            >
              恢复默认
            </button>
            <span />
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
