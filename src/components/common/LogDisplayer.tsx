import { useMemoizedFn } from 'ahooks'
import type { LogMessage } from 'electron-log'
import { ArrowDown } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { useIpcListener } from '@/hooks/useIpc'
import { cn } from '@/lib/utils'

interface ParsedLog {
  id: string
  timestamp: string
  module: string
  level: string
  message: string
}

const MAX_LOG_MESSAGES = 200 // 停在底部时只保留最近 200 条
// 用户往上翻看历史时放宽上限：否则新日志进来会从头裁掉旧行，
// 你正在读的那几行会被"顶走"，看起来就像界面自己跳了。
const MAX_LOG_MESSAGES_WHILE_READING = 1200
// 距离底部多少像素以内算"还在底部"（握手区，避免像素级抖动导致误判）
const BOTTOM_THRESHOLD = 40

export default function LogDisplayer() {
  const [logMessages, setLogMessages] = useState<ParsedLog[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [atBottom, setAtBottom] = useState(true)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  // 事件回调里要读"当前是否在底部"，用 state 会拿到旧闭包，所以同时存一份 ref
  const atBottomRef = useRef(true)

  const scrollToBottom = useCallback((force = false) => {
    const el = viewportRef.current
    if (!el) return
    if (!force && !atBottomRef.current) return // 用户正在看历史，不要抢滚动
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [])

  const parseLogMessage = (log: LogMessage): ParsedLog | null => {
    if (!log.data || log.data.length === 0) {
      return null
    }
    return {
      id: crypto.randomUUID(),
      timestamp: log.date.toLocaleString(),
      module: log.scope ?? 'App',
      level: typeof log.level === 'string' ? log.level.toUpperCase() : 'INFO',
      // 只保留换行符之前的内容
      message: log.data.map(String).join(' ').split('\n')[0],
    }
  }

  // 绑定 ScrollArea 的 viewport，并跟踪"是否贴底"
  useEffect(() => {
    const root = scrollAreaRef.current
    if (!root) return
    const viewport = root.querySelector<HTMLDivElement>('[data-radix-scroll-area-viewport]')
    if (!viewport) return
    viewportRef.current = viewport

    const onScroll = () => {
      const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      const next = distance < BOTTOM_THRESHOLD
      atBottomRef.current = next
      setAtBottom(next)
    }
    viewport.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => viewport.removeEventListener('scroll', onScroll)
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: parseLogMessage 不影响
  const handleLogMessage = useCallback(
    (message: LogMessage) => {
      const parsed = parseLogMessage(message)
      if (!parsed) return
      const reading = !atBottomRef.current
      const cap = reading ? MAX_LOG_MESSAGES_WHILE_READING : MAX_LOG_MESSAGES
      setLogMessages(prev => [...prev.slice(-cap + 1), parsed])
      // 只有"自动滚动开着"且"人还停在底部"才跟随；否则保留用户的阅读位置
      if (autoScroll && !reading) {
        scrollToBottom()
      }
    },
    [autoScroll, scrollToBottom],
  )

  useIpcListener(IPC_CHANNELS.log, handleLogMessage)

  const autoScrollId = useId()

  return (
    <div className="h-full flex flex-col bg-background">
      {/* 日志头部 */}
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">运行日志</h3>
          <span className="text-xs text-muted-foreground">{logMessages.length} 条记录</span>
          {!atBottom && <span className="text-xs text-warning">已暂停跟随（你在看历史）</span>}
        </div>
        <div className="flex items-center gap-4">
          {/* 自动滚动开关 */}
          <div className="flex items-center gap-2">
            <Switch
              id={autoScrollId}
              checked={autoScroll}
              onCheckedChange={checked => {
                setAutoScroll(checked)
                if (checked) scrollToBottom(true)
              }}
            />
            <label
              htmlFor={autoScrollId}
              className="text-xs text-muted-foreground cursor-pointer select-none"
            >
              自动滚动
            </label>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLogMessages([])
              scrollToBottom(true)
            }}
            className="text-xs h-7 px-2 text-muted-foreground hover:text-destructive"
          >
            清空
          </Button>
        </div>
      </div>

      {/* 日志内容 */}
      <div className="relative min-h-0 flex-1">
        <ScrollArea ref={scrollAreaRef} className="h-full">
          <div className="p-4 font-mono text-sm">
            {logMessages.map((log, index) => (
              <LogItem key={log.id} log={log} index={index} />
            ))}
          </div>
        </ScrollArea>
        {/* 往上翻之后给一个显式入口，不用自己滚回底部 */}
        {!atBottom && (
          <button
            type="button"
            onClick={() => {
              setAutoScroll(true)
              scrollToBottom(true)
            }}
            className="absolute bottom-3 right-5 flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground shadow-sm transition-colors hover:bg-muted"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            回到最新
          </button>
        )}
      </div>
    </div>
  )
}

function LogItem({ log, index }: { log: ParsedLog; index: number }) {
  const getLevelColor = useMemoizedFn((level: string): string => {
    switch (level.toUpperCase()) {
      case 'ERROR':
        return 'text-destructive font-medium'
      case 'FATAL':
        return 'text-destructive font-bold'
      case 'WARN':
        return 'text-warning font-medium'
      case 'DEBUG':
        return 'text-muted-foreground'
      case 'INFO':
        return 'text-muted-foreground'
      case 'SUCCESS':
        return 'text-success'
      case 'NOTE':
        return 'text-foreground'
      default:
        return 'text-muted-foreground'
    }
  })
  return (
    <div
      key={log.id}
      className={cn(
        'flex gap-2 items-start py-1 whitespace-nowrap',
        index % 2 === 0 ? 'bg-muted/40' : 'bg-background',
      )}
    >
      <span className="text-muted-foreground shrink-0">[{log.timestamp}]</span>
      <span className="text-foreground/70 shrink-0">[{log.module}]</span>
      <span className={cn('shrink-0', getLevelColor(log.level))}>{log.level}</span>
      <span className="text-foreground truncate">{log.message}</span>
    </div>
  )
}
