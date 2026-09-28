import { useMemoizedFn } from 'ahooks'
import { useEffect, useRef } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { autoReplyPlatforms, openPriceSelfDetectPlatforms, platformLabels } from '@/abilities'
import { useAccounts } from '@/hooks/useAccounts'
import { useAutoMessageStore } from '@/hooks/useAutoMessage'
import { useAutoPopUpStore } from '@/hooks/useAutoPopUp'
import { useAutoReplyStore } from '@/hooks/useAutoReply'
import { useAutoReplyConfigStore } from '@/hooks/useAutoReplyConfig'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { buildOpenPriceSendMessages, useOpenPriceScriptStore } from '@/hooks/useOpenPriceScript'
import { useToast } from '@/hooks/useToast'

export type QuickStartKey = 'autoMessage' | 'autoPopUp' | 'autoReply' | 'openPrice'

export const QUICK_START_LABELS: Record<QuickStartKey, string> = {
  autoMessage: '自动发言',
  autoPopUp: '自动弹窗',
  autoReply: '自动回复',
  openPrice: '开价话术',
}

/** 所有平台（用于初始化每个平台各自的勾选状态） */
const ALL_PLATFORMS = Object.keys(platformLabels) as LiveControlPlatform[]

/** 单个平台默认的勾选：自动发言/自动弹窗/自动回复 默认开，开价话术默认关 */
const DEFAULT_PER_PLATFORM: Record<QuickStartKey, boolean> = {
  autoMessage: true,
  autoPopUp: true,
  autoReply: true,
  openPrice: false,
}

/** 构建「每个平台各自一份默认勾选」的初始状态 */
function buildDefaultSelection(): Record<LiveControlPlatform, Record<QuickStartKey, boolean>> {
  const out = {} as Record<LiveControlPlatform, Record<QuickStartKey, boolean>>
  for (const platform of ALL_PLATFORMS) {
    out[platform] = { ...DEFAULT_PER_PLATFORM }
  }
  return out
}

/**
 * 各功能限定的平台，不在列表里 = 该平台不支持启动。
 * 一键开启 / 连接后自动开启都必须按这个过滤，
 * 否则在快手 / 小红书等平台上会去启动「开价监听」必然失败，白亮一个红点。
 */
export const QUICK_START_SUPPORTED_PLATFORMS: Partial<
  Record<QuickStartKey, LiveControlPlatform[]>
> = {
  autoReply: autoReplyPlatforms,
  openPrice: openPriceSelfDetectPlatforms,
}

/** 该平台能否启动这个功能（没配限制 = 所有平台都行） */
export const isQuickStartSupported = (key: QuickStartKey, platform?: LiveControlPlatform) => {
  const allowed = QUICK_START_SUPPORTED_PLATFORMS[key]
  return !allowed || !platform || allowed.includes(platform)
}

interface QuickStartStore {
  /** 每个平台各自记住一键开启要启动哪些功能（互不影响） */
  selection: Record<LiveControlPlatform, Record<QuickStartKey, boolean>>
  /** 连接中控台成功后是否自动开启 */
  autoStartOnConnect: boolean
  toggle: (platform: LiveControlPlatform, key: QuickStartKey, checked: boolean) => void
  setAutoStartOnConnect: (enabled: boolean) => void
}

export const useQuickStartStore = create<QuickStartStore>()(
  persist(
    immer(set => ({
      selection: buildDefaultSelection(),
      autoStartOnConnect: true,
      toggle: (platform, key, checked) =>
        set(state => {
          if (!state.selection[platform]) {
            state.selection[platform] = { ...DEFAULT_PER_PLATFORM }
          }
          state.selection[platform][key] = checked
        }),
      setAutoStartOnConnect: enabled =>
        set(state => {
          state.autoStartOnConnect = enabled
        }),
    })),
    {
      name: 'quick-start-storage',
      version: 2,
      migrate: (persisted: any, version: number) => {
        // 旧版本（v1）的 selection 是全局的 Record<QuickStartKey, boolean>，
        // 把它当作「所有平台共用的初始勾选」迁移成按平台隔离的结构。
        if (version < 2) {
          const old = persisted?.selection
          const base: Record<QuickStartKey, boolean> = { ...DEFAULT_PER_PLATFORM }
          if (old && typeof old === 'object' && typeof old.autoMessage === 'boolean') {
            for (const k of Object.keys(base) as QuickStartKey[]) {
              if (typeof old[k] === 'boolean') base[k] = old[k]
            }
          }
          const selection = buildDefaultSelection()
          for (const platform of ALL_PLATFORMS) {
            selection[platform] = { ...base }
          }
          return { ...persisted, selection }
        }
        return persisted as QuickStartStore
      },
    },
  ),
)

type StartResult = { name: string; ok: boolean; reason?: string }

/** 主进程的任务类型 -> 一键开启里的功能 key */
const RESUMABLE_TASK_TO_KEY: Record<string, QuickStartKey> = {
  'auto-comment': 'autoMessage',
  'auto-popup': 'autoPopUp',
  'comment-listener': 'autoReply',
  'open-price': 'openPrice',
}

/**
 * 断线现场：accountId -> 断线前还在运行的功能。
 * 断线时由 App 层的 disconnectedEvent 处理器写入，重连成功后消费一次即清空。
 */
const pendingResume = new Map<string, QuickStartKey[]>()

/** 断线时记录现场（主进程会把仍在运行的任务类型带过来） */
export function markDisconnectedTasks(accountId: string, taskTypes: string[]) {
  const keys = taskTypes
    .map(type => RESUMABLE_TASK_TO_KEY[type])
    .filter((key): key is QuickStartKey => Boolean(key))
  if (keys.length > 0) {
    pendingResume.set(accountId, keys)
  }
}

/** 取出并清空现场 */
function consumePendingResume(accountId: string): QuickStartKey[] {
  const keys = pendingResume.get(accountId) ?? []
  pendingResume.delete(accountId)
  return keys
}

/**
 * 各功能的启动/停止实现。
 * 直接复用各页面原本的调用方式（IPC + 对应 store 的运行状态），
 * 保证在首页操作和在各自页面点「开始任务」的效果完全一致。
 */
function useFeatureControls() {
  const { toast } = useToast()

  const startAutoMessage = useMemoizedFn(async (accountId: string): Promise<StartResult> => {
    const name = QUICK_START_LABELS.autoMessage
    const config = useAutoMessageStore.getState().contexts[accountId]?.config
    if (!config || config.messages.length === 0) {
      return { name, ok: false, reason: '未配置发言内容' }
    }
    try {
      const ok = await window.ipcRenderer.invoke(
        IPC_CHANNELS.tasks.autoMessage.start,
        accountId,
        config,
      )
      useAutoMessageStore.getState().setIsRunning(accountId, Boolean(ok))
      return { name, ok: Boolean(ok), reason: ok ? undefined : '启动失败' }
    } catch (error) {
      return { name, ok: false, reason: error instanceof Error ? error.message : '启动异常' }
    }
  })

  const stopAutoMessage = useMemoizedFn(async (accountId: string) => {
    await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.autoMessage.stop, accountId)
    useAutoMessageStore.getState().setIsRunning(accountId, false)
  })

  const startAutoPopUp = useMemoizedFn(async (accountId: string): Promise<StartResult> => {
    const name = QUICK_START_LABELS.autoPopUp
    const config = useAutoPopUpStore.getState().contexts[accountId]?.config
    if (!config || config.goodsIds.length === 0) {
      return { name, ok: false, reason: '未配置弹窗商品' }
    }
    try {
      const ok = await window.ipcRenderer.invoke(
        IPC_CHANNELS.tasks.autoPopUp.start,
        accountId,
        config,
      )
      useAutoPopUpStore.getState().setIsRunning(accountId, Boolean(ok))
      return { name, ok: Boolean(ok), reason: ok ? undefined : '启动失败' }
    } catch (error) {
      return { name, ok: false, reason: error instanceof Error ? error.message : '启动异常' }
    }
  })

  const stopAutoPopUp = useMemoizedFn(async (accountId: string) => {
    await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.autoPopUp.stop, accountId)
    useAutoPopUpStore.getState().setIsRunning(accountId, false)
  })

  // 自动回复 = 启动评论监听 + 打开回复开关，两步缺一不可
  const startAutoReply = useMemoizedFn(async (accountId: string): Promise<StartResult> => {
    const name = QUICK_START_LABELS.autoReply
    const config = useAutoReplyConfigStore.getState().contexts[accountId]?.config
    try {
      const ok = await window.ipcRenderer.invoke(
        IPC_CHANNELS.tasks.autoReply.startCommentListener,
        accountId,
        {
          source: config?.entry ?? 'control',
          ws: config?.ws?.enable ? { port: config.ws.port } : undefined,
        },
      )
      if (!ok) {
        useAutoReplyStore.getState().setIsListening(accountId, 'error')
        return { name, ok: false, reason: '评论监听启动失败' }
      }
      useAutoReplyStore.getState().setIsListening(accountId, 'listening')
      useAutoReplyStore.getState().setIsRunning(accountId, true)
      return { name, ok: true }
    } catch (error) {
      return { name, ok: false, reason: error instanceof Error ? error.message : '启动异常' }
    }
  })

  const stopAutoReply = useMemoizedFn(async (accountId: string) => {
    useAutoReplyStore.getState().setIsRunning(accountId, false)
    await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.autoReply.stopCommentListener, accountId)
    useAutoReplyStore.getState().setIsListening(accountId, 'stopped')
  })

  const startOpenPrice = useMemoizedFn(async (accountId: string): Promise<StartResult> => {
    const name = QUICK_START_LABELS.openPrice
    const config = useOpenPriceScriptStore.getState().contexts[accountId]?.config
    const messages = config?.messages ?? []
    if (messages.length === 0) {
      return { name, ok: false, reason: '未配置话术' }
    }
    try {
      const ok = await window.ipcRenderer.invoke(
        IPC_CHANNELS.tasks.autoMessage.startOpenPriceWatcher,
        accountId,
        buildOpenPriceSendMessages(messages, config?.pinTopEnabled ?? true),
      )
      if (ok) {
        useOpenPriceScriptStore.getState().setRunning(accountId, true)
      } else {
        useOpenPriceScriptStore.getState().setError(accountId, '开启失败：请确认已连接中控台')
      }
      return { name, ok: Boolean(ok), reason: ok ? undefined : '请确认已连接中控台' }
    } catch (error) {
      const reason = error instanceof Error ? error.message : '启动异常'
      useOpenPriceScriptStore.getState().setError(accountId, `开启失败：${reason}`)
      return { name, ok: false, reason }
    }
  })

  const stopOpenPrice = useMemoizedFn(async (accountId: string) => {
    await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.autoMessage.stopOpenPriceWatcher, accountId)
    useOpenPriceScriptStore.getState().setRunning(accountId, false)
    useOpenPriceScriptStore.getState().setError(accountId, null)
  })

  /** 读取各功能的真实运行状态，用于「只停止正在运行的」，避免对未运行的任务发停止指令 */
  const getRunning = useMemoizedFn((key: QuickStartKey, accountId: string): boolean => {
    switch (key) {
      case 'autoMessage':
        return Boolean(useAutoMessageStore.getState().contexts[accountId]?.isRunning)
      case 'autoPopUp':
        return Boolean(useAutoPopUpStore.getState().contexts[accountId]?.isRunning)
      case 'autoReply':
        return Boolean(useAutoReplyStore.getState().contexts[accountId]?.isRunning)
      case 'openPrice':
        return Boolean(useOpenPriceScriptStore.getState().runtime[accountId]?.isRunning)
    }
  })

  const startByKey: Record<QuickStartKey, (accountId: string) => Promise<StartResult>> = {
    autoMessage: startAutoMessage,
    autoPopUp: startAutoPopUp,
    autoReply: startAutoReply,
    openPrice: startOpenPrice,
  }

  const stopByKey: Record<QuickStartKey, (accountId: string) => Promise<void>> = {
    autoMessage: stopAutoMessage,
    autoPopUp: stopAutoPopUp,
    autoReply: stopAutoReply,
    openPrice: stopOpenPrice,
  }

  return { startByKey, stopByKey, getRunning, toast }
}

export function useQuickStart() {
  const platform = useCurrentLiveControl(context => context.platform)
  const selection = useQuickStartStore(s => s.selection[platform] ?? DEFAULT_PER_PLATFORM)
  const autoStartOnConnect = useQuickStartStore(s => s.autoStartOnConnect)
  const toggle = useQuickStartStore(s => s.toggle)
  const setAutoStartOnConnect = useQuickStartStore(s => s.setAutoStartOnConnect)
  const { currentAccountId } = useAccounts()
  const { startByKey, stopByKey, getRunning, toast } = useFeatureControls()

  const startAll = useMemoizedFn(async () => {
    if (!currentAccountId) {
      toast.error('请先选择一个账号')
      return
    }
    // 按平台过滤：当前平台不支持的功能不启动，避免必然失败、白亮红点
    const keys = (Object.keys(selection) as QuickStartKey[]).filter(
      k => selection[k] && isQuickStartSupported(k, platform),
    )
    if (keys.length === 0) {
      toast.error('请至少勾选一项功能')
      return
    }
    const results: StartResult[] = []
    // 串行启动，避免多个任务同时初始化产生竞态
    for (const key of keys) {
      results.push(await startByKey[key](currentAccountId))
    }
    reportResults(toast, results, '开启')
  })

  const stopAll = useMemoizedFn(async () => {
    if (!currentAccountId) {
      return
    }
    const keys = (Object.keys(selection) as QuickStartKey[]).filter(
      k => selection[k] && getRunning(k, currentAccountId),
    )
    if (keys.length === 0) {
      toast.error('勾选的功能都没有在运行')
      return
    }
    const failures: string[] = []
    for (const key of keys) {
      try {
        await stopByKey[key](currentAccountId)
      } catch {
        failures.push(QUICK_START_LABELS[key])
      }
    }
    if (failures.length > 0) {
      toast.error(`以下功能停止失败：${failures.join('、')}`)
    } else {
      toast.success(`已停止：${keys.map(k => QUICK_START_LABELS[k]).join('、')}`)
    }
  })

  return { selection, autoStartOnConnect, toggle, setAutoStartOnConnect, startAll, stopAll }
}

function reportResults(
  toast: ReturnType<typeof useToast>['toast'],
  results: StartResult[],
  action: string,
) {
  const ok = results.filter(r => r.ok)
  const failed = results.filter(r => !r.ok)
  if (ok.length > 0) {
    toast.success(`已${action}：${ok.map(r => r.name).join('、')}`)
  }
  if (failed.length > 0) {
    toast.error(
      `${failed.map(r => r.name).join('、')}${action}失败：${failed
        .map(r => `${r.name}(${r.reason ?? '未知原因'})`)
        .join('；')}`,
    )
  }
}

/**
 * 连接中控台成功后自动开启功能。放在 App 层执行，这样无论当时停留在哪个页面都能触发。
 *
 * 启动清单 = 「连接后自动开启」勾选的功能 ∪ 断线前正在运行的功能。
 * 后者是断线自动恢复：断线（浏览器被关 / 网络抖动）会把所有任务停掉，
 * 不恢复的话用户就得回到各自页面一个个手动重开——历史上最坑的是「自动回复」，
 * 界面还显示在监听，实际一条弹幕都进不来。
 */
export function useQuickStartAutoStart() {
  const isConnected = useCurrentLiveControl(context => context.isConnected)
  const platform = useCurrentLiveControl(context => context.platform)
  const { currentAccountId } = useAccounts()
  const autoStartOnConnect = useQuickStartStore(s => s.autoStartOnConnect)
  const selection = useQuickStartStore(s => s.selection)
  const { startByKey, toast } = useFeatureControls()
  // 当前平台各自的勾选（不存在则回落到默认）
  const platformSelection = selection[platform] ?? DEFAULT_PER_PLATFORM

  const lastConnectedRef = useRef(false)

  useEffect(() => {
    const connected = isConnected === 'connected'
    // 只在「未连接 -> 已连接」的瞬间触发一次
    if (connected && !lastConnectedRef.current) {
      lastConnectedRef.current = true
      if (currentAccountId) {
        const keys = new Set<QuickStartKey>()
        // 断线前正在跑的，优先恢复现场
        const resumed = consumePendingResume(currentAccountId)
        for (const key of resumed) {
          keys.add(key)
        }
        // 再叠加「连接后自动开启」的勾选项（按当前平台各自的勾选）
        if (autoStartOnConnect) {
          for (const key of Object.keys(platformSelection) as QuickStartKey[]) {
            if (platformSelection[key]) {
              keys.add(key)
            }
          }
        }
        // 按平台过滤：不支持的功能不启动（如在快手 / 小红书上启动开价监听必然失败）
        const toStart = Array.from(keys).filter(k => isQuickStartSupported(k, platform))
        if (toStart.length > 0) {
          ;(async () => {
            const results: StartResult[] = []
            for (const key of toStart) {
              results.push(await startByKey[key](currentAccountId))
            }
            // 断线恢复和「自动开启」可能同时命中，统一按「开启」提示即可
            reportResults(toast, results, resumed.length > 0 ? '恢复' : '开启')
          })()
        }
      }
    } else if (!connected) {
      lastConnectedRef.current = false
    }
  }, [isConnected, autoStartOnConnect, currentAccountId, selection, startByKey, toast, platform])
}
