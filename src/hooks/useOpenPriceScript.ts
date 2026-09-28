import { useMemoizedFn } from 'ahooks'
import { useEffect, useMemo, useRef } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { useShallow } from 'zustand/react/shallow'
import { EVENTS, eventEmitter } from '@/utils/events'
import { useAccounts } from './useAccounts'
import type { Message } from './useAutoMessage'
import { useToast } from './useToast'

interface OpenPriceScriptConfig {
  messages: Message[]
  /** 开价时是否把第一条话术置顶/上墙到直播间公屏（默认开） */
  pinTopEnabled: boolean
}

interface OpenPriceScriptContext {
  config: OpenPriceScriptConfig
}

const defaultContext = (): OpenPriceScriptContext => ({
  config: {
    messages: [],
    pinTopEnabled: true,
  },
})

/**
 * 组装开价话术待发送列表：首条是否置顶由 pinTopEnabled 决定，其余沿用各自置顶设置。
 * 主进程不再强制置顶首条，置顶决策统一在渲染层这里完成，
 * 保证「置顶开关」对自检测路径（抖音/视频号）与跨平台联动路径都生效。
 */
export function buildOpenPriceSendMessages(
  messages: Message[],
  pinTopEnabled: boolean,
): { content: string; pinTop: boolean }[] {
  return messages.map((m, i) => ({
    content: m.content,
    pinTop: i === 0 ? pinTopEnabled : m.pinTop,
  }))
}

/** 开价话术的运行时状态（不持久化，按账号隔离） */
interface OpenPriceRuntime {
  /** 开价监听是否在运行 */
  isRunning: boolean
  /** 最近一次「开启」失败的原因，null = 没有失败 */
  error: string | null
}

const defaultRuntime = (): OpenPriceRuntime => ({
  isRunning: false,
  error: null,
})

interface OpenPriceScriptStore {
  contexts: Record<string, OpenPriceScriptContext>
  setConfig: (accountId: string, config: Partial<OpenPriceScriptConfig>) => void
  /** 按账号的运行时状态（不持久化） */
  runtime: Record<string, OpenPriceRuntime>
  setRunning: (accountId: string, running: boolean) => void
  setError: (accountId: string, error: string | null) => void
}

export const useOpenPriceScriptStore = create<OpenPriceScriptStore>()(
  persist(
    immer(set => {
      eventEmitter.on(EVENTS.ACCOUNT_REMOVED, (accountId: string) => {
        set(state => {
          delete state.contexts[accountId]
          delete state.runtime[accountId]
        })
      })

      eventEmitter.on(EVENTS.ACCOUNT_ADDED, (accountId: string) => {
        set(state => {
          state.contexts[accountId] = defaultContext()
        })
      })

      const ensureContext = (state: OpenPriceScriptStore, accountId: string) => {
        if (!state.contexts[accountId]) {
          state.contexts[accountId] = defaultContext()
        }
        return state.contexts[accountId]
      }

      const ensureRuntime = (state: OpenPriceScriptStore, accountId: string) => {
        if (!state.runtime[accountId]) {
          state.runtime[accountId] = defaultRuntime()
        }
        return state.runtime[accountId]
      }

      return {
        contexts: { default: defaultContext() },
        runtime: {},
        setRunning: (accountId, running) =>
          set(state => {
            const r = ensureRuntime(state, accountId)
            r.isRunning = running
            // 成功开启即代表上一次的失败已经过去，清掉红点
            if (running) {
              r.error = null
            }
          }),
        setError: (accountId, error) =>
          set(state => {
            const r = ensureRuntime(state, accountId)
            r.error = error
            // 失败时一定不是在跑，避免绿点红点同时出现
            if (error) {
              r.isRunning = false
            }
          }),
        setConfig: (accountId, config) =>
          set(state => {
            const context = ensureContext(state, accountId)
            context.config = {
              ...state.contexts[accountId].config,
              ...config,
            }
          }),
      }
    }),
    {
      name: 'open-price-script-storage',
      version: 1,
      partialize: state => ({
        contexts: Object.fromEntries(
          Object.entries(state.contexts).map(([accountId, context]) => [
            accountId,
            { config: context.config },
          ]),
        ),
      }),
    },
  ),
)

export const useOpenPriceScriptActions = () => {
  const setConfig = useOpenPriceScriptStore(state => state.setConfig)
  const setRunning = useOpenPriceScriptStore(state => state.setRunning)
  const setError = useOpenPriceScriptStore(state => state.setError)
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const updateConfig = useMemoizedFn((newConfig: Partial<OpenPriceScriptConfig>) => {
    setConfig(currentAccountId, newConfig)
  })

  return useMemo(
    () => ({
      setMessages: (messages: Message[]) => updateConfig({ messages }),
      setPinTopEnabled: (pinTopEnabled: boolean) => updateConfig({ pinTopEnabled }),
      setRunning: (running: boolean) => setRunning(currentAccountId, running),
      setError: (error: string | null) => setError(currentAccountId, error),
    }),
    [updateConfig, setRunning, setError, currentAccountId],
  )
}

export const useCurrentOpenPriceScript = <T>(getter: (context: OpenPriceScriptContext) => T): T => {
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const defaultContextRef = useRef(defaultContext())
  return useOpenPriceScriptStore(
    useShallow(state => {
      const context = state.contexts[currentAccountId] ?? defaultContextRef.current
      return getter(context)
    }),
  )
}

/** 当前账号的开价话术运行时状态（监听是否在运行 / 最近一次开启失败原因） */
export const useCurrentOpenPriceRuntime = (): OpenPriceRuntime => {
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const defaultRuntimeRef = useRef(defaultRuntime())
  return useOpenPriceScriptStore(
    useShallow(state => state.runtime[currentAccountId] ?? defaultRuntimeRef.current),
  )
}

/**
 * 开价话术状态同步：把渲染层的状态校正成主进程的真实状态。
 * 必须常驻在 App 层，不能只挂在「开价话术」页——
 * 否则在其他页面切换账号时状态不会更新，会显示成别的账号的状态。
 */
export const useOpenPriceStatusSync = () => {
  const accountId = useAccounts(state => state.currentAccountId)
  const setRunning = useOpenPriceScriptStore(state => state.setRunning)

  useEffect(() => {
    if (!accountId) {
      return
    }
    let cancelled = false
    window.ipcRenderer
      .invoke(IPC_CHANNELS.tasks.autoMessage.getOpenPriceWatcherStatus, accountId)
      .then(running => {
        if (!cancelled) {
          setRunning(accountId, Boolean(running))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRunning(accountId, false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [accountId, setRunning])
}

/**
 * 开价话术任务控制：封装「开始任务 / 停止任务」，配合顶部 TaskButton 使用。
 * 行为与其他功能（自动发言 / 自动弹窗）一致：点击开始 → 启动中控台监听，
 * 点击停止 → 取消监听。
 */
export const useOpenPriceScriptTaskControl = () => {
  const { isRunning } = useCurrentOpenPriceRuntime()
  const setRunning = useOpenPriceScriptStore(state => state.setRunning)
  const setError = useOpenPriceScriptStore(state => state.setError)
  const { toast } = useToast()
  const accountId = useAccounts(store => store.currentAccountId)

  // 真实状态由 App 层的 useOpenPriceStatusSync 负责校正，这里不再重复回查，
  // 避免「在 A 账号回查的结果覆盖掉 B 账号的状态」。

  const onStartTask = useMemoizedFn(async () => {
    if (!accountId) {
      toast.error('请先选择一个账号')
      return
    }
    const config = useOpenPriceScriptStore.getState().contexts[accountId]?.config
    const messages = config?.messages ?? []
    if (messages.length === 0) {
      setError(accountId, '未配置开价话术')
      toast.error('请先配置至少一条话术')
      return
    }
    try {
      const ok = await window.ipcRenderer.invoke(
        IPC_CHANNELS.tasks.autoMessage.startOpenPriceWatcher,
        accountId,
        buildOpenPriceSendMessages(messages, config?.pinTopEnabled ?? true),
      )
      if (ok) {
        setRunning(accountId, true)
        toast.success('开价话术监听已启动')
      } else {
        setError(accountId, '启动失败，请确认已连接中控台')
        toast.error('开价话术监听启动失败，请确认已连接中控台')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(accountId, `启动失败：${msg}`)
      toast.error(`启动失败：${msg}`)
    }
  })

  const onStopTask = useMemoizedFn(async () => {
    if (!accountId) {
      return
    }
    try {
      await window.ipcRenderer.invoke(
        IPC_CHANNELS.tasks.autoMessage.stopOpenPriceWatcher,
        accountId,
      )
      setRunning(accountId, false)
      setError(accountId, null)
      toast.success('已停止开价话术监听')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(accountId, `停止失败：${msg}`)
      toast.error(`停止失败：${msg}`)
    }
  })

  return { isRunning, onStartTask, onStopTask }
}
