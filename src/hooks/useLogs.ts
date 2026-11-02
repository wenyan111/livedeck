import type { LogMessage } from 'electron-log'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { create } from 'zustand'
import { useIpcListener } from '@/hooks/useIpc'

export interface ParsedLog {
  id: string
  /** 本地时间字符串（展示用） */
  timestamp: string
  /** epoch 毫秒（算「几秒前」用） */
  at: number
  module: string
  level: string
  message: string
}

// 常驻缓冲：日志面板收起时也要继续收集，否则一收起就丢日志。
// 1200 条足够翻很久，超出后从头部裁掉——正常一场播不会到这个量。
const MAX_LOG_MESSAGES = 1200

interface LogsStore {
  messages: ParsedLog[]
  /** 缓冲区里的错误总条数（ERROR + FATAL），筛选条用 */
  errorCount: number
  /** 还没被"看过"的错误数：收起条上的红点用它，展开看过之后清零 */
  unreadErrorCount: number
  clear: () => void
  push: (log: ParsedLog) => void
  /** 标记错误已读（展开面板 / 点「失败」筛选 时调用） */
  ackErrors: () => void
}

export const useLogsStore = create<LogsStore>(set => ({
  messages: [],
  errorCount: 0,
  unreadErrorCount: 0,
  clear: () => set({ messages: [], errorCount: 0, unreadErrorCount: 0 }),
  ackErrors: () => set({ unreadErrorCount: 0 }),
  push: log =>
    set(state => {
      const next =
        state.messages.length >= MAX_LOG_MESSAGES
          ? [...state.messages.slice(1), log]
          : [...state.messages, log]
      const isErr = log.level === 'ERROR' || log.level === 'FATAL'
      return {
        messages: next,
        unreadErrorCount: state.unreadErrorCount + (isErr ? 1 : 0),
        errorCount:
          state.errorCount +
          (log.level === 'ERROR' || log.level === 'FATAL' ? 1 : 0) -
          (state.messages.length >= MAX_LOG_MESSAGES &&
          (state.messages[0]?.level === 'ERROR' || state.messages[0]?.level === 'FATAL')
            ? 1
            : 0),
      }
    }),
}))

function parseLogMessage(log: LogMessage): ParsedLog | null {
  if (!log.data || log.data.length === 0) return null
  return {
    id: crypto.randomUUID(),
    timestamp: log.date.toLocaleString(),
    at: log.date.getTime(),
    module: log.scope ?? 'App',
    level: typeof log.level === 'string' ? log.level.toUpperCase() : 'INFO',
    // 只保留换行符之前的内容
    message: log.data.map(String).join(' ').split('\n')[0],
  }
}

/**
 * 在 App 里调用一次，把主进程日志收进 store。
 *
 * 之前监听放在 LogDisplayer 内部，面板一收起组件就卸载，日志也跟着断——
 * 收起来那段时间完全看不到历史，展开后才发现是空的。
 */
export function useLogCollector() {
  useIpcListener(IPC_CHANNELS.log, (message: LogMessage) => {
    const parsed = parseLogMessage(message)
    if (parsed) useLogsStore.getState().push(parsed)
  })
}
