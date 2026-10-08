import { useMemoizedFn } from 'ahooks'
import { useEffect, useMemo, useRef } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { openPriceSelfDetectPlatforms } from '@/abilities'
import { useToast } from '@/hooks/useToast'
import { useAccounts } from './useAccounts'
import { useLiveControlStore } from './useLiveControl'
import { buildOpenPriceSendMessages, useOpenPriceScriptStore } from './useOpenPriceScript'
import { readQuickStartAutoStart, useQuickStartStore } from './useQuickStart'

/** 自身能检测开价的平台，这些平台参与联动时可以选择停用自身检测 */
export const SELF_WATCH_PLATFORMS: LiveControlPlatform[] = openPriceSelfDetectPlatforms

export function canSelfWatch(platform?: LiveControlPlatform) {
  return !!platform && SELF_WATCH_PLATFORMS.includes(platform)
}

/** 一次联动的结果 */
export interface LinkageResult {
  time: number
  /** 触发源账号名，手动触发时为 null */
  source: string | null
  results: { accountName: string; ok: boolean; reason?: string }[]
}

const defaultConfig = (): OpenPriceLinkageConfig => ({
  enabled: false,
  sourceAccountId: null,
  targets: [],
  cooldownMs: 30000,
})

interface OpenPriceLinkageStore {
  config: OpenPriceLinkageConfig
  /** 最近一次联动结果，不持久化 */
  lastResult: LinkageResult | null

  setEnabled: (enabled: boolean) => void
  setSource: (accountId: string | null) => void
  setCooldown: (ms: number) => void
  upsertTarget: (target: OpenPriceLinkageTarget) => void
  removeTarget: (accountId: string) => void
  setLastResult: (result: LinkageResult | null) => void
}

export const useOpenPriceLinkageStore = create<OpenPriceLinkageStore>()(
  persist(
    immer(set => ({
      config: defaultConfig(),
      lastResult: null,

      setEnabled: enabled =>
        set(state => {
          state.config.enabled = enabled
        }),
      setSource: accountId =>
        set(state => {
          state.config.sourceAccountId = accountId
          // 触发源绝不能同时是跟随目标。
          // 否则开启联动时它会把自己当成「跟随平台」停掉自身的开价监听，
          // 结果触发源再也检测不到开价，整条联动都不会执行。
          if (accountId) {
            state.config.targets = state.config.targets.filter(t => t.accountId !== accountId)
          }
        }),
      setCooldown: ms =>
        set(state => {
          state.config.cooldownMs = ms
        }),
      upsertTarget: target =>
        set(state => {
          const index = state.config.targets.findIndex(t => t.accountId === target.accountId)
          if (index >= 0) {
            state.config.targets[index] = target
          } else {
            state.config.targets.push(target)
          }
        }),
      removeTarget: accountId =>
        set(state => {
          state.config.targets = state.config.targets.filter(t => t.accountId !== accountId)
        }),
      setLastResult: result =>
        set(state => {
          state.lastResult = result
        }),
    })),
    {
      name: 'open-price-linkage-storage',
      version: 1,
      partialize: state => ({ config: state.config }),
    },
  ),
)

/**
 * 跨平台开价联动。
 *
 * 触发源（默认巨量百应，也可选抖音小店 / 视频号）检测到「开价变预热」后，
 * 主进程会广播 openPriceWarmupTriggered；这里收到后并行通知所有跟随平台，
 * 各平台用自己配置的开价话术发送。
 *
 * 幂等保护：
 * - 只有触发源账号的回调才联动，其它账号自身的回调不触发（避免反向放大）
 * - 每个账号有独立冷却，冷却期内跳过（兜底防止自身检测与联动双发）
 */
export function useOpenPriceLinkage(options: {
  /** accountId -> 账号名 */
  accountNames: Record<string, string>
  /** accountId -> 平台 */
  accountPlatforms: Record<string, LiveControlPlatform | undefined>
  /** accountId -> 是否已连接中控台 */
  accountConnected: Record<string, boolean>
}) {
  const { accountNames, accountPlatforms, accountConnected } = options
  const config = useOpenPriceLinkageStore(state => state.config)
  const setLastResult = useOpenPriceLinkageStore(state => state.setLastResult)
  const { toast } = useToast()

  // 用 ref 持有最新的配置与账号信息，避免事件回调闭包过期
  const configRef = useRef(config)
  configRef.current = config
  const namesRef = useRef(accountNames)
  namesRef.current = accountNames
  const platformsRef = useRef(accountPlatforms)
  platformsRef.current = accountPlatforms
  const connectedRef = useRef(accountConnected)
  connectedRef.current = accountConnected

  /** 每个账号上次发送开价话术的时间，用于冷却 */
  const lastSentRef = useRef<Record<string, number>>({})

  const sendTo = useMemoizedFn(
    async (accountId: string): Promise<{ ok: boolean; reason?: string }> => {
      if (!connectedRef.current[accountId]) {
        return { ok: false, reason: '未连接中控台' }
      }
      const config = useOpenPriceScriptStore.getState().contexts[accountId]?.config
      const messages = config?.messages ?? []
      if (messages.length === 0) {
        return { ok: false, reason: '未配置开价话术' }
      }
      // 冷却检查
      const cfg = configRef.current
      const last = lastSentRef.current[accountId] ?? 0
      if (cfg.cooldownMs > 0 && Date.now() - last < cfg.cooldownMs) {
        return { ok: false, reason: '冷却中，已跳过' }
      }
      lastSentRef.current[accountId] = Date.now()

      const ok = await window.ipcRenderer.invoke(
        IPC_CHANNELS.tasks.autoMessage.sendOpenPriceMessages,
        accountId,
        buildOpenPriceSendMessages(messages, config?.pinTopEnabled ?? true),
      )
      return { ok: Boolean(ok), reason: ok ? undefined : '发送失败' }
    },
  )

  /** 对所有跟随账号并行下发 */
  const fanout = useMemoizedFn(async (sourceAccountId: string | null) => {
    const cfg = configRef.current
    const isManual = sourceAccountId === null
    // 自动联动：触发源自己会由自身监听发送，这里跳过，避免重复
    // 手动触发：没有触发源这一说，连同触发源一起发，否则会漏掉它
    const accountIds = isManual
      ? [
          ...cfg.targets.filter(t => t.follow).map(t => t.accountId),
          ...(cfg.sourceAccountId ? [cfg.sourceAccountId] : []),
        ]
      : cfg.targets.filter(t => t.follow && t.accountId !== sourceAccountId).map(t => t.accountId)

    const targets = [...new Set(accountIds)].map(accountId => ({ accountId }))
    if (targets.length === 0) {
      return
    }
    // 并行发送，避免串行累积延迟
    const settled = await Promise.all(
      targets.map(async t => {
        try {
          return { accountId: t.accountId, ...(await sendTo(t.accountId)) }
        } catch (error) {
          return {
            accountId: t.accountId,
            ok: false,
            reason: error instanceof Error ? error.message : '发送异常',
          }
        }
      }),
    )

    const result: LinkageResult = {
      time: Date.now(),
      source: sourceAccountId ? (namesRef.current[sourceAccountId] ?? null) : null,
      results: settled.map(s => ({
        accountName: namesRef.current[s.accountId] ?? s.accountId,
        ok: s.ok,
        reason: s.reason,
      })),
    }
    setLastResult(result)

    const okNames = result.results.filter(r => r.ok).map(r => r.accountName)
    const failed = result.results.filter(r => !r.ok)
    if (okNames.length > 0) {
      toast.success(`开价联动已发送：${okNames.join('、')}`)
    }
    if (failed.length > 0) {
      toast.error(
        `以下平台发送失败：${failed.map(r => `${r.accountName}(${r.reason ?? '未知'})`).join('；')}`,
      )
    }
  })

  /** 手动触发：不依赖触发源，直接让所有跟随平台发 */
  const triggerManual = useMemoizedFn(async () => {
    const cfg = configRef.current
    const followCount = cfg.targets.filter(t => t.follow).length
    if (followCount === 0) {
      toast.error('请先勾选要跟随的平台')
      return
    }
    await fanout(null)
  })

  /**
   * 联动开启时，对勾选了「停用自身检测」的平台停掉它们自己的开价监听，
   * 避免出现「自身检测发一次 + 联动又发一次」。
   */
  const applySelfWatchPolicy = useMemoizedFn(async () => {
    // 注意：必须读最新 store 而不是 configRef。
    // configRef 要等下一次渲染才更新，刚改完开关立刻调用会读到旧值，策略不生效。
    const cfg = useOpenPriceLinkageStore.getState().config
    if (!cfg.enabled) return
    for (const target of cfg.targets) {
      // 触发源自己的监听必须保留，停了就检测不到开价，联动整个失效
      if (target.accountId === cfg.sourceAccountId) continue
      if (!target.follow || !target.disableSelfWatch) continue
      if (!canSelfWatch(platformsRef.current[target.accountId])) continue
      const running = await window.ipcRenderer
        .invoke(IPC_CHANNELS.tasks.autoMessage.getOpenPriceWatcherStatus, target.accountId)
        .catch(() => false)
      if (running) {
        await window.ipcRenderer.invoke(
          IPC_CHANNELS.tasks.autoMessage.stopOpenPriceWatcher,
          target.accountId,
        )
        // 同步渲染层状态，否则这个账号的绿点会一直亮着
        useOpenPriceScriptStore.getState().setRunning(target.accountId, false)
        useOpenPriceScriptStore.getState().setError(target.accountId, null)
      }
    }
  })

  /**
   * 对**单个**账号应用「停用自身检测」策略，让勾选/取消勾选立刻生效。
   * - 勾选跟随 + 停用自身检测 → 立刻停掉它自己的开价监听（避免和联动重复发）
   * - 取消勾选 → 不再干涉它的自身监听（不自动替用户开启，避免没准备就发出去）
   */
  const applySelfWatchPolicyFor = useMemoizedFn(async (accountId: string) => {
    // 同 applySelfWatchPolicy：开关刚变，configRef 还是旧值，必须读最新 store
    const cfg = useOpenPriceLinkageStore.getState().config
    if (!cfg.enabled) return
    // 触发源自己的监听永远不能停，停了就检测不到开价，整条联动失效
    if (accountId === cfg.sourceAccountId) return
    const target = cfg.targets.find(t => t.accountId === accountId)
    if (!target?.follow || !target.disableSelfWatch) return
    if (!canSelfWatch(platformsRef.current[accountId])) return

    const running = await window.ipcRenderer
      .invoke(IPC_CHANNELS.tasks.autoMessage.getOpenPriceWatcherStatus, accountId)
      .catch(() => false)
    if (!running) return
    await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.autoMessage.stopOpenPriceWatcher, accountId)
    // 同步渲染层状态，否则这个账号的绿点会一直亮着
    useOpenPriceScriptStore.getState().setRunning(accountId, false)
    useOpenPriceScriptStore.getState().setError(accountId, null)
  })

  /**
   * 开启某个账号的开价监听。
   * **触发源必须先开启监听**，否则它检测不到开价，整条联动都不会跑。
   */
  const startWatcher = useMemoizedFn(async (accountId: string) => {
    const store = useOpenPriceScriptStore.getState()
    const config = store.contexts[accountId]?.config
    const messages = config?.messages ?? []
    const name = namesRef.current[accountId] ?? accountId
    if (messages.length === 0) {
      store.setError(accountId, '未配置开价话术')
      toast.error(`「${name}」还没配置开价话术，请先填写`)
      return
    }
    try {
      const ok = await window.ipcRenderer.invoke(
        IPC_CHANNELS.tasks.autoMessage.startOpenPriceWatcher,
        accountId,
        buildOpenPriceSendMessages(messages, config?.pinTopEnabled ?? true),
      )
      if (ok) {
        store.setRunning(accountId, true)
        toast.success(`「${name}」开价监听已启动`)
      } else {
        store.setError(accountId, '开启失败：请确认已连接中控台')
        toast.error(`「${name}」开价监听开启失败，请确认已连接中控台`)
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : '启动异常'
      store.setError(accountId, `开启失败：${reason}`)
      toast.error(`「${name}」开启失败：${reason}`)
    }
  })

  const stopWatcher = useMemoizedFn(async (accountId: string) => {
    const name = namesRef.current[accountId] ?? accountId
    try {
      await window.ipcRenderer.invoke(
        IPC_CHANNELS.tasks.autoMessage.stopOpenPriceWatcher,
        accountId,
      )
      const store = useOpenPriceScriptStore.getState()
      store.setRunning(accountId, false)
      store.setError(accountId, null)
      toast.success(`「${name}」已停止开价监听`)
    } catch (error) {
      toast.error(`「${name}」停止失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  })

  return {
    config,
    triggerManual,
    applySelfWatchPolicy,
    applySelfWatchPolicyFor,
    startWatcher,
    stopWatcher,
    sendTo,
    fanout,
  }
}

/**
 * 全局联动监听：挂在 App 层常驻。
 * 开价可能在任意页面发生，监听不能只挂在开价话术页，否则一切走就失效。
 */
export function useOpenPriceLinkageGlobal() {
  const accounts = useAccounts(state => state.accounts)
  const contexts = useLiveControlStore(state => state.contexts)

  const accountNames = useMemo(
    () => Object.fromEntries(accounts.map(a => [a.id, a.name])),
    [accounts],
  )
  const accountPlatforms = useMemo(
    () => Object.fromEntries(accounts.map(a => [a.id, contexts[a.id]?.platform])),
    [accounts, contexts],
  )
  const accountConnected = useMemo(
    () =>
      Object.fromEntries(accounts.map(a => [a.id, contexts[a.id]?.isConnected === 'connected'])),
    [accounts, contexts],
  )

  const { fanout, startWatcher, applySelfWatchPolicy } = useOpenPriceLinkage({
    accountNames,
    accountPlatforms,
    accountConnected,
  })

  useEffect(() => {
    const off = window.ipcRenderer.on(
      IPC_CHANNELS.tasks.autoMessage.openPriceWarmupTriggered,
      accountId => {
        const cfg = useOpenPriceLinkageStore.getState().config
        if (!cfg.enabled) return
        // 只有触发源账号的回调才联动，其它账号自身触发不放大
        if (!cfg.sourceAccountId || accountId !== cfg.sourceAccountId) return
        void fanout(accountId)
      },
    )
    return off
  }, [fanout])

  /**
   * 联动「自恢复」：开启联动后，触发源账号一旦连上中控台就自动拉起它自己的开价监听
   * （这是联动真正生效的前提——监听没起，主进程就不会广播 warmup，整条联动等于没通电）。
   * 同时按配置重跑一次「停用自身检测」策略：重连后跟随平台的自身监听可能被其它入口
   * （如一键开启的「开价话术」）拉起，必须按联动配置停掉，避免一条开价被发两次。
   * 这样重连 / 重装后，用户只需连上中控台，联动就自动接管，不必再手动点「开启监听」。
   *
   * 注意：只在「未运行」时才拉起，已运行则跳过，避免重复发 IPC；
   * 未配置话术时不拉起，避免启动时弹「未配置开价话术」报错。
   */
  const config = useOpenPriceLinkageStore(state => state.config)
  useEffect(() => {
    const sourceId = config.sourceAccountId
    if (!config.enabled || !sourceId) return
    if (!accountConnected[sourceId]) return
    const runtime = useOpenPriceScriptStore.getState().runtime[sourceId]
    const sourcePlatform = accountPlatforms[sourceId]
    // 「连接后自动开启」总闸：关闭时，连上中控台也不自动拉起触发源的开价监听
    // （否则联动会绕开关在连接瞬间擅自启动开价话术，与开关语义矛盾）。
    // 注意这里只卡「自动拉起」，用户手动在开价话术页点开启仍可正常启动。
    const autoStartAllowed =
      !sourcePlatform ||
      readQuickStartAutoStart(useQuickStartStore.getState().autoStart, sourceId, sourcePlatform)
    if (!runtime?.isRunning && autoStartAllowed) {
      const messages = useOpenPriceScriptStore.getState().contexts[sourceId]?.config.messages ?? []
      if (messages.some(m => m.content.trim() !== '')) {
        void startWatcher(sourceId)
      }
    }
    // 无论是否刚拉起，都按最新配置应用「停用自身检测」策略
    // （防止触发源监听在跑时，跟随平台自身检测重复发；该策略只停跟随端、不自动启动任何监听）
    void applySelfWatchPolicy()
  }, [config.enabled, config.sourceAccountId, accountConnected, accountPlatforms, startWatcher, applySelfWatchPolicy])
}
