import { ArrowDown } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { type ParsedLog, useLogsStore } from '@/hooks/useLogs'
import { cn } from '@/lib/utils'

// 距离底部多少像素以内算"还在底部"（握手区，避免像素级抖动导致误判）
const BOTTOM_THRESHOLD = 40

type Filter = 'all' | 'error' | `cat:${string}`

/** 模块名规整：`@小红书 -> 自动弹窗` → `小红书 · 自动弹窗` */
function prettifyModule(raw: string): string {
  return raw
    .replace(/^@/, '')
    .replace(/\s*->\s*/g, ' · ')
    .trim()
}

/** 归到筛选条上的某一类；认不出来的都归「其它」 */
function categoryOf(log: ParsedLog): string {
  const s = `${log.module} ${log.message}`
  if (s.includes('自动发言')) return '自动发言'
  if (s.includes('开价')) return '开价话术'
  if (s.includes('弹窗')) return '自动弹窗'
  if (s.includes('自动回复') || s.includes('真@') || s.includes('评论')) return '自动回复'
  if (s.includes('红包')) return '红包'
  if (log.module.includes('Provider') || log.module.includes('update')) return '系统'
  return '其它'
}

const isError = (log: ParsedLog) => log.level === 'ERROR' || log.level === 'FATAL'

/** 级别胶囊的配色（参考设计稿：ERROR 红 / SUCCESS 绿 / INFO 灰） */
function levelStyle(level: string): string {
  switch (level) {
    case 'ERROR':
    case 'FATAL':
      return 'bg-destructive/15 text-destructive'
    case 'WARN':
      return 'bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]'
    case 'SUCCESS':
      return 'bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]'
    case 'NOTE':
      return 'bg-foreground/10 text-foreground'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

export default function LogDisplayer() {
  const logMessages = useLogsStore(s => s.messages)
  const clear = useLogsStore(s => s.clear)
  const [autoScroll, setAutoScroll] = useState(true)
  const [atBottom, setAtBottom] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  // 事件回调里要读"当前是否在底部"，用 state 会拿到旧闭包，所以同时存一份 ref
  const atBottomRef = useRef(true)

  const scrollToBottom = (force = false) => {
    const el = viewportRef.current
    if (!el) return
    if (!force && !atBottomRef.current) return // 用户正在看历史，不要抢滚动
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
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

  // 统计各类别条数，生成筛选条
  const { chips, filtered } = useMemo(() => {
    const counts = new Map<string, number>()
    for (const log of logMessages) {
      const c = categoryOf(log)
      counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    const errorCount = logMessages.filter(isError).length
    const chipList: { key: Filter; label: string; count: number }[] = [
      { key: 'all', label: '全部', count: logMessages.length },
      ...(errorCount > 0 ? [{ key: 'error' as Filter, label: '错误', count: errorCount }] : []),
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([label, count]) => ({ key: `cat:${label}` as Filter, label, count })),
    ]
    const list =
      filter === 'all'
        ? logMessages
        : filter === 'error'
          ? logMessages.filter(isError)
          : logMessages.filter(log => categoryOf(log) === filter.slice(4))
    return { chips: chipList, filtered: list }
  }, [logMessages, filter])

  // 有新日志（或切筛选）时跟随，但只在"人还停在底部"时
  // biome-ignore lint/correctness/useExhaustiveDependencies: 靠条数变化触发跟随
  useEffect(() => {
    if (autoScroll && atBottomRef.current) scrollToBottom()
  }, [filtered.length, filter, autoScroll])

  const autoScrollId = useId()

  return (
    <div className="flex h-full flex-col bg-background">
      {/* 头部：标题 + 开关 */}
      <div className="flex items-center justify-between px-4 pb-1 pt-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">运行日志</h3>
          <span className="text-xs text-muted-foreground">{logMessages.length} 条</span>
          {!atBottom && <span className="text-xs text-warning">已暂停跟随</span>}
        </div>
        <div className="flex items-center gap-4">
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
              className="cursor-pointer select-none text-xs text-muted-foreground"
            >
              自动滚动
            </label>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              clear()
              scrollToBottom(true)
            }}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
          >
            清空
          </Button>
        </div>
      </div>

      {/* 筛选条 */}
      <div className="flex flex-wrap items-center gap-1 px-4 pb-2">
        {chips.map(chip => {
          const active = filter === chip.key
          const isErrChip = chip.key === 'error'
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => setFilter(chip.key)}
              className={cn(
                'rounded-md px-2 py-1 text-xs transition-colors',
                active
                  ? isErrChip
                    ? 'bg-destructive/15 font-medium text-destructive'
                    : 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {chip.label}
              <span className={cn('ml-1 tabular-nums', active ? 'opacity-80' : 'opacity-60')}>
                {chip.count}
              </span>
            </button>
          )
        })}
      </div>

      {/* 日志内容 */}
      <div className="relative min-h-0 flex-1 border-t">
        <ScrollArea ref={scrollAreaRef} className="h-full">
          <div className="py-1">
            {filtered.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">暂无日志</p>
            ) : (
              filtered.map((log, index) => <LogItem key={log.id} log={log} index={index} />)
            )}
          </div>
        </ScrollArea>
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
  const error = isError(log)
  // 只显示时分秒（原始 timestamp 是 toLocaleString 的完整日期）
  const time = log.timestamp.split(' ')[1] ?? log.timestamp
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-4 py-[5px] text-xs hover:bg-muted/60',
        index % 2 === 1 && 'bg-muted/30',
      )}
    >
      <span className="w-[62px] shrink-0 tabular-nums text-muted-foreground">{time}</span>
      <span
        className={cn(
          'w-[62px] shrink-0 rounded px-1.5 py-0.5 text-center font-medium text-[11px]',
          levelStyle(log.level),
        )}
      >
        {log.level}
      </span>
      <span className="max-w-[168px] shrink-0 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
        {prettifyModule(log.module)}
      </span>
      <span
        className={cn('min-w-0 flex-1 truncate', error ? 'text-destructive' : 'text-foreground')}
        title={log.message}
      >
        {log.message}
      </span>
    </div>
  )
}
