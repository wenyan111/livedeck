import { ChevronDown, ChevronUp, Terminal } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useLogsStore } from '@/hooks/useLogs'
import LogDisplayer from './LogDisplayer'

const MIN_H = 120
const MAX_H = 460
const DEFAULT_H = 200

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
        className="flex h-12 w-full shrink-0 items-center gap-3 border-t border-border bg-card px-4 text-left transition-colors hover:bg-muted/50"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
          <Terminal className="h-3.5 w-3.5" />
        </span>
        <span className="shrink-0 text-sm font-medium text-foreground">运行日志</span>

        {errorCount > 0 && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
            <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
            {errorCount} 条错误
          </span>
        )}

        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {latest ? (
            <>
              <span className="text-muted-foreground/70">最新：</span>
              <span
                className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${
                  LEVEL_DOT[latest.level] ?? 'bg-muted-foreground/40'
                }`}
              />
              <span className="text-foreground/70">{latest.module}</span>
              <span className="mx-1 text-muted-foreground/50">·</span>
              {latest.message}
            </>
          ) : (
            '暂无日志'
          )}
        </span>

        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          展开
          <ChevronUp className="h-4 w-4" />
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
