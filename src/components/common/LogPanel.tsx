import { ChevronDown, ChevronUp, Terminal } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useLogsStore } from '@/hooks/useLogs'
import { prettifyModule } from '@/lib/logFormat'
import LogDisplayer from './LogDisplayer'

const MIN_H = 120
const MAX_H = 460
const DEFAULT_H = 240

/** 日志级别 → 小圆点颜色（收起条上的「最新」用） */
const LEVEL_DOT: Record<string, string> = {
  ERROR: 'bg-[hsl(var(--destructive))]',
  FATAL: 'bg-[hsl(var(--destructive))]',
  WARN: 'bg-[hsl(var(--warning))]',
  SUCCESS: 'bg-[hsl(var(--success))]',
  INFO: 'bg-muted-foreground/50',
  DEBUG: 'bg-muted-foreground/30',
  NOTE: 'bg-foreground/60',
}

export default function LogPanel() {
  const [collapsed, setCollapsed] = useState(false)
  const [height, setHeight] = useState(DEFAULT_H)
  const draggingRef = useRef(false)
  const messages = useLogsStore(s => s.messages)
  const errorCount = useLogsStore(s => s.errorCount)
  const latest = messages[messages.length - 1]

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      draggingRef.current = true
      const startY = e.clientY
      const startH = height
      const onMove = (ev: MouseEvent) => {
        if (!draggingRef.current) return
        const next = Math.min(MAX_H, Math.max(MIN_H, startH + (startY - ev.clientY)))
        setHeight(next)
      }
      const onUp = () => {
        draggingRef.current = false
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.userSelect = ''
      }
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [height],
  )

  // 收起态：一条信息栏，带错误数和最新一条日志，点哪都能展开
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="flex h-[60px] w-full shrink-0 items-center gap-3.5 border-t border-border bg-card px-4 text-left transition-colors hover:bg-muted/50"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Terminal className="h-[18px] w-[18px]" />
        </span>
        <span className="shrink-0 text-[17px] font-medium text-foreground">运行日志</span>

        {errorCount > 0 && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-destructive/12 px-2.5 py-1 text-[14px] text-destructive">
            <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
            {errorCount} 条错误
          </span>
        )}

        <span className="min-w-0 flex-1 truncate text-[15px] text-muted-foreground">
          {latest ? (
            <>
              <span className="text-muted-foreground/60">最新</span>
              <span className="mx-1.5 text-muted-foreground/40">|</span>
              <span
                className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${
                  LEVEL_DOT[latest.level] ?? 'bg-muted-foreground/40'
                }`}
              />
              <span className="text-foreground/80">{prettifyModule(latest.module)}</span>
              <span className="mx-1.5 text-muted-foreground/40">·</span>
              {latest.message}
            </>
          ) : (
            '暂无日志'
          )}
        </span>

        {latest && (
          <span className="shrink-0 tabular-nums text-[15px] text-muted-foreground/60">
            {latest.timestamp.split(' ')[1] ?? ''}
          </span>
        )}

        <span className="flex shrink-0 items-center gap-1 text-[14px] text-muted-foreground">
          展开
          <ChevronUp className="h-[18px] w-[18px]" />
        </span>
      </button>
    )
  }

  return (
    <div className="flex shrink-0 flex-col border-t border-border bg-card" style={{ height }}>
      {/* 顶部拖拽条：任意位置可拖拽调整高度。
          这是鼠标拖拽手柄，不是可聚焦控件，所以不加 role/键盘交互。 */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 拖拽手柄，纯鼠标操作 */}
      <div
        onMouseDown={onDragStart}
        className="flex h-6 shrink-0 cursor-row-resize items-center justify-end border-b border-border/60 px-3 transition-colors hover:bg-muted/60"
        title="拖拽调整高度"
      >
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          onMouseDown={e => e.stopPropagation()}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown className="h-4 w-4" />
          收起
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <LogDisplayer />
      </div>
    </div>
  )
}
