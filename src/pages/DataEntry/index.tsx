import type { VisionTemplate } from 'electron/main/services/VisionRecognizer'
import {
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  MapPin,
  MessageSquarePlus,
  Pause,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Table,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildLedgerColumns,
  hasAnyValue,
  type LedgerRecord,
  ledgerKeyOf,
  newLedgerId,
} from 'shared/dataEntryLedger'
import type { DataEntrySavedState } from 'shared/dataEntryState'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import type { LedgerSyncConfig } from 'shared/ledgerSync'
import {
  COMPUTED_DEPENDENCY_KEYS,
  computeDerivedValues,
  convertColumnValue,
  generateColumnKey,
  getDefaultColumns,
  LIVE_REPORT_COLUMNS,
  type LiveReportColumn,
  roundByColumn,
  takeFirstItem,
} from 'shared/liveReportColumns'
import { providers } from 'shared/providers'
import { platformLabels } from '@/abilities'
import { Title } from '@/components/common/Title'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAIProvider } from '@/hooks/useAIProvider'
import { useToast } from '@/hooks/useToast'

/**
 * 火山方舟常用视觉模型——只是**一键填入**的快捷项，不是白名单：
 * 模型那栏仍然可以手填任意模型 ID，或者你控制台里创建的接入点 `ep-xxxxxxxx`。
 *
 * 价格（2026-11 官方价，元/百万 tokens）：pro 输入 6 / 输出 30；turbo 约一半；lite 约 1/7。
 * 识别这种「照抄数字」的活，turbo 通常够用；lite 在模糊小字上容易读错。
 */
const VOLC_VISION_MODELS = [
  { id: 'doubao-seed-2-1-pro-260915', name: 'Seed 2.1 pro', note: '最强，价格基准' },
  { id: 'doubao-seed-2-1-turbo-260628', name: 'Seed 2.1 turbo', note: '同代、约半价、更快' },
  { id: 'doubao-seed-2-0-lite-260428', name: 'Seed 2.0 lite', note: '最便宜、小字易错' },
]

interface LocalImage {
  id: string
  url: string
  name: string
  /**
   * 是否已经被视觉模型完整识别过。
   * 已经识别过的图不再重复送模型（省时间也省钱），新加进来的图默认 false。
   */
  recognized?: boolean
}

interface DataRow {
  id: string
  /** 归属平台：只使用该平台自己那套列 */
  platform: LiveControlPlatform
  values: Record<string, string>
  lowConfidence: string[]
}

/** 总表排序：日期新的在上，同一天早场在前，再按更新时间倒序 */
function sortLedgerDesc(records: LedgerRecord[]): LedgerRecord[] {
  return [...records].sort((a, b) => {
    const da = a.values.date ?? ''
    const db = b.values.date ?? ''
    if (da !== db) return db.localeCompare(da)
    const sa = a.values.session ?? ''
    const sb = b.values.session ?? ''
    if (sa !== sb) return sa.localeCompare(sb)
    return b.updatedAt - a.updatedAt
  })
}

/** 把已有行的数据按新列定义重新对齐：保留仍存在的列值，丢掉已删列，新增列置空，并重算派生列 */
function reconcileRows(rows: DataRow[], newColumns: LiveReportColumn[]): DataRow[] {
  return rows.map(r => {
    const next: Record<string, string> = {}
    for (const c of newColumns) next[c.key] = r.values[c.key] ?? ''
    // 历史数据里的「时间」可能只是个开始点，这里补成时间段
    composeTimeRange(next)
    // 周标签空着但有日期 → 顺便补上（老数据没有这个自动值）
    if (!next.weekLabel && next.date) {
      const label = weekdayLabel(next.date)
      if (label) next.weekLabel = label
    }
    Object.assign(next, computeDerivedValues(next, newColumns))
    return { ...r, values: next }
  })
}

/**
 * 按「平台 + key」去重。
 *
 * 背景（2026-11-05 事故）：删除板块时把字段并进第一个板块，
 * 而这些字段常是从第一个板块导入的副本（key 相同），
 * 于是同一个字段出现两三次，行里显示一大片重复网格。
 */
/**
 * 「时间」列应该是**时间段**（如 06:40-09:30），而不是单个开始时间。
 *
 * 截图识别通常只能读到开始时间，所以这里用「开始时间 + 直播时长」算出结束时间，
 * 自动补成 `06:40-09:30` 的形式（用户 2026-11-05 要求）。
 * 只在 time 还是「单个时间」时才拼，已经是时间段就原样保留。
 */
function composeTimeRange(values: Record<string, string>): void {
  const raw = String(values.time ?? '').trim()

  // 方向一：时间是「06:40-09:30」→ 反算直播时长（保证两边互相同步）
  const range = raw.match(/^(\d{1,2}):(\d{2})\s*[-~至]\s*(\d{1,2}):(\d{2})$/)
  if (range) {
    const start = Number(range[1]) * 60 + Number(range[2])
    let end = Number(range[3]) * 60 + Number(range[4])
    if (end < start) end += 24 * 60 // 跨零点（如 23:30-01:10）
    const hours = (end - start) / 60
    if (hours > 0) {
      const digits = digitsForDuration(values)
      values.durationHour = String(+hours.toFixed(digits))
    }
    return
  }

  // 方向二：时间是单个「06:40」→ 用开始时间 + 直播时长拼成时间段
  const single = raw.match(/^(\d{1,2}):(\d{2})$/)
  if (!single) return
  const duration = Number.parseFloat(String(values.durationHour ?? '').replace(/[^\d.]/g, ''))
  if (!Number.isFinite(duration) || duration <= 0) return
  const startMin = Number(single[1]) * 60 + Number(single[2])
  const endMin = Math.round(startMin + duration * 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  values.time = `${pad(Number(single[1]))}:${single[2]}-${pad(Math.floor(endMin / 60) % 24)}:${pad(endMin % 60)}`
}

/** 直播时长默认保留 2 位（列上配了小数位就用配置的） */
function digitsForDuration(values: Record<string, string>): number {
  const configured = Number(values.__durationDecimals)
  return Number.isFinite(configured) ? configured : 2
}

function dedupeColumns(columns: LiveReportColumn[]): LiveReportColumn[] {
  const seen = new Set<string>()
  const out: LiveReportColumn[] = []
  for (const c of columns) {
    const k = `${c.platform}::${c.key}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(c)
  }
  return out
}

function buildDefaultValues(columns: LiveReportColumn[]): Record<string, string> {
  const v: Record<string, string> = {}
  for (const c of columns) v[c.key] = ''
  // 日期**不预填**：以截图识别到的为准（用户 2026-11-05 要求），
  // 没识别到就留空，由用户手动补
  return v
}

/**
 * 从日期字符串算出「周几」，用于自动填「周标签」。
 * 兼容 2026-11-05 / 2026/11/05 / 2026年11月5日 等写法。
 */
function weekdayLabel(dateStr: string): string | null {
  const m = (dateStr ?? '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const date = new Date(y, mo - 1, d)
  if (Number.isNaN(date.getTime())) return null
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()] ?? null
}

function createRow(columns: LiveReportColumn[], platform: LiveControlPlatform): DataRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    platform,
    values: buildDefaultValues(columns),
    lowConfidence: [],
  }
}

/** 框选裁剪弹窗 */
function CropModal({
  image,
  onCancel,
  onConfirm,
}: {
  image: LocalImage
  onCancel: () => void
  onConfirm: (dataUrl: string) => void
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  const onMouseDown = (e: React.MouseEvent) => {
    const box = containerRef.current?.getBoundingClientRect()
    if (!box) return
    const x = e.clientX - box.left
    const y = e.clientY - box.top
    dragStart.current = { x, y }
    setRect({ x, y, w: 0, h: 0 })
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragStart.current) return
    const box = containerRef.current?.getBoundingClientRect()
    if (!box) return
    const x = e.clientX - box.left
    const y = e.clientY - box.top
    const s = dragStart.current
    setRect({
      x: Math.min(s.x, x),
      y: Math.min(s.y, y),
      w: Math.abs(x - s.x),
      h: Math.abs(y - s.y),
    })
  }
  const onMouseUp = () => {
    dragStart.current = null
  }

  const handleConfirm = () => {
    const img = imgRef.current
    const box = containerRef.current?.getBoundingClientRect()
    if (!img || !box || !rect || rect.w < 5 || rect.h < 5) return
    const scaleX = img.naturalWidth / box.width
    const scaleY = img.naturalHeight / box.height
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(rect.w * scaleX)
    canvas.height = Math.round(rect.h * scaleY)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(
      img,
      rect.x * scaleX,
      rect.y * scaleY,
      rect.w * scaleX,
      rect.h * scaleY,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    onConfirm(canvas.toDataURL('image/png'))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="rounded-lg bg-card p-4 shadow-xl max-w-[90vw]">
        <p className="mb-3 text-sm text-muted-foreground">
          在图片上按住鼠标拖拽框选要识别的区域，松手后点「确认裁剪」
        </p>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: 图片框选用鼠标拖拽，键盘不适用 */}
        <div
          ref={containerRef}
          className="relative inline-block max-h-[70vh] overflow-hidden"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
        >
          <img
            ref={imgRef}
            src={image.url}
            alt={image.name}
            className="max-h-[70vh] max-w-[90vw]"
          />
          {rect && (
            <div
              className="absolute border-2 border-primary bg-primary/20"
              style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
            />
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={!rect || rect.w < 5}>
            确认裁剪
          </Button>
        </div>
      </div>
    </div>
  )
}

/** 单行数据编辑卡片 */
function RowCard({
  row,
  rowIndex,
  isActive,
  columns,
  onSelect,
  onUpdateValues,
  onDelete,
}: {
  row: DataRow
  rowIndex: number
  rowCount: number
  isActive: boolean
  columns: LiveReportColumn[]
  onSelect: () => void
  onUpdateValues: (rowId: string, key: string, val: string) => void
  onDelete: (rowId: string) => void
}) {
  const [expanded, setExpanded] = useState(rowIndex === 0)

  const groups = useMemo(() => {
    const map = new Map<string, LiveReportColumn[]>()
    for (const c of columns) {
      if (!map.has(c.group)) map.set(c.group, [])
      map.get(c.group)?.push(c)
    }
    return Array.from(map.entries())
  }, [columns])

  return (
    <div
      className={`border rounded-lg transition-colors ${
        isActive ? 'border-primary bg-primary/[0.02]' : 'border-border'
      }`}
    >
      {/* 行头：摘要 + 操作按钮 */}
      {/* biome-ignore lint/a11y/useSemanticElements: 行头里嵌着输入框，不能用 <button> 包住 */}
      <div
        role="button"
        tabIndex={0}
        className="flex cursor-pointer select-none items-center gap-2.5 px-3 py-2"
        onClick={() => setExpanded(e => !e)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded(v => !v)
          }
        }}
      >
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            onSelect()
          }}
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs font-bold shrink-0 ${
            isActive
              ? 'border-primary bg-primary text-white'
              : 'border-muted-foreground/30 text-muted-foreground'
          }`}
        >
          {rowIndex + 1}
        </button>
        {/* 行头直接可填：日期 / 主播 / 场次（原来是一串拼接文字，
            「第${session}场」还会拼出「第早场场」，用户 2026-11-05 反馈 */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: 这里只为阻止冒泡，没有可点击行为 */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: 同上，键盘无需处理 */}
        <div
          className="flex min-w-0 flex-1 items-center gap-1.5"
          onClick={e => e.stopPropagation()}
        >
          <Input
            value={row.values.date ?? ''}
            onChange={e => onUpdateValues(row.id, 'date', e.target.value)}
            placeholder="日期"
            className="h-6 w-[92px] px-1.5 text-xs"
            title="日期"
          />
          <Input
            value={row.values.anchorName ?? ''}
            onChange={e => onUpdateValues(row.id, 'anchorName', e.target.value)}
            placeholder="主播名称"
            className="h-6 min-w-0 flex-1 px-1.5 text-xs"
            title="主播名称"
          />
          <Input
            value={row.values.session ?? ''}
            onChange={e => onUpdateValues(row.id, 'session', e.target.value)}
            placeholder="场次"
            className="h-6 w-[64px] px-1.5 text-xs"
            title="场次（如：早场 / 晚场）"
          />
        </div>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          {
            Object.entries(row.values).filter(
              ([k, v]) => v.trim() !== '' && columns.find(c => c.key === k)?.source === 'vision',
            ).length
          }{' '}
          项已识别
        </span>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            onDelete(row.id)
          }}
          className="text-destructive hover:text-destructive/80 p-1 rounded hover:bg-destructive/10"
          title="删除此行"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* 展开的字段网格 */}
      {expanded && (
        <div className="px-3 pb-2.5 space-y-2 border-t pt-2">
          {groups.map(([group, cols]) => (
            <div key={group}>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group}
              </h3>
              <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7">
                {cols.map(col => {
                  const val = row.values[col.key] ?? ''
                  const isManual = col.source === 'manual'
                  const isSkip = col.source === 'skip'
                  const isComputed = col.source === 'computed'
                  const isLow = row.lowConfidence.includes(col.key)
                  const filled = val.trim() !== ''
                  const ring = isSkip
                    ? 'bg-muted/60 opacity-60'
                    : isComputed
                      ? 'bg-accent/50'
                      : isLow
                        ? 'ring-2 ring-warning'
                        : isManual
                          ? 'bg-muted/50'
                          : filled
                            ? 'bg-success/10'
                            : 'bg-destructive/10'
                  const placeholder =
                    col.key === 'time'
                      ? '如 06:40-09:30'
                      : isManual
                        ? '（人工填写）'
                        : isSkip
                          ? '（留空）'
                          : isComputed
                            ? '（自动计算）'
                            : ''
                  return (
                    <div key={col.key} className="space-y-px">
                      <Label className="text-[10px] leading-tight text-muted-foreground">
                        {col.label}
                      </Label>
                      <Input
                        value={val}
                        onChange={e => onUpdateValues(row.id, col.key, e.target.value)}
                        className={`h-6 px-1.5 text-[11px] ${ring}`}
                        disabled={isSkip}
                        placeholder={placeholder}
                        title={
                          col.key === 'time'
                            ? '时间段，如 06:40-09:30。只填开始时间时，会按「直播时长」自动补全结束时间'
                            : col.decimals !== undefined
                              ? `四舍五入到 ${col.decimals} 位小数`
                              : undefined
                        }
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 列管理弹窗：增 / 删 / 改标签、单位、类型、分组 */
function ColumnManagerModal({
  columns,
  allColumns,
  platform,
  labelOf,
  onCancel,
  onSave,
}: {
  /** 当前板块自己的列（只显示这些，保存时也只替换这些） */
  columns: LiveReportColumn[]
  /** 全部列，用于「从其它板块导入字段」 */
  allColumns: LiveReportColumn[]
  /** 当前正在编辑哪个板块（新增/导入的列归到这个板块） */
  platform: LiveControlPlatform
  /** 把板块 key 转成显示名（自定义板块没有平台名，靠这个兜底） */
  labelOf: (key: string) => string
  onCancel: () => void
  onSave: (cols: LiveReportColumn[]) => void
}) {
  const { toast } = useToast()
  const [draft, setDraft] = useState<LiveReportColumn[]>(() => columns.map(c => ({ ...c })))

  /** 可导入来源：其它板块里已有的列 */
  const importSources = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of allColumns) {
      const key = c.platform as string
      if (key === (platform as string)) continue
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return [...map.entries()]
  }, [allColumns, platform])

  /** 把某个板块的字段整套复制过来（同 key 的跳过，避免重复） */
  const importFrom = (src: string) => {
    const existing = new Set(draft.map(c => c.key))
    const added = allColumns
      .filter(c => (c.platform as string) === src && !existing.has(c.key))
      .map(c => ({ ...c, platform }))
    if (added.length === 0) {
      toast.error('没有可导入的新字段（已全部存在）')
      return
    }
    setDraft(prev => [...prev, ...added])
    toast.success(`已导入 ${added.length} 个字段，记得点「保存」`)
  }

  const update = (idx: number, patch: Partial<LiveReportColumn>) =>
    setDraft(prev => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  const remove = (idx: number) => setDraft(prev => prev.filter((_, i) => i !== idx))
  const add = () =>
    setDraft(prev => [
      ...prev,
      {
        platform,
        key: generateColumnKey(prev),
        label: '新标签',
        unit: 'text',
        source: 'manual',
        group: '自定义',
      },
    ])
  const reset = () => {
    if (window.confirm('恢复为默认 53 列？当前自定义修改将丢失')) {
      setDraft(getDefaultColumns())
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="rounded-lg bg-card shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">管理列（标签）</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              可新增 / 删除 / 改名标签，也可改单位与类型。修改后导出与识别会随之更新。
            </p>
          </div>
          <div className="flex items-center gap-2">
            {importSources.length > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">导入字段：</span>
                {importSources.map(([src, count]) => (
                  <Button
                    key={src}
                    size="sm"
                    variant="outline"
                    className="h-6 px-1.5 text-[11px]"
                    title={`把「${labelOf(src)}」的 ${count} 个字段复制到本板块`}
                    onClick={() => importFrom(src)}
                  >
                    {labelOf(src)}
                  </Button>
                ))}
              </div>
            )}
            <span className="text-xs text-muted-foreground">{draft.length} 列</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {/* 表头 */}
          <div className="grid grid-cols-[1fr_82px_100px_96px_76px_92px_32px] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>标签名</span>
            <span>单位</span>
            <span>类型</span>
            <span>分组</span>
            <span title="四舍五入到几位小数">小数位</span>
            <span title="一个格子里有多个值时怎么办（如「广东、浙江、江苏」）">多值</span>
            <span />
          </div>
          {draft.map((col, idx) => (
            <div
              key={col.key}
              className="grid grid-cols-[1fr_82px_100px_96px_76px_92px_32px] gap-2 items-center"
            >
              <Input
                value={col.label}
                onChange={e => update(idx, { label: e.target.value })}
                className="h-8 text-xs"
              />
              <Select
                value={col.unit}
                onValueChange={u => update(idx, { unit: u as LiveReportColumn['unit'] })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">无</SelectItem>
                  <SelectItem value="wan">万</SelectItem>
                  <SelectItem value="hour">小时</SelectItem>
                  <SelectItem value="percent">百分比</SelectItem>
                  <SelectItem value="text">文本</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={col.source}
                onValueChange={s => update(idx, { source: s as LiveReportColumn['source'] })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">人工填写</SelectItem>
                  <SelectItem value="vision">视觉识别</SelectItem>
                  <SelectItem value="skip">留空</SelectItem>
                  <SelectItem value="computed">自动计算</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={col.group}
                onChange={e => update(idx, { group: e.target.value })}
                className="h-8 text-xs"
              />
              {/* 每列单独设置四舍五入位数：原始 / 0 / 1 / 2 / 3 / 4 */}
              <Select
                value={col.decimals === undefined ? 'raw' : String(col.decimals)}
                onValueChange={v =>
                  update(idx, {
                    decimals: v === 'raw' ? undefined : Number(v),
                  })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="raw">原始</SelectItem>
                  <SelectItem value="0">0 位</SelectItem>
                  <SelectItem value="1">1 位</SelectItem>
                  <SelectItem value="2">2 位</SelectItem>
                  <SelectItem value="3">3 位</SelectItem>
                  <SelectItem value="4">4 位</SelectItem>
                </SelectContent>
              </Select>
              {/* 多值字段怎么取值：全留 / 只留第一项（文本列才有意义） */}
              <Select
                value={col.firstOnly ? 'first' : 'all'}
                onValueChange={v => update(idx, { firstOnly: v === 'first' })}
                disabled={col.unit !== 'text'}
              >
                <SelectTrigger
                  className="h-8 text-xs"
                  title={
                    col.unit === 'text'
                      ? '一个格子里出现多个值（如「广东、浙江、江苏」）时怎么处理'
                      : '只有「文本」类型的字段需要设置'
                  }
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部保留</SelectItem>
                  <SelectItem value="first">只取第一项</SelectItem>
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => remove(idx)}
                className="text-destructive hover:text-destructive/80 p-1 rounded hover:bg-destructive/10 flex justify-center"
                title="删除该列"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={add} className="mt-1">
            <Plus className="w-4 h-4 mr-1" /> 新增标签
          </Button>
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={reset}>
            恢复默认 53 列
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>
              取消
            </Button>
            <Button onClick={() => onSave(draft)}>保存</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function DataEntry() {
  const { toast } = useToast()
  const {
    config,
    apiKeys,
    customBaseURL,
    setConfig,
    setApiKey,
    setCustomBaseURL,
    setModelValue,
    switchModelMode,
  } = useAIProvider('vision')

  /**
   * 页面视图：分板块录入 / 总表。
   * 总表把所有板块、所有日期的行汇总在一起（按「日期+板块+场次」去重），
   * 导出一次就拿到整张表，不用一板块导一遍（用户 2026-11-05 需求）。
   */
  const [view, setView] = useState<'entry' | 'ledger'>('entry')
  const [ledger, setLedger] = useState<LedgerRecord[]>([])
  /** 总表筛选：看哪个板块（'' = 全部） */
  const [ledgerFilter, setLedgerFilter] = useState('')
  /**
   * 实时同步：总表一有变化就把整张表写进用户指定的 .xlsx，
   * 这样数据直接落在电脑上的表格里，不用每次点「导出整表」（用户 2026-11-05 需求）。
   */
  const [ledgerSync, setLedgerSync] = useState<LedgerSyncConfig>({
    enabled: false,
    filePath: '',
  })
  const [syncing, setSyncing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  /**
   * 方舟用哪种方式调模型：
   * - model：直接填模型 ID（需在方舟开通该模型）
   * - endpoint：填自己在控制台建的推理接入点 ep-xxxxxxxx
   * 只影响这栏的提示与快捷项，真正发给接口的都是同一个 model 字段。
   */
  const [volcMode, setVolcMode] = useState<'model' | 'endpoint'>(() =>
    config.model.trim().startsWith('ep-') ? 'endpoint' : 'model',
  )
  /**
   * 截图多选：按板块记选中的图片 id。
   * 用来「挑几张一起重认」（单张 hover 的「重认」只能一张一张点，用户 2026-11-05 反馈要能多张）。
   */
  const [pickedImages, setPickedImages] = useState<Record<string, string[]>>({})

  /**
   * 截图按平台存放：每个平台的板块有自己的截图列表（各平台大屏结构不同，
   * 混在一起识别会串字段）。key = platform。
   */
  const [imagesByPlatform, setImagesByPlatform] = useState<Record<string, LocalImage[]>>({})
  /** 图片列表的最新快照：粘贴/拖入时要在同步代码里查重，不能等 setState 回调 */
  const imagesRef = useRef<Record<string, LocalImage[]>>({})
  const imagesOf = useCallback(
    (p: LiveControlPlatform): LocalImage[] => imagesByPlatform[p] ?? [],
    [imagesByPlatform],
  )
  const setImagesOf = useCallback(
    (p: LiveControlPlatform, updater: (prev: LocalImage[]) => LocalImage[]) => {
      setImagesByPlatform(prev => {
        const next = { ...prev, [p]: updater(prev[p] ?? []) }
        imagesRef.current = next
        return next
      })
    },
    [],
  )
  const [cropTarget, setCropTarget] = useState<LocalImage | null>(null)
  /** 正在识别哪个板块（null = 没在识别）；同时用来在多板块间做互斥 */
  const [recognizing, setRecognizing] = useState(false)
  const [recognizingKey, setRecognizingKey] = useState<string | null>(null)
  /** 已点了「暂停识别」，等当前这次模型调用跑完就停 */
  const [pausing, setPausing] = useState(false)
  /** 当前这次识别的 runId，暂停时要靠它告诉主进程停哪个任务 */
  const runIdRef = useRef<string | null>(null)
  /**
   * 直播日报是**全账号、全平台共用的一张表**（用户 2026-11-05 明确）：
   * 切换账号 / 平台时这张表不该跟着变。
   *
   * 所以这里用一个固定的内部 key，只用于「截图列表」等本地缓存的分组，
   * 与当前登录的账号平台无关。行和列上的 `platform` 字段保留只为兼容旧数据。
   */
  const TABLE_PLATFORM = 'douyin' as LiveControlPlatform

  const [rows, setRows] = useState<DataRow[]>(() => [
    createRow(LIVE_REPORT_COLUMNS, TABLE_PLATFORM),
  ])
  const [activeRowId, setActiveRowId] = useState<string>(() => rows[0]?.id ?? '')
  const [columnModalOpen, setColumnModalOpen] = useState(false)
  /** 「管理列」当前在编辑哪个平台 */
  const [columnModalPlatform, setColumnModalPlatform] =
    useState<LiveControlPlatform>(TABLE_PLATFORM)
  /**
   * 板块列表。每个板块有**独立的 key**，与平台枚举解耦：
   * 早期版本直接用平台当 key，导致「把第一个板块改名为巨量百应后，
   * 就再也加不回抖音小店了」（用户 2026-11-05 指出）。
   *
   * 现在：key 只是标识，名称由 sectionNames 决定，平台只作为初始名称/字段模板来源。
   */
  const [sectionPlatforms, setSectionPlatforms] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('data-entry-sections')
      const parsed = raw ? (JSON.parse(raw) as string[]) : null
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    } catch {
      // 忽略损坏的本地缓存
    }
    return [TABLE_PLATFORM]
  })
  useEffect(() => {
    try {
      localStorage.setItem('data-entry-sections', JSON.stringify(sectionPlatforms))
    } catch {
      // 存不进去也不影响使用
    }
  }, [sectionPlatforms])

  /**
   * 「纠正记忆」：用户在板块里对着 AI 说一句（如「观看核心城市只填第一名」），
   * 这句话会作为长期规则存下来，之后**每次识别都拼进提示词**。
   * 按板块分开存，key = 板块 key（用户 2026-11-05 要求「随时调教，让他纠正记忆」）。
   */
  const [sectionNotes, setSectionNotes] = useState<Record<string, string[]>>(() => {
    try {
      const raw = localStorage.getItem('data-entry-section-notes')
      const parsed = raw ? (JSON.parse(raw) as Record<string, string[]>) : null
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  })
  const persistNotes = useCallback((next: Record<string, string[]>) => {
    try {
      localStorage.setItem('data-entry-section-notes', JSON.stringify(next))
    } catch {
      // 存不进去不影响当前会话
    }
  }, [])
  /** 各板块输入框里的草稿 */
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({})
  const addSectionNote = useCallback(
    (key: string) => {
      const text = (noteDraft[key] ?? '').trim()
      if (!text) return
      setSectionNotes(prev => {
        const list = prev[key] ?? []
        if (list.includes(text)) {
          toast.error('这条已经记住了')
          return prev
        }
        const next = { ...prev, [key]: [...list, text] }
        persistNotes(next)
        return next
      })
      setNoteDraft(prev => ({ ...prev, [key]: '' }))
    },
    [noteDraft, persistNotes, toast],
  )
  const removeSectionNote = useCallback(
    (key: string, index: number) => {
      setSectionNotes(prev => {
        const list = (prev[key] ?? []).filter((_, i) => i !== index)
        const next = { ...prev, [key]: list }
        persistNotes(next)
        return next
      })
    },
    [persistNotes],
  )
  /** 直接改某一条规则（用户 2026-11-05：这里要能改，不用删了重写） */
  const updateSectionNote = useCallback(
    (key: string, index: number, text: string) => {
      setSectionNotes(prev => {
        const list = [...(prev[key] ?? [])]
        if (index < 0 || index >= list.length) return prev
        list[index] = text
        const next = { ...prev, [key]: list }
        persistNotes(next)
        return next
      })
    },
    [persistNotes],
  )

  /**
   * 板块自定义名称（板块标题可以直接改，存 localStorage）。
   * 例如把「抖音小店」改成「英子-抖音」。
   */
  const [sectionNames, setSectionNames] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem('data-entry-section-names')
      return raw ? (JSON.parse(raw) as Record<string, string>) : {}
    } catch {
      return {}
    }
  })
  /**
   * 板块显示名：优先用用户自己改的名字（如「巨量百应」），
   * 没改过才回落到平台原名。导出按钮、提示文案都走这里，
   * 保证「你看到的板块名」和「按钮上的名字」一致（用户 2026-11-05 反馈）。
   */
  const sectionLabel = useCallback(
    (key: string) =>
      sectionNames[key]?.trim() || platformLabels[key as LiveControlPlatform] || '新板块',
    [sectionNames],
  )

  const setSectionName = useCallback((key: string, name: string) => {
    setSectionNames(prev => {
      const next = { ...prev, [key]: name }
      try {
        localStorage.setItem('data-entry-section-names', JSON.stringify(next))
      } catch {
        // 存不进去也不影响当前会话
      }
      return next
    })
  }, [])

  /**
   * 数据归位：早期的迁移把「行 / 列」的 platform 跟着当前账号改过，
   * 于是可能出现「行属于 kuaishou、但页面板块里没有 kuaishou」→ 数据显示不出来。
   * 这里一次性纠正：凡是 platform 不在板块列表里的行和列，全部并入第一个板块，
   * **只改归属，不改任何字段值**（用户 2026-11-05：原有数据不能丢）。
   */
  const adoptedRef = useRef(false)
  useEffect(() => {
    if (!loadedRef.current || adoptedRef.current) return
    if (sectionPlatforms.length === 0) return
    const first = sectionPlatforms[0]
    const inSections = (pf?: string) => Boolean(pf) && sectionPlatforms.includes(pf as string)

    setRows(prev => {
      if (prev.every(r => inSections(r.platform))) return prev
      adoptedRef.current = true
      return prev.map(r =>
        inSections(r.platform) ? r : { ...r, platform: first as LiveControlPlatform },
      )
    })
    setColumns(prev => {
      if (prev.every(c => inSections(c.platform))) return prev
      const next = prev.map(c =>
        inSections(c.platform) ? c : { ...c, platform: first as LiveControlPlatform },
      )
      void window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.saveColumns, next)
      return next
    })
  }, [sectionPlatforms])

  /** 每个板块各自的文件选择框 */
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const [columns, setColumns] = useState<LiveReportColumn[]>(LIVE_REPORT_COLUMNS)
  const [isDragging, setIsDragging] = useState(false)
  // 视觉模板
  const [template, setTemplate] = useState<{ id: string; name: string; fieldCount: number } | null>(
    null,
  )
  const [calibrating, setCalibrating] = useState(false)
  const dragCounter = useRef(0)
  // 初始加载完成前，禁止自动保存覆盖已存档数据
  const loadedRef = useRef(false)

  // 进入页面：从本地读取用户保存的列定义（缺省回退默认），并恢复已填的表单数据
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let safe = getDefaultColumns()
      try {
        const cols = (await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.getColumns)) as
          | LiveReportColumn[]
          | undefined
        if (cancelled) return
        const raw = cols && cols.length > 0 ? cols : getDefaultColumns()
        safe = dedupeColumns(raw)
        setColumns(safe)
        // 发现重复字段（删除板块合并造成）→ 立刻把清理后的版本写回磁盘，
        // 否则下次打开又会重复一遍
        if (safe.length !== raw.length) {
          void window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.saveColumns, safe)
        }
      } catch {
        if (!cancelled) setColumns(getDefaultColumns())
      }

      // 载入已保存的表单数据（防 app 重启丢失）
      let restored = false
      try {
        const saved = (await window.ipcRenderer.invoke(
          IPC_CHANNELS.dataEntry.getRows,
        )) as DataEntrySavedState | null
        if (cancelled) return
        if (saved && Array.isArray(saved.rows) && saved.rows.length > 0) {
          const reconciled = reconcileRows(saved.rows, safe)
          setRows(reconciled)
          const activeOk = saved.activeRowId && reconciled.some(r => r.id === saved.activeRowId)
          setActiveRowId(activeOk ? saved.activeRowId : reconciled[0].id)
          restored = true
        }
      } catch {
        /* 忽略，使用默认空白行 */
      }

      if (!restored) {
        setRows(prev => reconcileRows(prev, safe))
      }
      loadedRef.current = true
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 首次进入：把闲置的视觉配置默认指向智谱 glm-4v-plus
  useEffect(() => {
    if (config.provider === 'deepseek') {
      setConfig({ provider: 'zhipu', model: 'glm-4v-plus' })
    }
  }, [config.provider, setConfig])

  const apiKey = apiKeys[config.provider] ?? ''

  const providerOptions = useMemo(() => Object.entries(providers), [])
  const modelOptions = providers[config.provider]?.models ?? []

  /** 获取当前活跃行 */
  const activeRow = useMemo(
    () => rows.find(r => r.id === activeRowId) ?? rows[0],
    [rows, activeRowId],
  )

  const addImageFromFile = useCallback(
    (file: File, platform: LiveControlPlatform) => {
      if (!file.type.startsWith('image/')) return
      const reader = new FileReader()
      reader.onload = () => {
        const url = String(reader.result)
        // 同一张图反复粘贴/拖入很常见（比如截屏后连按两次 ⌘V）。
        // 内容一样就直接忽略，不然列表里堆一堆重复图，识别时还要多花几次调用。
        if ((imagesRef.current[platform] ?? []).some(i => i.url === url)) {
          toast.error('这张截图已经在列表里了，无需重复添加')
          return
        }
        setImagesOf(platform, prev => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            url,
            name: file.name || `截图-${prev.length + 1}.png`,
            // 新加的图默认「待识别」
            recognized: false,
          },
        ])
      }
      reader.readAsDataURL(file)
    },
    [setImagesOf, toast],
  )

  const addImageFiles = useCallback(
    (files: FileList | File[], platform: LiveControlPlatform) => {
      for (const f of Array.from(files)) addImageFromFile(f, platform)
    },
    [addImageFromFile],
  )

  const handleSelectFiles = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>, platform: LiveControlPlatform) => {
      const files = e.target.files
      if (!files) return
      addImageFiles(files, platform)
      e.target.value = ''
    },
    [addImageFiles],
  )

  // ---- 拖拽放置 ----
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      dragCounter.current += 1
      setIsDragging(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current -= 1
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setIsDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent, platform: LiveControlPlatform) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current = 0
      setIsDragging(false)
      const files = e.dataTransfer.files
      if (files && files.length > 0) {
        addImageFiles(files, platform)
      }
    },
    [addImageFiles],
  )

  const removeImage = (platform: LiveControlPlatform, id: string) =>
    setImagesOf(platform, prev => prev.filter(i => i.id !== id))

  /** 勾选 / 取消勾选一张截图（多选重认用） */
  const togglePick = (sectionKey: string, id: string) => {
    setPickedImages(prev => {
      const list = prev[sectionKey] ?? []
      const next = list.includes(id) ? list.filter(x => x !== id) : [...list, id]
      return { ...prev, [sectionKey]: next }
    })
  }
  const clearPicks = (sectionKey: string) =>
    setPickedImages(prev => ({ ...prev, [sectionKey]: [] }))

  /** 「清空图片」的二次确认状态（点一次变红，再点才真清） */
  const [clearConfirm, setClearConfirm] = useState<Record<string, boolean>>({})
  const clearAllImages = (sectionKey: string, platform: LiveControlPlatform) => {
    if (!clearConfirm[sectionKey]) {
      setClearConfirm(prev => ({ ...prev, [sectionKey]: true }))
      // 3 秒没确认就自动收回，避免一直红着
      setTimeout(() => setClearConfirm(prev => ({ ...prev, [sectionKey]: false })), 3000)
      return
    }
    setImagesOf(platform, () => [])
    clearPicks(sectionKey)
    setClearConfirm(prev => ({ ...prev, [sectionKey]: false }))
    toast.success('已清空截图，可以继续拖下一场的图了')
  }

  // 支持从剪贴板粘贴截图（macOS 截屏后 Cmd+V / Windows Ctrl+V）
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      let hasImage = false
      Array.from(items).forEach(item => {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            hasImage = true
            addImageFromFile(file, activeRow?.platform ?? 'douyin')
          }
        }
      })
      if (hasImage) e.preventDefault()
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addImageFromFile, activeRow?.platform])

  /**
   * 识别 → 结果写入该板块当前活跃的那一行。
   *
   * 只送**还没识别过**的截图（已识别的图不再重复看，省时间也省钱）；
   * 传 opts.images 可以强制识别指定图片（单张「重认」/「重认全部」用）。
   */
  const handleRecognize = useCallback(
    async (platform: LiveControlPlatform, opts?: { images?: LocalImage[] }) => {
      const allImages = imagesOf(platform)
      const targetImages = opts?.images ?? allImages.filter(i => !i.recognized)
      const platformColumns = columns.filter(c => c.platform === platform)
      // 该平台的活跃行：优先选中行，否则第一条该平台的行
      const targetRow =
        rows.find(r => r.id === activeRowId && r.platform === platform) ??
        rows.find(r => r.platform === platform)
      if (allImages.length === 0) {
        toast.error('请先选择截图')
        return
      }
      if (targetImages.length === 0) {
        toast.error('这些截图都识别过了。要重新识别请点「重认全部」')
        return
      }
      if (platformColumns.length === 0) {
        toast.error('这个平台还没有字段，请先点「管理列」添加')
        return
      }
      if (!apiKey) {
        toast.error('请先在上方填写视觉模型 API Key')
        return
      }
      // 用 ref 判重（state 是异步的，连点两下会穿透）
      if (runIdRef.current) {
        toast.error('正在识别中，先等这次跑完或点「暂停识别」')
        return
      }
      const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      runIdRef.current = runId
      setRecognizing(true)
      setRecognizingKey(platform)
      setPausing(false)
      try {
        const result = await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.recognize, {
          images: targetImages.map(i => ({ base64: i.url })),
          config: {
            provider: config.provider,
            model: config.model,
            apiKey,
            customBaseURL: config.provider === 'custom' ? customBaseURL : undefined,
          },
          columns: platformColumns,
          templateId: template ? 'use-saved' : undefined, // 有模板时使用位置引导
          runId, // 暂停时按这个 id 找到本次任务
          extraInstructions: sectionNotes[platform] ?? [], // 用户「纠正记忆」写下的规则
        })
        // 合并到当前活跃行
        setRows(prev =>
          prev.map(r => {
            if (r.id !== targetRow?.id) return r
            const merged = { ...r.values, ...result.values }
            // 按各列配置的「小数位」四舍五入（识别出来的原始值常常是长小数）
            for (const c of platformColumns) {
              if (c.decimals !== undefined && merged[c.key] !== undefined) {
                merged[c.key] = roundByColumn(merged[c.key], c)
              }
            }
            // 「只取第一项」的文本列（如观看核心城市）：广东、浙江、江苏 → 广东
            for (const c of platformColumns) {
              if (c.firstOnly && merged[c.key]) {
                merged[c.key] = takeFirstItem(merged[c.key])
              }
            }
            // 时间列补成「开始-结束」时间段
            composeTimeRange(merged)
            // 识别到日期时，自动补「周标签」
            const recognizedWeek = merged.date ? weekdayLabel(merged.date) : null
            if (recognizedWeek) merged.weekLabel = recognizedWeek
            // 重算派生列
            Object.assign(merged, computeDerivedValues(merged, platformColumns))
            return { ...r, values: merged, lowConfidence: result.lowConfidence ?? [] }
          }),
        )
        // 把「已经完整识别完」的图打上标记，下次不再重复送模型
        const doneIds = (result.processedImageIndexes ?? [])
          .map(idx => targetImages[idx]?.id)
          .filter((id): id is string => !!id)
        if (doneIds.length > 0) {
          const doneSet = new Set(doneIds)
          setImagesOf(platform, prev =>
            prev.map(i => (doneSet.has(i.id) ? { ...i, recognized: true } : i)),
          )
        }
        const filled = Object.keys(result.values).length
        const rowNo =
          rows.filter(r => r.platform === platform).findIndex(r => r.id === targetRow?.id) + 1
        if (result.paused) {
          const rest = targetImages.length - doneIds.length
          toast.success(
            `已暂停：${doneIds.length} 张图、${filled} 项已写入第 ${rowNo} 行，还剩 ${rest} 张待识别，继续会接着看剩下的`,
          )
        } else {
          toast.success(
            `识别完成，${targetImages.length} 张图提取 ${filled} 项写入「${sectionLabel(platform)}」第 ${rowNo} 行，请核对后导出`,
          )
        }
      } catch (error) {
        toast.error(`识别失败：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        runIdRef.current = null
        setRecognizing(false)
        setRecognizingKey(null)
        setPausing(false)
        // 这一批处理完就清掉勾选，避免下次误重认
        setPickedImages(prev => ({ ...prev, [platform]: [] }))
      }
    },
    [
      imagesOf,
      apiKey,
      config.provider,
      config.model,
      customBaseURL,
      toast,
      activeRowId,
      rows,
      columns,
      template,
      sectionLabel,
      setImagesOf,
      sectionNotes,
    ],
  )

  /** 暂停识别：只在两次模型调用之间生效，已经跑完的结果不会丢 */
  const handlePauseRecognize = useCallback(async () => {
    const runId = runIdRef.current
    if (!runId) return
    setPausing(true)
    try {
      await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.pauseRecognize, { runId })
    } catch {
      // 暂停失败不影响识别继续跑完
      setPausing(false)
    }
  }, [])

  /** 加载已保存的模板 */
  useEffect(() => {
    window.ipcRenderer
      .invoke(IPC_CHANNELS.dataEntry.getTemplate)
      .then((tmpl: VisionTemplate | null) => {
        if (tmpl) setTemplate({ id: tmpl.id, name: tmpl.name, fieldCount: tmpl.fields.length })
      })
      .catch(() => {})
  }, [])

  /** 进页面先把总表读出来 */
  useEffect(() => {
    window.ipcRenderer
      .invoke(IPC_CHANNELS.dataEntry.getLedger)
      .then((all: LedgerRecord[]) => setLedger(all ?? []))
      .catch(() => {})
  }, [])

  /** 读取「实时同步」的开关与目标文件（上次开着的，重启后继续开着） */
  useEffect(() => {
    window.ipcRenderer
      .invoke(IPC_CHANNELS.dataEntry.getLedgerSync)
      .then((cfg: LedgerSyncConfig) => {
        if (cfg) setLedgerSync(cfg)
      })
      .catch(() => {})
  }, [])

  /**
   * 截图记忆：打开时把上次拖进来的图恢复回来（含「已识别」标记），
   * 之后每次增删/识别都防抖存盘（用户 2026-11-05 要求「下次打开上次的图片还在」）。
   */
  const imagesLoadedRef = useRef(false)
  useEffect(() => {
    window.ipcRenderer
      .invoke(IPC_CHANNELS.dataEntry.getImages)
      .then((data: Record<string, LocalImage[]>) => {
        if (data && Object.keys(data).length > 0) {
          setImagesByPlatform(data)
          imagesRef.current = data
        }
      })
      .catch(() => {})
      .finally(() => {
        imagesLoadedRef.current = true
      })
  }, [])

  useEffect(() => {
    // 还没把上次的图读回来就别存，否则会用空列表把存档冲掉
    if (!imagesLoadedRef.current) return
    const t = setTimeout(() => {
      window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.saveImages, imagesByPlatform).catch(() => {})
    }, 800)
    return () => clearTimeout(t)
  }, [imagesByPlatform])

  /** 表单数据自动存档：任何修改（填字/识别/增删行/切换行）后防抖落盘，重启不再丢 */
  useEffect(() => {
    if (!loadedRef.current) return
    const t = setTimeout(() => {
      window.ipcRenderer
        .invoke(IPC_CHANNELS.dataEntry.saveRows, { rows, activeRowId } as DataEntrySavedState)
        .catch(() => {})
    }, 500)
    return () => clearTimeout(t)
  }, [rows, activeRowId])

  /**
   * 自动归档进「总表」：每次改动（识别/手填/增删行）防抖后把有内容的行 upsert 进总表。
   * 去重键是「日期 + 板块 + 场次」，同一场重复识别只会更新同一行（用户 2026-11-05 需求）。
   */
  useEffect(() => {
    // 注意：这里**不能**用 loadedRef 拦（它是给存档用的），
    // 否则刚打开时恢复出来的历史行不会归档；空行会被 hasAnyValue 过滤掉，所以安全。
    const t = setTimeout(() => {
      const now = Date.now()
      const records: LedgerRecord[] = rows
        .filter(r => hasAnyValue(r.values))
        .map(r => ({
          // id 必须是总表自己的（不能借用行 id，否则改过日期/场次的行会撞 id）
          id: newLedgerId(),
          sectionKey: r.platform as string,
          sectionName: sectionLabel(r.platform as string),
          platform: r.platform,
          values: r.values,
          createdAt: now,
          updatedAt: now,
        }))
      if (records.length === 0) return
      window.ipcRenderer
        .invoke(IPC_CHANNELS.dataEntry.upsertLedger, records)
        .then((all: LedgerRecord[]) => setLedger(all))
        .catch(() => {})
    }, 1200)
    return () => clearTimeout(t)
  }, [rows, sectionLabel])

  // ── 总表：表头（各板块字段并集）、排序后的行 ──
  const ledgerColumns = useMemo(() => buildLedgerColumns(columns), [columns])
  const ledgerRows = useMemo(
    () => sortLedgerDesc(ledgerFilter ? ledger.filter(r => r.sectionKey === ledgerFilter) : ledger),
    [ledger, ledgerFilter],
  )

  /**
   * 导出 / 实时同步用的整表数据：不跟总表上方的板块筛选走（永远是整张表），
   * 并在最前面补「板块」「平台」两列（用户 2026-11-05 反馈表里要能看出数据来自哪）。
   */
  const ledgerExportPayload = useMemo(() => {
    const head: LiveReportColumn[] = [
      {
        key: '__section',
        label: '板块',
        unit: 'text',
        source: 'manual',
        group: '总表',
        platform: 'douyin',
      },
      {
        key: '__platform',
        label: '平台',
        unit: 'text',
        source: 'manual',
        group: '总表',
        platform: 'douyin',
      },
    ]
    const rows = sortLedgerDesc(ledger).map(r => ({
      ...r.values,
      __section: r.sectionName,
      __platform: platformLabels[r.platform] ?? r.platform,
    }))
    return { rows, columns: [...head, ...ledgerColumns] }
  }, [ledger, ledgerColumns])

  /** 同步目标文件名（按钮上显示，路径放在 tooltip 里） */
  const syncFileName = ledgerSync.filePath.split('/').pop() || ''

  /**
   * 总表里直接改一个格子。
   * 改完同时回写到录入页里同一条记录对应的那一行，
   * 否则下次从录入页归档时会把旧的（改之前的）值覆盖回来。
   */
  const updateLedgerCell = useCallback(
    (id: string, key: string, value: string) => {
      const target = ledger.find(r => r.id === id)
      if (!target) return
      const next = ledger.map(r =>
        r.id === id ? { ...r, values: { ...r.values, [key]: value }, updatedAt: Date.now() } : r,
      )
      setLedger(next)
      window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.saveLedger, next).catch(() => {})

      // 找录入页里「同板块 + 同日期场次」的那一行同步过去
      if (rows.some(r => (r.platform as string) === target.sectionKey)) {
        const targetKey = ledgerKeyOf(target.sectionKey, target.values)
        setRows(prev =>
          prev.map(r => {
            if ((r.platform as string) !== target.sectionKey) return r
            if (ledgerKeyOf(target.sectionKey, r.values) !== targetKey) return r
            return { ...r, values: { ...r.values, [key]: value } }
          }),
        )
      }
    },
    [ledger, rows],
  )

  /** 总表里删掉一行（只删总表记录，不影响录入页的行） */
  const removeLedgerRow = useCallback((id: string) => {
    setLedger(prev => {
      const next = prev.filter(r => r.id !== id)
      window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.saveLedger, next).catch(() => {})
      return next
    })
  }, [])

  /** 一次性导出整张总表（所有板块、所有日期） */
  const handleExportLedger = useCallback(async () => {
    if (ledgerExportPayload.rows.length === 0) {
      toast.error('总表还是空的，先在录入页识别/填写数据')
      return
    }
    const outputPath = await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.selectOutputPath)
    if (!outputPath) return
    try {
      await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.exportLedger, {
        rows: ledgerExportPayload.rows,
        columns: ledgerExportPayload.columns,
        outputPath,
      })
      toast.success(`已导出 ${ledgerExportPayload.rows.length} 行整表到 ${outputPath}`)
    } catch (error) {
      toast.error(`导出失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [ledgerExportPayload, toast])

  /** 把当前整表写进同步目标文件（内部用，不弹提示） */
  const writeLedgerSync = useCallback(
    async (outputPath: string) => {
      if (!outputPath) return
      setSyncing(true)
      try {
        await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.syncLedgerXlsx, {
          rows: ledgerExportPayload.rows,
          columns: ledgerExportPayload.columns,
          outputPath,
        })
        setLastSyncedAt(Date.now())
      } catch (error) {
        toast.error(`同步失败：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        setSyncing(false)
      }
    },
    [ledgerExportPayload, toast],
  )

  /** 开启实时同步：先选（或沿用上次的）目标文件，再立刻写一次 */
  const handleStartLedgerSync = useCallback(async () => {
    let filePath = ledgerSync.filePath
    // 第一次开启要选文件；之前选过就直接沿用，想换位置点「换文件」
    filePath = (await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.chooseLedgerSyncPath)) ?? ''
    if (!filePath) return
    try {
      const saved = await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.setLedgerSync, {
        enabled: true,
        filePath,
      })
      setLedgerSync(saved)
      await writeLedgerSync(saved.filePath)
      toast.success(`已开始实时同步，数据会随时写进 ${saved.filePath}`)
    } catch (error) {
      toast.error(`开启同步失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [ledgerSync.filePath, writeLedgerSync, toast])

  /** 停止同步（保留目标路径，下次开起来还是这个文件） */
  const handleStopLedgerSync = useCallback(async () => {
    const saved = await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.setLedgerSync, {
      enabled: false,
      filePath: ledgerSync.filePath,
    })
    setLedgerSync(saved)
    toast.success('已停止实时同步，已写入的数据不动')
  }, [ledgerSync.filePath, toast])

  /** 立刻同步一次（等不及防抖，或想确认文件是最新的） */
  const handleSyncNow = useCallback(async () => {
    if (!ledgerSync.filePath) {
      await handleStartLedgerSync()
      return
    }
    await writeLedgerSync(ledgerSync.filePath)
    toast.success(`已同步 ${ledgerExportPayload.rows.length} 行 → ${ledgerSync.filePath}`)
  }, [ledgerSync.filePath, writeLedgerSync, handleStartLedgerSync, ledgerExportPayload, toast])

  /**
   * 总表变了就自动写文件（防抖 900ms，避免连续敲字时反复写盘）。
   * 关着的时候只是空转，不产生任何 IO。
   */
  useEffect(() => {
    if (!ledgerSync.enabled || !ledgerSync.filePath) return
    const timer = setTimeout(() => {
      void writeLedgerSync(ledgerSync.filePath)
    }, 900)
    return () => clearTimeout(timer)
  }, [ledgerSync.enabled, ledgerSync.filePath, writeLedgerSync])

  /** 校准模板：用该平台的第一张截图 + 该平台当前行数据作为已知值 */
  const handleCalibrate = useCallback(
    async (platform: LiveControlPlatform) => {
      const platformImages = imagesOf(platform)
      if (platformImages.length === 0) {
        toast.error('请先上传一张标准截图')
        return
      }
      if (!apiKey) {
        toast.error('请先填写视觉模型 API Key')
        return
      }
      // 用当前活跃行的非空数据作为已知值（至少需要几个有值的字段）
      const activeRow =
        rows.find(r => r.id === activeRowId && r.platform === platform) ??
        rows.find(r => r.platform === platform)
      const knownValues: Record<string, string> = {}
      if (activeRow) {
        for (const [k, v] of Object.entries(activeRow.values)) {
          if (v && v.trim() !== '') knownValues[k] = v.trim()
        }
      }
      if (Object.keys(knownValues).length < 5) {
        toast.error(
          `校准需要至少 5 个已填写的字段作为参考，当前只有 ${Object.keys(knownValues).length} 个。请先手动填几个关键字段（如时间、观看人数、GMV 等）`,
        )
        return
      }

      setCalibrating(true)
      try {
        const result = await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.calibrateTemplate, {
          image: { base64: platformImages[0].url }, // 用第一张图作为标准截图
          config: {
            provider: config.provider,
            model: config.model,
            apiKey,
            customBaseURL: config.provider === 'custom' ? customBaseURL : undefined,
          },
          knownValues,
        })
        setTemplate({ id: result.id, name: result.name, fieldCount: result.fields.length })
        toast.success(
          `模板校准完成！定位了 ${result.fields.length} 个字段位置。以后识别会自动使用此模板，准确度大幅提升。`,
        )
      } catch (error) {
        toast.error(`校准失败：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        setCalibrating(false)
      }
    },
    [imagesOf, apiKey, config.provider, config.model, customBaseURL, toast, rows, activeRowId],
  )

  /** 删除模板 */
  const _handleDeleteTemplate = useCallback(async () => {
    try {
      await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.deleteTemplate)
      setTemplate(null)
      toast.success('已删除视觉模板')
    } catch {
      toast.error('删除失败')
    }
  }, [toast])

  /** 更新某行的某个字段值 */
  const updateCellValue = useCallback(
    (rowId: string, key: string, val: string) => {
      setRows(prev =>
        prev.map(r => {
          if (r.id !== rowId) return r
          const next = { ...r.values, [key]: val }
          // 改「直播时长」→ 自动把「时间」补成时间段。
          // 注意：不在输入 time 时自动改写，否则用户刚打完 06:40 就被补成
          // 06:40-09:30，没法继续输入结束时间。
          if (key === 'durationHour') composeTimeRange(next)
          // 改了日期 → 自动算「周标签」（周一~周日）
          if (key === 'date') {
            const label = weekdayLabel(val)
            if (label) next.weekLabel = label
          }
          // 改了基础列时即时重算派生列
          if (COMPUTED_DEPENDENCY_KEYS.includes(key)) {
            Object.assign(next, computeDerivedValues(next, columns))
          }
          return { ...r, values: next }
        }),
      )
    },
    [columns],
  )

  /** 新增一行（归属指定平台，只带该平台自己的列） */
  const addRow = useCallback(
    (platform: LiveControlPlatform = 'douyin') => {
      const newRow = createRow(
        columns.filter(c => c.platform === platform),
        platform,
      )
      setRows(prev => [...prev, newRow])
      setActiveRowId(newRow.id)
    },
    [columns],
  )

  /** 删除一行 */
  const deleteRow = useCallback(
    (rowId: string) => {
      setRows(prev => {
        if (prev.length <= 1) {
          toast.error('至少保留一行数据')
          return prev
        }
        const next = prev.filter(r => r.id !== rowId)
        // 若删的是当前活跃行，切到第一行
        if (activeRowId === rowId) {
          setActiveRowId(next[0]?.id ?? '')
        }
        return next
      })
    },
    [activeRowId, toast],
  )

  /** 保存列管理结果：对齐行数据 + 落盘 */
  const handleSaveColumns = useCallback(
    async (newCols: LiveReportColumn[]) => {
      // 只替换「当前板块」的列，其它板块的字段原样保留
      const withPlatform = newCols.map(c => ({ ...c, platform: columnModalPlatform }))
      const merged = [...columns.filter(c => c.platform !== columnModalPlatform), ...withPlatform]
      setRows(prev => reconcileRows(prev, merged))
      setColumns(merged)
      setColumnModalOpen(false)
      try {
        await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.saveColumns, merged)
        toast.success(
          `「${sectionLabel(columnModalPlatform)}」：已保存 ${withPlatform.length} 个字段`,
        )
      } catch (error) {
        toast.error(`保存列配置失败：${error instanceof Error ? error.message : String(error)}`)
      }
    },
    [toast, columns, columnModalPlatform, sectionLabel],
  )

  /** 导出全部行为 CSV */
  /**
   * 删除板块（用户 2026-11-05：每个板块可删除，但至少保留一个）。
   * - 第一个板块不提供删除入口
   * - 板块里还有数据行时，把这些行**并入第一个板块**，不删数据
   */
  const removeSection = useCallback(
    (pf: string) => {
      const owner = sectionPlatforms[0]
      if (!owner || owner === pf) return // 第一个板块不让删
      const movingRows = rows.filter(r => (r.platform as string) === pf).length
      const movingCols = columns.filter(c => (c.platform as string) === pf).length
      setSectionPlatforms(prev => prev.filter(p => p !== pf))
      if (movingRows > 0) {
        setRows(prev =>
          prev.map(r =>
            (r.platform as string) === pf ? { ...r, platform: owner as LiveControlPlatform } : r,
          ),
        )
      }
      if (movingCols > 0) {
        setColumns(prev => {
          // 只把「第一个板块还没有的字段」并进去，同 key 的丢弃，避免重复
          const ownerKeys = new Set(
            prev.filter(c => (c.platform as string) === owner).map(c => c.key as string),
          )
          const kept = prev.filter(c => (c.platform as string) !== pf)
          const adopted = prev
            .filter(c => (c.platform as string) === pf && !ownerKeys.has(c.key))
            .map(c => ({ ...c, platform: owner as LiveControlPlatform }))
          const next = dedupeColumns([...kept, ...adopted])
          void window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.saveColumns, next)
          return next
        })
      }
      toast.success(
        movingRows > 0 || movingCols > 0
          ? `已删除板块，${movingRows} 行数据、${movingCols} 个字段已并入第一个板块`
          : '已删除板块',
      )
    },
    [sectionPlatforms, rows, columns, toast],
  )

  /** 导出该平台的行（只用该平台自己的列） */
  const handleExport = useCallback(
    async (platform: LiveControlPlatform) => {
      const platformColumns = columns.filter(c => c.platform === platform)
      const platformRows = rows.filter(r => r.platform === platform)
      if (platformRows.length === 0) {
        toast.error('这个平台还没有数据')
        return
      }
      const outputPath = await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.selectOutputPath)
      if (!outputPath) return
      try {
        const convertedRows = platformRows.map(row => {
          const converted: Record<string, string> = {}
          for (const c of platformColumns) {
            converted[c.key] = convertColumnValue(c, row.values[c.key] ?? '')
          }
          return converted
        })
        const saved = await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.exportExcel, {
          rows: convertedRows,
          outputPath,
          columns: platformColumns,
        })
        toast.success(`已导出${platformLabels[platform]} ${platformRows.length} 行：${saved}`)
      } catch (error) {
        toast.error(`导出失败：${error instanceof Error ? error.message : String(error)}`)
      }
    },
    [rows, columns, toast],
  )

  return (
    <div className="container py-8 space-y-6 max-w-6xl">
      <Title title="直播日报" description="下播后：拖入截图 → 视觉识别 → 核对 → 自动汇总进总表" />

      {/* 两个视图：分板块录入（截图识别 + 数据行） / 总表（所有板块所有日期汇总） */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={view === 'entry' ? 'default' : 'outline'}
          onClick={() => setView('entry')}
        >
          <Settings2 className="w-4 h-4 mr-1" />
          分板块录入
        </Button>
        <Button
          size="sm"
          variant={view === 'ledger' ? 'default' : 'outline'}
          onClick={() => setView('ledger')}
        >
          <Table className="w-4 h-4 mr-1" />
          总表{ledger.length > 0 ? `（${ledger.length} 条）` : ''}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          数据会自动按「日期 + 板块 + 场次」汇进总表，同一场重复识别只更新那一行
        </span>
      </div>

      {/* 按平台分板块：每个板块自带「截图识别 + 数据行」，板块与当前账号无关 */}
      {view === 'entry' &&
        sectionPlatforms.map(pf => {
          // 板块 key 是字符串，平台枚举只在取平台名/默认字段时用
          const pk = pf as LiveControlPlatform
          const pfColumns = columns.filter(c => (c.platform as string) === pf)
          const pfRows = rows.filter(r => (r.platform as string) === pf)
          const pfImages = imagesOf(pk)
          const pfActiveIndex = pfRows.findIndex(r => r.id === activeRowId)
          /** 还没识别过的图（「开始识别」只送这些） */
          const pfPending = pfImages.filter(i => !i.recognized)
          const pfDone = pfImages.length - pfPending.length
          /** 本板块是否正在识别 */
          const pfRunning = recognizing && recognizingKey === pf
          /** 本板块里被勾选的截图（可多选重认） */
          const pfPicked = pickedImages[pf] ?? []
          return (
            <Card key={pf}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Input
                        value={
                          sectionNames[pf] ?? platformLabels[pf as LiveControlPlatform] ?? '新板块'
                        }
                        onChange={e => setSectionName(pf, e.target.value)}
                        className="h-7 w-[180px] px-2 text-base font-semibold"
                        placeholder="板块名称"
                        title="点这里可以改板块名称"
                      />
                      <span className="text-sm font-normal text-muted-foreground">
                        （{pfRows.length} 行）
                      </span>
                    </CardTitle>
                    <CardDescription>
                      截图识别与数据记录都属于这个板块；识别结果写入当前选中行（蓝圈）
                    </CardDescription>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setColumnModalPlatform(pk)
                        setColumnModalOpen(true)
                      }}
                    >
                      <Settings2 className="w-4 h-4 mr-1" /> 管理列
                    </Button>
                    <Button size="sm" onClick={() => addRow(pk)}>
                      <Plus className="w-4 h-4 mr-1" /> 新增一行
                    </Button>
                    {/* 第一个板块是「主板块」，不提供删除入口；其余板块可删，
                      板块内数据会并入第一个板块，不会丢 */}
                    {sectionPlatforms[0] !== pf && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="px-2 text-muted-foreground hover:text-destructive"
                        title="删除这个板块（里面的数据会并入第一个板块）"
                        onClick={() => removeSection(pf)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* 调教区：把「你希望它怎么填」说成一句规则，长期生效 */}
                <div className="rounded-lg border bg-muted/30 px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <MessageSquarePlus className="w-3.5 h-3.5 shrink-0 text-primary" />
                    <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
                      纠正记忆
                    </span>
                    <Input
                      value={noteDraft[pf] ?? ''}
                      onChange={e => setNoteDraft(prev => ({ ...prev, [pf]: e.target.value }))}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addSectionNote(pf)
                        }
                      }}
                      placeholder="跟识别说一句，比如：观看核心城市只填第一名；不要带顿号"
                      className="h-7 flex-1 px-2 text-[11px]"
                      title="回车即可记住；记住的规则会在每次识别时一起交给模型"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => addSectionNote(pf)}
                      disabled={!(noteDraft[pf] ?? '').trim()}
                    >
                      <Send className="w-3 h-3 mr-1" />
                      记住
                    </Button>
                  </div>
                  {(sectionNotes[pf] ?? []).length > 0 && (
                    <div className="mt-1.5 space-y-1">
                      {(sectionNotes[pf] ?? []).map((note, i) => (
                        <div
                          // biome-ignore lint/suspicious/noArrayIndexKey: 规则是纯文本列表，允许重复文本、顺序固定
                          key={`${pf}-note-${i}`}
                          className="group flex items-start gap-1.5 rounded bg-background/70 px-1.5 py-1 text-[11px]"
                        >
                          <span className="shrink-0 rounded bg-primary/15 px-1 py-0.5 font-medium text-primary">
                            你
                          </span>
                          {/* 规则本身也能直接改：点进去改完就生效（存本地） */}
                          <input
                            value={note}
                            onChange={e => updateSectionNote(pf, i, e.target.value)}
                            className="flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] leading-relaxed text-foreground/85 outline-none hover:border-border focus:border-primary focus:bg-background"
                            title="点这里可以直接修改这条规则"
                          />
                          <button
                            type="button"
                            onClick={() => removeSectionNote(pf, i)}
                            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                            title="忘掉这条规则"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      <p className="pl-1 text-[10px] text-muted-foreground">
                        已记住 {(sectionNotes[pf] ?? []).length}{' '}
                        条，每次识别都会带上；点文字可直接改，× 删掉
                      </p>
                    </div>
                  )}
                </div>

                {/* biome-ignore lint/a11y/noStaticElementInteractions: 拖拽放置区，键盘不适用 */}
                <div
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={e => handleDrop(e, pk)}
                  className={`relative rounded-lg border-2 border-dashed p-2 transition-colors ${
                    isDragging ? 'border-primary bg-primary/5' : 'border-border/60'
                  }`}
                >
                  {isDragging && (
                    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-primary/5">
                      <p className="text-sm font-medium text-primary">
                        松开鼠标，把图片加入「{sectionLabel(pf)}」的识别列表
                      </p>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => fileInputs.current[pk]?.click()}>
                      选择截图
                    </Button>
                    {/* 下播后换下一场：一键清空，图片和「已识别」标记一起清掉 */}
                    {pfImages.length > 0 && (
                      <Button
                        size="sm"
                        variant={clearConfirm[pf] ? 'destructive' : 'outline'}
                        onClick={() => clearAllImages(pf, pk)}
                        disabled={recognizing}
                        title="清空这个板块里的全部截图，方便接着录下一场"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        {clearConfirm[pf] ? `确认清空 ${pfImages.length} 张？` : '清空图片'}
                      </Button>
                    )}
                    {/* 识别中：同一个位置变成「暂停识别」，跑完当前这次模型调用就停 */}
                    {pfRunning ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={handlePauseRecognize}
                        disabled={pausing}
                      >
                        <Pause className="w-3.5 h-3.5 mr-1" />
                        {pausing ? '正在暂停…' : '暂停识别'}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRecognize(pk)}
                        disabled={recognizing || pfPending.length === 0}
                        title={
                          pfPending.length === 0
                            ? '所有截图都识别过了；要重新识别请点旁边的「重认全部」'
                            : `只识别新加的 ${pfPending.length} 张，已识别的 ${pfDone} 张不会重复送模型`
                        }
                      >
                        {`${
                          pfDone > 0 && pfPending.length > 0 ? '继续识别' : '开始识别'
                        }${pfPending.length > 0 ? ` ${pfPending.length} 张` : ''} → 写入第 ${
                          pfActiveIndex >= 0 ? pfActiveIndex + 1 : 1
                        } 行`}
                      </Button>
                    )}
                    {/* 需要推倒重来时用：把所有图重新识别一遍（会重新花钱调用模型） */}
                    {!pfRunning && pfDone > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="px-2 text-muted-foreground"
                        onClick={() => handleRecognize(pk, { images: pfImages })}
                        disabled={recognizing}
                        title={`忽略「已识别」标记，把这 ${pfImages.length} 张图全部重新识别一遍`}
                      >
                        <RefreshCw className="w-3.5 h-3.5 mr-1" />
                        重认全部
                      </Button>
                    )}
                    {/* 点缩略图可多选，这里一次重认选中的几张 */}
                    {pfPicked.length > 0 && !pfRunning && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            handleRecognize(pk, {
                              images: pfImages.filter(i => pfPicked.includes(i.id)),
                            })
                          }
                          disabled={recognizing}
                          title="只把勾选的这几张重新识别一遍"
                        >
                          <RefreshCw className="w-3.5 h-3.5 mr-1" />
                          重认选中 {pfPicked.length} 张
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="px-2 text-muted-foreground"
                          onClick={() => clearPicks(pf)}
                        >
                          取消选择
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant={template ? 'secondary' : 'outline'}
                      onClick={() => handleCalibrate(pk)}
                      disabled={calibrating || pfImages.length === 0}
                    >
                      <MapPin className="w-3.5 h-3.5 mr-1" />
                      {calibrating
                        ? '校准中...'
                        : template
                          ? `已校准(${template.fieldCount}字段)`
                          : '校准模板'}
                    </Button>
                    <input
                      ref={el => {
                        fileInputs.current[pk] = el
                      }}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={e => handleSelectFiles(e, pk)}
                    />
                    <span className="text-xs text-muted-foreground">
                      {pfImages.length === 0
                        ? '支持拖拽 / ⌘V 粘贴；可多选整屏、流量、商品、人群'
                        : `共 ${pfImages.length} 张 · 已识别 ${pfDone} 张 · 待识别 ${pfPending.length} 张${
                            pfPicked.length > 0
                              ? ` · 已勾选 ${pfPicked.length} 张`
                              : ' · 点图可勾选多张'
                          }`}
                    </span>
                  </div>

                  {pfImages.length > 0 && (
                    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                      {pfImages.map(img => {
                        const picked = (pickedImages[pf] ?? []).includes(img.id)
                        return (
                          <div
                            key={img.id}
                            className={`group relative overflow-hidden rounded-md border ${
                              picked
                                ? 'border-primary ring-2 ring-primary/40'
                                : img.recognized
                                  ? 'border-emerald-500/50'
                                  : ''
                            }`}
                          >
                            {/* 点图片本身 = 勾选/取消勾选（可多选，然后一次重认） */}
                            <button
                              type="button"
                              className="block w-full"
                              onClick={() => togglePick(pf, img.id)}
                              title="点击选中这张；可多选后一次重认"
                            >
                              <img
                                src={img.url}
                                alt={img.name}
                                className="h-16 w-full object-cover"
                              />
                            </button>
                            {/* 已识别的图打勾，下次「开始识别」会跳过它们 */}
                            {img.recognized && (
                              <span className="pointer-events-none absolute left-1 top-1 rounded bg-emerald-600 px-1 py-0.5 text-[9px] font-medium text-white">
                                ✓ 已识别
                              </span>
                            )}
                            {/* 选中标记放右上角，避免和「已识别」挤在一起 */}
                            <span
                              className={`pointer-events-none absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded border text-[9px] font-bold ${
                                picked
                                  ? 'border-primary bg-primary text-white'
                                  : 'border-white/70 bg-black/40 text-transparent opacity-0 group-hover:opacity-100'
                              }`}
                            >
                              ✓
                            </span>
                            <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 opacity-0 transition group-hover:opacity-100">
                              {img.recognized && (
                                <button
                                  type="button"
                                  className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground"
                                  onClick={() => handleRecognize(pk, { images: [img] })}
                                  disabled={recognizing}
                                  title="只把这一张重新识别一遍"
                                >
                                  重认
                                </button>
                              )}
                              <button
                                type="button"
                                className="rounded bg-primary px-1.5 py-0.5 text-[10px] text-white"
                                onClick={() => setCropTarget(img)}
                              >
                                裁剪
                              </button>
                              <button
                                type="button"
                                className="rounded bg-destructive px-1.5 py-0.5 text-[10px] text-white"
                                onClick={() => removeImage(pk, img.id)}
                              >
                                删除
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {pfRows.length === 0 ? (
                  <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                    这个板块还没有数据行，点右上角「新增一行」开始
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {pfRows.map((row, idx) => (
                      <RowCard
                        key={row.id}
                        row={row}
                        rowIndex={idx}
                        rowCount={pfRows.length}
                        isActive={row.id === activeRowId}
                        columns={pfColumns}
                        onSelect={() => setActiveRowId(row.id)}
                        onUpdateValues={updateCellValue}
                        onDelete={deleteRow}
                      />
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Button size="sm" onClick={() => handleExport(pk)}>
                    <Table className="w-4 h-4 mr-1" /> 导出「{sectionLabel(pf)}」 {pfRows.length} 行
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const outputPath = await window.ipcRenderer.invoke(
                        IPC_CHANNELS.dataEntry.selectOutputPath,
                      )
                      if (!outputPath) return
                      try {
                        const saved = await window.ipcRenderer.invoke(
                          IPC_CHANNELS.dataEntry.generateTemplate,
                          { outputPath, columns: pfColumns },
                        )
                        toast.success(`已生成模板：${saved}`)
                      } catch (error) {
                        toast.error(
                          `生成失败：${error instanceof Error ? error.message : String(error)}`,
                        )
                      }
                    }}
                  >
                    生成空白模板
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}

      {/* 新建板块：板块与平台解耦，新建后自己改名、从别的板块导入字段 */}
      {view === 'entry' && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 py-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const key = `custom-${Date.now().toString(36)}`
                setSectionPlatforms(prev => [...prev, key])
                setSectionNames(prev => {
                  const next = { ...prev, [key]: `新板块 ${Object.keys(prev).length + 1}` }
                  try {
                    localStorage.setItem('data-entry-section-names', JSON.stringify(next))
                  } catch {
                    // 忽略
                  }
                  return next
                })
              }}
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> 新建板块
            </Button>
            <span className="text-xs text-muted-foreground">
              新建后点标题改名，再点「管理列 → 导入字段」从其它板块复制模板
            </span>
          </CardContent>
        </Card>
      )}

      {/* ── 总表：所有板块、所有日期的数据都在这一张表里 ── */}
      {view === 'ledger' && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">日报总表</CardTitle>
                <CardDescription className="text-xs">
                  共 {ledger.length} 条记录 · 按「日期 + 板块 +
                  场次」自动去重；格子里可以直接改，改完自动存
                  {ledgerSync.enabled && (
                    <span className="block text-[11px] text-muted-foreground/80">
                      实时写入 {syncFileName}
                      （这个文件由软件覆盖写入，别在里面改，改了会被下次同步冲掉）
                    </span>
                  )}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={ledgerFilter || '__all'}
                  onValueChange={v => setLedgerFilter(v === '__all' ? '' : v)}
                >
                  <SelectTrigger className="h-8 w-[150px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">全部板块</SelectItem>
                    {sectionPlatforms.map(pf => (
                      <SelectItem key={pf} value={pf}>
                        {sectionLabel(pf)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={handleExportLedger} disabled={ledgerRows.length === 0}>
                  <Table className="w-4 h-4 mr-1" />
                  导出整表（{ledgerRows.length} 行）
                </Button>
                {/* 实时同步：总表一变就把整张表写进你电脑上的 .xlsx，不用反复导出 */}
                {ledgerSync.enabled ? (
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleSyncNow}
                      disabled={syncing}
                      title={`${ledgerSync.filePath}\n${
                        lastSyncedAt
                          ? `上次同步 ${new Date(lastSyncedAt).toLocaleTimeString()}`
                          : ''
                      }`}
                    >
                      <FileSpreadsheet className="w-4 h-4 mr-1" />
                      {syncing ? '同步中…' : `已同步 · ${syncFileName}`}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleStopLedgerSync}
                      title="停止实时同步（已写入的数据不受影响）"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={handleStartLedgerSync}>
                    <FileSpreadsheet className="w-4 h-4 mr-1" />
                    实时同步到表格
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {ledgerRows.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
                总表还是空的：去「分板块录入」里识别或填写数据，有内容的行会自动汇总到这里
              </p>
            ) : (
              <div className="overflow-auto rounded-md border" style={{ maxHeight: 560 }}>
                <table className="w-max border-collapse text-[11px]">
                  <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur">
                    <tr>
                      <th className="min-w-[92px] border-b border-r px-2 py-1 text-left font-semibold">
                        板块
                      </th>
                      <th className="min-w-[92px] border-b px-2 py-1 text-left font-semibold">
                        日期
                      </th>
                      <th className="min-w-[70px] border-b px-2 py-1 text-left font-semibold">
                        场次
                      </th>
                      {ledgerColumns
                        .filter(
                          c => c.key !== 'date' && c.key !== 'session' && c.key !== 'weekLabel',
                        )
                        .map(c => (
                          <th
                            key={c.key}
                            className="min-w-[76px] border-b px-2 py-1 text-left font-semibold"
                            title={c.key}
                          >
                            {c.label}
                          </th>
                        ))}
                      <th className="border-b px-2 py-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerRows.map(r => {
                      const cols = ledgerColumns.filter(
                        c => c.key !== 'date' && c.key !== 'session' && c.key !== 'weekLabel',
                      )
                      return (
                        <tr key={r.id} className="hover:bg-muted/40">
                          <td className="border-b border-r px-2 py-1 text-muted-foreground">
                            {r.sectionName}
                          </td>
                          <td className="border-b px-0.5 py-0.5">
                            <input
                              value={r.values.date ?? ''}
                              onChange={e => updateLedgerCell(r.id, 'date', e.target.value)}
                              placeholder="—"
                              className="w-full min-w-[88px] rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] outline-none hover:border-border focus:border-primary focus:bg-background"
                            />
                          </td>
                          <td className="border-b px-0.5 py-0.5">
                            <input
                              value={r.values.session ?? ''}
                              onChange={e => updateLedgerCell(r.id, 'session', e.target.value)}
                              placeholder="—"
                              className="w-full min-w-[66px] rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] outline-none hover:border-border focus:border-primary focus:bg-background"
                            />
                          </td>
                          {cols.map(c => (
                            <td key={c.key} className="border-b px-0.5 py-0.5">
                              <input
                                value={r.values[c.key] ?? ''}
                                onChange={e => updateLedgerCell(r.id, c.key, e.target.value)}
                                className="w-full min-w-[70px] rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] outline-none hover:border-border focus:border-primary focus:bg-background"
                              />
                            </td>
                          ))}
                          <td className="border-b px-1">
                            <button
                              type="button"
                              onClick={() => removeLedgerRow(r.id)}
                              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              title="从总表删掉这一行"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 视觉模型配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">视觉识别模型</CardTitle>
          <CardDescription className="text-xs">截图识别用的模型，填过一次就会记住</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="space-y-2">
            <Label className="text-[11px] text-muted-foreground">服务商</Label>
            <Select
              value={config.provider}
              onValueChange={p => {
                const m = providers[p]?.models?.[0] ?? ''
                setConfig({ provider: p, model: m })
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map(([key, p]) => (
                  <SelectItem key={key} value={key}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-[11px] text-muted-foreground">模型</Label>
            {modelOptions.length > 0 ? (
              <Select value={config.model} onValueChange={m => setConfig({ model: m })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map(m => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="space-y-1">
                {/* 方舟两种调法：直连模型 ID / 自己建的推理接入点 ep-xxx。
                    给两个明确的切换入口，别让人猜 ep 该填哪。 */}
                {config.provider === 'volcengine' && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setVolcMode('model')
                        // 回填上次填过的模型 ID（不清空 —— 清空会把用户刚粘的 ep 弄丢）
                        switchModelMode('model')
                        toast.success('已切到「模型 ID」：填 doubao-xxx，需在方舟先开通该模型')
                      }}
                      className={`rounded border px-2 py-0.5 text-[10px] transition ${
                        volcMode === 'model'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/50'
                      }`}
                    >
                      用模型 ID
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setVolcMode('endpoint')
                        // 回填上次粘过的接入点（模型 ID 那份另外存着，切回去还在）
                        switchModelMode('endpoint')
                        toast.success('已切到「接入点」：把方舟控制台里的 ep-xxxxxxxx 粘进来')
                      }}
                      className={`rounded border px-2 py-0.5 text-[10px] transition ${
                        volcMode === 'endpoint'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/50'
                      }`}
                    >
                      用接入点 ep-
                    </button>
                  </div>
                )}
                <Input
                  value={config.model}
                  onChange={e => setModelValue(volcMode, e.target.value)}
                  placeholder={
                    config.provider !== 'volcengine'
                      ? '如 glm-4v-plus'
                      : volcMode === 'endpoint'
                        ? 'ep-2026100411306-xxxxx（你在方舟建的接入点）'
                        : 'doubao-seed-2-1-pro-260915（模型 ID）'
                  }
                />
                {config.provider === 'volcengine' && volcMode === 'model' && (
                  <>
                    {/* 一键切常用型号；浏览器原生的 datalist 下拉会挡住下面的按钮，已去掉 */}
                    <div className="flex flex-wrap gap-1">
                      {VOLC_VISION_MODELS.map(m => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setModelValue('model', m.id)}
                          className={`rounded border px-1.5 py-0.5 text-[10px] transition ${
                            config.model === m.id
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border text-muted-foreground hover:border-primary/50'
                          }`}
                          title={`${m.id} — ${m.note}`}
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] leading-relaxed text-muted-foreground">
                      直连模型 ID 需要先在方舟「开通」这个模型，开通后直接填上面的 ID 即可。
                    </p>
                  </>
                )}
                {config.provider === 'volcengine' && volcMode === 'endpoint' && (
                  <>
                    {config.model.trim().startsWith('ep-') && (
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
                        ✓ 已记住这个接入点，下次打开还在；切到「模型 ID」也不会丢
                      </p>
                    )}
                    <p className="text-[10px] leading-relaxed text-muted-foreground">
                      去方舟控制台 →「在线推理」→ 创建接入点 → 选中 doubao 视觉模型 → 把生成的{' '}
                      <code className="px-0.5">ep-xxxxxxxx</code>
                      填到这里。这个方式不用额外开通模型，但每换一个模型都要建一个新接入点。
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-[11px] text-muted-foreground">API Key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(config.provider, e.target.value)}
              placeholder="粘贴你的视觉模型 API Key"
            />
          </div>

          {config.provider === 'custom' && (
            <div className="space-y-2">
              <Label className="text-[11px] text-muted-foreground">API 地址</Label>
              <Input
                value={customBaseURL}
                onChange={e => setCustomBaseURL(e.target.value)}
                placeholder="https://open.bigmodel.cn/api/paas/v4/"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {cropTarget && (
        <CropModal
          image={cropTarget}
          onCancel={() => setCropTarget(null)}
          onConfirm={dataUrl => {
            // 裁剪结果加回「原图所属平台」的列表
            const owner = (Object.keys(imagesByPlatform) as LiveControlPlatform[]).find(pf =>
              (imagesByPlatform[pf] ?? []).some(i => i.id === cropTarget.id),
            )
            setImagesOf(owner ?? 'douyin', prev => [
              ...prev,
              {
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                url: dataUrl,
                name: `${cropTarget.name} 裁剪`,
              },
            ])
            setCropTarget(null)
          }}
        />
      )}

      {columnModalOpen && (
        <ColumnManagerModal
          columns={columns.filter(c => c.platform === columnModalPlatform)}
          allColumns={columns}
          platform={columnModalPlatform}
          labelOf={sectionLabel}
          onCancel={() => setColumnModalOpen(false)}
          onSave={handleSaveColumns}
        />
      )}
    </div>
  )
}
