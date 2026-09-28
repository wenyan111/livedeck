import { useCallback, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import LogDisplayer from './LogDisplayer'

const MIN_H = 120
const MAX_H = 460
const DEFAULT_H = 200

export default function LogPanel() {
  const [collapsed, setCollapsed] = useState(false)
  const [height, setHeight] = useState(DEFAULT_H)
  const draggingRef = useRef(false)

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

  if (collapsed) {
    return (
      <div className="flex h-10 shrink-0 items-center justify-between border-t border-border bg-card px-4">
        <span className="text-sm font-medium text-foreground">运行日志</span>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronUp className="h-4 w-4" />
          展开
        </button>
      </div>
    )
  }

  return (
    <div
      className="flex shrink-0 flex-col border-t border-border bg-card"
      style={{ height }}
    >
      {/* 顶部拖拽条：任意位置可拖拽调整高度 */}
      <div
        onMouseDown={onDragStart}
        className="flex h-7 shrink-0 cursor-row-resize items-center justify-end border-b border-border/60 px-3 transition-colors hover:bg-muted/60"
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
