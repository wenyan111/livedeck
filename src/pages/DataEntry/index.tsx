import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  FileSpreadsheet,
  GripVertical,
  MessageSquarePlus,
  Pause,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Table,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  buildLedgerColumns,
  hasAnyValue,
  type LedgerRecord,
  ledgerKeyOf,
  newLedgerId,
} from 'shared/dataEntryLedger'
import {
  type DataEntrySectionsState,
  mergeSectionsState,
  normalizeSectionsState,
} from 'shared/dataEntrySections'
import type { DataEntrySavedState } from 'shared/dataEntryState'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import type { LedgerSyncConfig } from 'shared/ledgerSync'
import {
  applyColumnSuffixes,
  COMPUTED_DEPENDENCY_KEYS,
  computeDerivedValues,
  computedRuleOf,
  convertColumnValue,
  expectsNumericValue,
  generateColumnKey,
  getDefaultColumns,
  LIVE_REPORT_COLUMNS,
  type LiveReportColumn,
  parseDurationHours,
  roundByColumn,
  unknownRefsOf,
  withColumnSuffix,
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
import { getEffectiveModel, useAIProvider } from '@/hooks/useAIProvider'
import { useToast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'

/** 方舟三个常用型号的显示名（快捷填按钮上用的） */
const _VOLC_MODEL_LABELS: Record<string, string> = {
  'doubao-seed-2-1-pro-260915': 'Seed 2.1 pro',
  'doubao-seed-2-1-turbo-260628': 'Seed 2.1 turbo',
  'doubao-seed-2-0-lite-260428': 'Seed 2.0 lite',
}

/** 规则框最大高度：到顶后内部滚动，别把列表撑满整屏 */
const RULE_BOX_MAX_HEIGHT = 120

/** textarea 随内容长高（上限 RULE_BOX_MAX_HEIGHT），规则框和新增框共用 */
function useAutoGrow(value: string) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 高度重算靠 value 变化触发，函数体本身不需要读 value
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, RULE_BOX_MAX_HEIGHT)}px`
  }, [value])
  return ref
}

/**
 * 已写好的规则框：默认一行高，随内容自动长高（上限 120px）。
 * 用户 2026-11-06「这里做小点」——原先固定写死两行，短规则也白占两行高度，5 条规则就把面板撑得很长。
 */
function RuleTextarea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useAutoGrow(value)
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={e => onChange(e.target.value)}
      rows={1}
      placeholder="在这里写规则，改完立即生效"
      title="可以直接改这条规则，改完自动保存；一条里换行写多条也可以"
      className="min-w-0 flex-1 resize-none overflow-y-auto rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] leading-relaxed text-foreground/85 outline-none hover:border-border focus:border-primary focus:bg-background"
    />
  )
}

/**
 * 新增规则的输入框：回车加上、Shift+回车换行（用户 2026-11-06 问「所有规则能不能填在一条里」
 * —— 可以，换行写进同一条即可，所以这里必须是能换行的多行框，单行 input 会把换行吃掉）。
 */
function RuleComposer({
  value,
  onChange,
  onSubmit,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
}) {
  const ref = useAutoGrow(value)
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => {
        // 中文输入法选词时的回车不算提交
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault()
          onSubmit()
        }
      }}
      rows={1}
      placeholder="写规则，回车加上 · Shift+回车换行（多条规则也能写在一条里）"
      title="回车加上这条规则；Shift+回车换行，可以把所有规则写在同一条里"
      className="min-h-7 min-w-0 flex-1 resize-none overflow-y-auto rounded-md border border-input bg-background px-2 py-0.5 text-[12px] leading-6 outline-none placeholder:text-muted-foreground focus:border-primary"
    />
  )
}

/**
 * 「API Key 配置」弹窗：选服务商 → 填模型/接入点 → 填 Key，
 * 取消不写回，保存才落盘（用户 2026-11-06 给的样式）。
 */
function VisionConfigModal({
  provider,
  model,
  apiKey,
  customBaseURL,
  providerOptions,
  onSave,
  onClose,
}: {
  provider: string
  model: string
  apiKey: string
  customBaseURL: string
  providerOptions: [string, ProviderInfo][]
  onSave: (next: { provider: string; model: string; apiKey: string; customBaseURL: string }) => void
  onClose: () => void
}) {
  const [draftProvider, setDraftProvider] = useState(provider)
  const [draftModel, setDraftModel] = useState(model)
  const [draftKey, setDraftKey] = useState(apiKey)
  const [draftBaseURL, setDraftBaseURL] = useState(customBaseURL)
  const [showKey, setShowKey] = useState(false)
  const info = providers[draftProvider]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl bg-card shadow-xl">
        <div className="flex items-start justify-between px-6 pt-5">
          <div>
            <h2 className="text-lg font-semibold">API Key 配置</h2>
            <p className="mt-1 text-sm text-muted-foreground">选择并配置您想要使用的 AI 提供商。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="space-y-1.5">
            <Label className="text-[13px] font-medium">选择提供商</Label>
            <Select
              value={draftProvider}
              onValueChange={value => {
                setDraftProvider(value)
                // 换服务商时把模型清成该服务商的第一项，避免留着上一家的 ID
                setDraftModel(providers[value]?.models?.[0] ?? '')
              }}
            >
              <SelectTrigger className="h-10">
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

          <div className="space-y-1.5">
            <Label className="text-[13px] font-medium">模型或接入点 ID</Label>
            <Input
              value={draftModel}
              onChange={e => setDraftModel(e.target.value)}
              placeholder={
                draftProvider === 'volcengine' ? 'ep-xxxxxxxx（接入点）' : '如 glm-4v-plus'
              }
              className="h-10"
            />
            <p className="text-xs text-muted-foreground">
              可以在
              {info?.apiUrl ? (
                <a
                  href={info.apiUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mx-1 text-primary underline-offset-2 hover:underline"
                >
                  {info.name} 控制台
                </a>
              ) : (
                ' 服务商控制台 '
              )}
              获取模型 ID 或接入点 ID。
            </p>
          </div>

          {draftProvider === 'custom' && (
            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium">API 地址</Label>
              <Input
                value={draftBaseURL}
                onChange={e => setDraftBaseURL(e.target.value)}
                placeholder="https://open.bigmodel.cn/api/paas/v4/"
                className="h-10"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-[13px] font-medium">API Key</Label>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={draftKey}
                onChange={e => setDraftKey(e.target.value)}
                placeholder="粘贴你的 API Key"
                className="h-10 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition hover:text-foreground"
                title={showKey ? '隐藏' : '显示'}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              在
              {info?.apiUrl ? (
                <a
                  href={info.apiUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mx-1 text-primary underline-offset-2 hover:underline"
                >
                  {info.name}
                </a>
              ) : (
                ' 服务商控制台 '
              )}
              获取 API Key。您的密钥会被安全地存储在本地。
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-6 py-3.5">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={() =>
              onSave({
                provider: draftProvider,
                model: draftModel.trim(),
                apiKey: draftKey.trim(),
                customBaseURL: draftBaseURL.trim(),
              })
            }
          >
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}

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

/**
 * 总表「平台」列按日报口径写大平台名，而不是中控台后台名。
 * 之前直接用 platformLabels[sectionKey] 会把巨量百应写成「抖音小店」，
 * 与日报里的「抖音 / 视频号 / 小红书 / 淘宝 / 快手」对不上（2026-11-05 用户指出「这里不对」）。
 */
const _PLATFORM_GROUP_LABELS: Record<string, string> = {
  douyin: '抖音',
  buyin: '抖音',
  eos: '抖音',
  wxchannel: '视频号',
  xiaohongshu: '小红书',
  pgy: '小红书',
  kuaishou: '快手',
  taobao: '淘宝',
  dev: '测试',
}

/**
 * 「填写规则」按板块各自一套：板块有自己的 key 就用自己的，
 * 否则先继承通用规则（__all__）。第一次增删改时 ownNotes() 把继承来的复制成自己的一套，
 * 这样以后改这个板块不会影响别的板块，且**不需要任何启动时迁移、不改现有数据**。
 */
function notesFor(notes: Record<string, string[]>, key: string): string[] {
  const own = notes[key]
  return own === undefined ? [...(notes.__all__ ?? [])] : own
}
function ownNotes(notes: Record<string, string[]>, key: string): Record<string, string[]> {
  if (notes[key] !== undefined) return notes
  return { ...notes, [key]: [...(notes.__all__ ?? [])] }
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
/**
 * 从「填写规则」里解析出「规则固定」字段的定值（用户 2026-11-07 要求）。
 *
 * 规则是全局一段文字，可能一条里换行写了好几条，所以先拆行、剥掉手写的序号。
 * 只认「字段名（+可选动词）+ 冒号 + 值」这种明确给值的写法：
 *   「主品：「VD FIT全燃美塑仪EMS腰带」」「主品填：VD FIT…」→ 解析出定值
 *   「时间写成「10:40-13:08」这种具体时间段」→ 是格式说明，不当定值
 * 这样「规则固定」就能区分：写了定值就直接填、不发给 AI；只写格式说明就仍走识别。
 */
function parseFixedValues(notes: string[], columns: LiveReportColumn[]): Record<string, string> {
  const fixed = columns.filter(c => c.source === 'fixed')
  if (fixed.length === 0 || notes.length === 0) return {}
  const lines = notes
    .flatMap(n => String(n).split(/\r?\n/))
    .map(l => l.replace(/^\s*\d+[.、)]\s*/, '').trim())
    .filter(Boolean)
  const out: Record<string, string> = {}
  for (const line of lines) {
    for (const c of fixed) {
      if (out[c.key]) continue
      for (const name of [c.label, c.key]) {
        if (!name || !line.startsWith(name)) continue
        const rest = line.slice(name.length).trim()
        const m = rest.match(/^(?:填写|填|设为|写成|为|是)?\s*[:：]\s*(.+)$/)
        if (!m) continue
        const v = m[1]
          .trim()
          .replace(/^[「"'']+|[」"'']+$/g, '')
          .trim()
        if (v) {
          out[c.key] = v
          break
        }
      }
    }
  }
  return out
}

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
    // 最后补「显示后缀」（如 %）：识别、手填旧值、计算出来的值都在这里统一带上
    applyColumnSuffixes(next, newColumns)
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
/** 两位补零 */
const pad2 = (n: number) => String(n).padStart(2, '0')

/** 是不是「2小时05分」这种中文时长格式（用户用纠正记忆规定的写法） */
function isChineseDuration(raw: string): boolean {
  return /^\d+\s*小?时\s*\d{1,2}\s*分$/.test(String(raw ?? '').trim())
}

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
      if (isChineseDuration(values.durationHour ?? '')) {
        // 模型按「纠正记忆」填的是「2小时28分」这种格式 —— 反算时也用同一种格式写回去，
        // 别再用小数覆盖掉用户规定的写法（2026-11-06 用户反馈「我的规定为什么没有执行」）。
        const totalMin = Math.round(end - start)
        values.durationHour = `${Math.floor(totalMin / 60)}小时${pad2(totalMin % 60)}分`
      } else {
        const digits = digitsForDuration(values)
        values.durationHour = String(+hours.toFixed(digits))
      }
    }
    return
  }

  // 方向二：时间是单个「06:40」→ 用开始时间 + 直播时长拼成时间段
  const single = raw.match(/^(\d{1,2}):(\d{2})$/)
  if (!single) return
  const duration = parseDurationHours(values.durationHour ?? '')
  if (duration === null || duration <= 0) return
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
    // 旧配置里可能还留着已下线的「firstOnly」字段，顺手清掉，不让它继续跟着存盘
    const cleaned = { ...c } as LiveReportColumn & { firstOnly?: boolean }
    delete cleaned.firstOnly
    out.push(cleaned)
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
  isActive,
  columns,
  onUpdateValues,
  flashKeys = [],
}: {
  row: DataRow
  isActive: boolean
  columns: LiveReportColumn[]
  onUpdateValues: (rowId: string, key: string, val: string) => void
  /** 本次识别刚写入、需要高光的字段 key */
  flashKeys?: string[]
}) {
  const [expanded, setExpanded] = useState(true)

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
      </div>

      {/* 展开的字段网格 */}
      {expanded && (
        <div className="px-3 pb-2.5 space-y-2 border-t pt-2">
          {/* 格子颜色图例：小字一行，省得每次猜橙框 / 绿底是什么意思（用户 2026-11-07） */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            <span className="font-medium">格子颜色</span>
            <span className="inline-flex items-center gap-1">
              <i className="inline-block h-2.5 w-2.5 rounded-sm ring-1 ring-warning" /> 待核对
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="inline-block h-2.5 w-2.5 rounded-sm bg-success/25" /> 已识别
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="inline-block h-2.5 w-2.5 rounded-sm bg-destructive/25" /> 未填
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="inline-block h-2.5 w-2.5 rounded-sm bg-muted" /> 人工/留空/计算
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="inline-block h-2.5 w-2.5 rounded-sm bg-success" /> 刚写入
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7">
            {columns.map(col => {
              const val = row.values[col.key] ?? ''
              const isManual = col.source === 'manual'
              const isSkip = col.source === 'skip'
              const isComputed = col.source === 'computed'
              // 只有「本该是数字」的字段才画低置信度橙框；
              // 旧存档里误标的 session 等文字结论不会再显示（不改用户数据）
              const isLow = row.lowConfidence.includes(col.key) && expectsNumericValue(col)
              const filled = val.trim() !== ''
              const ring = flashKeys.includes(col.key)
                ? 'ring-2 ring-success bg-success/25 shadow-[0_0_10px_rgba(34,197,94,0.55)] transition-all duration-500'
                : isSkip
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
      )}
    </div>
  )
}

/** 列管理弹窗：增 / 删 / 改标签、单位、类型 */
function ColumnManagerModal({
  columns,
  platform,
  allColumns,
  labelOf,
  onCancel,
  onSave,
}: {
  /** 当前板块自己的列（只显示这些，保存时也只替换这些） */
  columns: LiveReportColumn[]
  /** 当前正在编辑哪个板块（新增/导入的列归到这个板块） */
  platform: LiveControlPlatform
  /** 全部板块的字段，用于「从其它板块导入字段」 */
  allColumns: LiveReportColumn[]
  /** 板块 key → 显示名（自定义板块名只有页面知道） */
  labelOf: (key: string) => string
  onCancel: () => void
  onSave: (cols: LiveReportColumn[]) => void
}) {
  const { toast } = useToast()
  const [draft, setDraft] = useState<LiveReportColumn[]>(() => columns.map(c => ({ ...c })))
  /** 拖动排序：记住正在拖的行和被悬停的行，用于位移与高亮（用户 2026-11-06 要求标签可拖动换顺序） */
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  /** 勾选的字段 key（批量删除用，用户 2026-11-06 要求） */
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  /**
   * 字段搜索（用户 2026-11-07：字段太多不好找）。
   * 只做**视觉过滤**：渲染时用真实 idx，保存时 onSave(draft) 仍是完整列表，绝不丢字段。
   * 搜索状态下禁用拖拽 / 全选 / 批量删除，避免误操作到被筛掉的字段。
   */
  const [query, setQuery] = useState('')
  const searching = query.trim().length > 0
  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = draft.map((col, idx) => ({ col, idx }))
    if (!q) return rows
    return rows.filter(({ col }) =>
      [col.label, col.key, col.group ?? '', col.unit ?? ''].some(v =>
        String(v ?? '')
          .toLowerCase()
          .includes(q),
      ),
    )
  }, [draft, query])
  const toggleSelected = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  /** 勾选的字段一次性删掉 */
  const removeSelected = () => {
    const count = selected.size
    if (count === 0) return
    setDraft(prev => prev.filter(c => !selected.has(c.key)))
    setSelected(new Set())
    toast.success(`已删掉 ${count} 个字段，记得点「保存」`)
  }
  /** 一键清空本板块所有字段（要点确认，误点代价太大） */
  const removeAll = () => {
    if (draft.length === 0) return
    if (!window.confirm(`确定清空本板块全部 ${draft.length} 个字段？保存后生效`)) return
    setDraft([])
    setSelected(new Set())
    toast.success('已清空，记得点「保存」')
  }

  /** 把 from 行挪到 to 位置，其余依次顺移 */
  const moveColumn = useCallback((from: number, to: number) => {
    setDraft(prev => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }, [])

  /** 可导入来源：其它板块里已有的字段（板块 key → 数量） */
  const importSources = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of allColumns) {
      const key = String(c.platform ?? '')
      if (!key || key === (platform as string)) continue
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return [...map.entries()]
  }, [allColumns, platform])

  /** 把某个板块的字段整套复制过来（同 key / 同名的跳过） */
  const importFrom = (src: string) => {
    const existingKeys = new Set(draft.map(c => c.key))
    const existingLabels = new Set(draft.map(c => c.label.trim()))
    const added = allColumns
      .filter(c => String(c.platform ?? '') === src)
      .filter(c => !existingKeys.has(c.key) && !existingLabels.has(c.label.trim()))
      .map(c => ({ ...c, platform }))
    if (added.length === 0) {
      toast.error('没有可导入的新字段（已经有了）')
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
  /**
   * 从外部表格导入字段：读第一行表头，一次性变成标签列。
   * 用户 2026-11-06：一个一个手加太麻烦。重名的自动跳过，不会覆盖已有列的配置。
   */
  const importFromFile = useCallback(async () => {
    const headers = await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.importColumnHeaders)
    if (!headers) return
    const texts = headers.map(h => String(h ?? '').trim()).filter(Boolean)
    if (texts.length === 0) {
      toast.error('没读到表头：请确认文件第一行就是字段名')
      return
    }
    const seen = new Set(draft.map(c => c.label.trim()))
    const fresh: string[] = []
    for (const label of texts) {
      if (seen.has(label)) continue
      seen.add(label)
      fresh.push(label)
    }
    if (fresh.length === 0) {
      toast.error(`这 ${texts.length} 个字段都已经有了，没有可新增的`)
      return
    }
    setDraft(prev => {
      const next = [...prev]
      for (const label of fresh) {
        next.push({
          platform,
          key: generateColumnKey(next),
          label,
          unit: 'text',
          source: 'manual',
          group: '导入',
        })
      }
      return next
    })
    toast.success(
      `已导入 ${fresh.length} 个字段` +
        (texts.length > fresh.length ? `（重名跳过 ${texts.length - fresh.length} 个）` : ''),
    )
  }, [draft, platform, toast])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="rounded-lg bg-card shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col">
        {/* 头部收成两行：第一行只有标题/说明/列数，第二行才是操作按钮，
            原来全挤在一行，说明文字被按钮顶成三行（用户 2026-11-06：太乱） */}
        <div className="border-b px-5 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">管理列（标签）</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                可新增 / 删除 / 改名，也能改单位与类型；改完点「保存」生效。
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {draft.length} 列
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="搜索字段名 / key / 单位，快速定位"
                className="h-8 pl-8 pr-8 text-xs"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  title="清除搜索"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {searching
                ? `匹配 ${visibleRows.length} / ${draft.length} 列 · 批量操作暂不可用`
                : ''}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 whitespace-nowrap px-2 text-[11px]"
              onClick={importFromFile}
              title="选一个 Excel / CSV，把第一行表头一次性导成字段"
            >
              <Upload className="w-3 h-3 mr-1" /> 从文件导入
            </Button>
            {importSources.map(([src, count]) => (
              <Button
                key={src}
                size="sm"
                variant="outline"
                className="h-7 shrink-0 whitespace-nowrap px-2 text-[11px]"
                onClick={() => importFrom(src)}
                title={`把「${labelOf(src)}」的 ${count} 个字段复制到本板块`}
              >
                <Copy className="w-3 h-3 mr-1" /> 导入「{labelOf(src)}」{count}
              </Button>
            ))}
            {/* 删除类操作单独成组靠右；按钮多到换行时也不会被容器裁掉 */}
            <div className="ml-auto flex items-center gap-2">
              {/* 字段太多时一个个点垃圾桶太慢：勾选后一次删掉，或一键清空（用户 2026-11-06） */}
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 whitespace-nowrap px-2 text-[11px] text-destructive hover:text-destructive"
                onClick={removeSelected}
                disabled={selected.size === 0 || searching}
                title={
                  searching
                    ? '清除搜索后可批量删除（避免误删被筛掉的字段）'
                    : '把勾选的字段一次删掉'
                }
              >
                <Trash2 className="w-3 h-3 mr-1" /> 删除选中
                {selected.size > 0 ? ` (${selected.size})` : ''}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 whitespace-nowrap px-2 text-[11px] text-destructive hover:text-destructive"
                onClick={removeAll}
                disabled={draft.length === 0 || searching}
                title={searching ? '清除搜索后可清空全部字段' : '清空本板块所有字段'}
              >
                全部删除
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {/* 表头：第一格是拖动手柄的位置 */}
          <div className="grid grid-cols-[18px_20px_1fr_82px_56px_100px_76px_32px] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 cursor-pointer accent-primary"
              disabled={searching}
              checked={draft.length > 0 && selected.size === draft.length}
              onChange={e => {
                setSelected(e.target.checked ? new Set(draft.map(c => c.key)) : new Set())
              }}
              title={
                searching
                  ? '搜索状态下不能全选，清除搜索后可批量操作'
                  : selected.size === draft.length
                    ? '取消全选'
                    : '全选'
              }
            />
            <span title="拖动手柄可调整列顺序" className="flex justify-center">
              ⇅
            </span>
            <span>标签名</span>
            <span title="输入换算：把识别到的原文转成数字，例如「1.5%」→「1.5」、「9700」→「0.97万」。不负责显示单位">
              单位
            </span>
            <span title="输出后缀：结果后面自动补的文字，如 % / 万 / 元。和「单位」互不冲突，留空就不加">
              后缀
            </span>
            <span title="规则固定：规则里写「字段名：定值」就直接填入、不发给 AI；没写定值则仍按截图识别 + 规则修正">
              类型
            </span>
            <span title="四舍五入到几位小数">小数位</span>
            <span />
          </div>
          {visibleRows.map(({ col, idx }) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: 整行只是拖拽落点，真正的可交互控件是里面的手柄按钮
            <div
              key={col.key}
              data-col-row
              onDragOver={e => {
                // 必须 preventDefault 才允许 drop
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (overIndex !== idx) setOverIndex(idx)
              }}
              onDragLeave={() => setOverIndex(i => (i === idx ? null : i))}
              onDrop={e => {
                e.preventDefault()
                const from = Number(e.dataTransfer.getData('text/plain'))
                moveColumn(from, idx)
                setDragIndex(null)
                setOverIndex(null)
              }}
              className={`grid grid-cols-[18px_20px_1fr_82px_56px_100px_76px_32px] gap-2 items-center rounded-md transition-colors ${
                dragIndex === idx ? 'opacity-40' : ''
              } ${
                overIndex === idx && dragIndex !== null && dragIndex !== idx
                  ? 'bg-primary/10 ring-1 ring-primary/40'
                  : ''
              }`}
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 cursor-pointer accent-primary"
                checked={selected.has(col.key)}
                onChange={() => toggleSelected(col.key)}
                title="勾选后可批量删除"
              />
              {/* 拖动手柄：按下即拖，松手落位；行本身不 draggable，避免和输入框选字打架 */}
              <button
                type="button"
                draggable={!searching}
                disabled={searching}
                onDragStart={e => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', String(idx))
                  // 拖动时用整行当跟随影像，不然只有一个小图标飘着
                  const row = e.currentTarget.closest('[data-col-row]') as HTMLElement | null
                  if (row) e.dataTransfer.setDragImage(row, 14, row.offsetHeight / 2)
                  setDragIndex(idx)
                }}
                onDragEnd={() => {
                  setDragIndex(null)
                  setOverIndex(null)
                }}
                className="flex h-8 cursor-grab justify-center rounded text-muted-foreground/70 transition hover:bg-muted hover:text-foreground active:cursor-grabbing"
                title={
                  searching
                    ? '搜索状态下不能调整顺序，清除搜索后可拖动'
                    : '按住拖动，换这一列的先后顺序'
                }
                aria-label={`拖动调整「${col.label}」的顺序`}
              >
                <GripVertical className="w-4 h-4 self-center" />
              </button>
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
              <Input
                value={col.suffix ?? ''}
                onChange={e => update(idx, { suffix: e.target.value })}
                className="h-8 text-xs"
                placeholder="—"
                title="显示后缀：识别/自动计算出来的值后面自动补的文字（如 % / 万 / 元）。留空不加；已经有后缀不会重复加。手填的值请自己写全"
              />
              <Select
                value={col.source}
                onValueChange={s => update(idx, { source: s as LiveReportColumn['source'] })}
              >
                <SelectTrigger className="h-8 text-xs" title={computedRuleOf(col.key, col.source)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">人工填写</SelectItem>
                  <SelectItem value="vision">视觉识别</SelectItem>
                  <SelectItem value="ai">AI 判断</SelectItem>
                  <SelectItem value="fixed">规则固定</SelectItem>
                  <SelectItem value="skip">留空</SelectItem>
                  <SelectItem value="computed">自动计算</SelectItem>
                </SelectContent>
              </Select>
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
              <button
                type="button"
                onClick={() => remove(idx)}
                className="text-destructive hover:text-destructive/80 p-1 rounded hover:bg-destructive/10 flex justify-center"
                title="删除该列"
              >
                <Trash2 className="w-4 h-4" />
              </button>

              {/* 自动计算字段：让用户自己写公式，不用每次找开发改代码。
                  用 [字段名] 引用其它字段，例如 [支付GMV] / [观看人数] * 100 */}
              {col.source === 'computed' && (
                <div className="col-span-full flex items-center gap-2 pb-1 pl-9">
                  <span className="shrink-0 text-[10px] text-muted-foreground">公式</span>
                  <Input
                    value={col.formula ?? ''}
                    onChange={e => update(idx, { formula: e.target.value })}
                    placeholder={
                      computedRuleOf(col.key, col.source)
                        ? `内置：${computedRuleOf(col.key, col.source)}（想自己算就写在这里，会覆盖内置）`
                        : '例：[支付GMV] / [观看人数] * 100'
                    }
                    className="h-7 flex-1 font-mono text-[11px]"
                    title="用 [字段名] 引用其它字段，支持 + - * / ( )。留空就用内置公式"
                  />
                  {/* 引用写错（字段改名/打错字）时当场提示，别等算了才发现是空的 */}
                  {unknownRefsOf(col.formula ?? '', draft).length > 0 && (
                    <span className="shrink-0 text-[10px] text-destructive">
                      引用不到：{unknownRefsOf(col.formula ?? '', draft).join('、')}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
          {searching && visibleRows.length === 0 && (
            <div className="py-6 text-center text-xs text-muted-foreground">
              没有匹配「{query.trim()}」的字段，换个关键词或清除搜索
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setQuery('')
              add()
            }}
            className="mt-1"
          >
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
  const { config, apiKeys, customBaseURL, setConfig, setApiKey, setCustomBaseURL } =
    useAIProvider('vision')

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
   * 真正发给接口的模型字段：模型栏里写什么就用什么（模型 ID 或 ep-xxx 都行）。
   * 2026-11-06 起不再有「模型 ID / 接入点」两种模式，只有一份可自建的备用列表。
   */
  const effectiveModel = getEffectiveModel(config)
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
  /** 本次识别刚写入的字段：亮 5 秒绿框，方便一眼看出改了哪些格子 */
  const [flash, setFlash] = useState<{ rowId: string; keys: string[] } | null>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    },
    [],
  )
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
  /**
   * 板块配置是否已经从主进程存档读过。
   * 🔴 没读过之前**绝不回写**：否则会拿初始化时的默认值（["douyin"] / {}）
   * 把存档覆盖掉 —— 这正是「板块被删了」「抖音变回抖音小店」的成因（2026-11-07）。
   */
  const sectionsLoadedRef = useRef(false)

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
  /** 「规则同步」：当前展开勾选区的板块 + 每个板块勾选的来源 */
  const [syncOpenFor, setSyncOpenFor] = useState('')
  const [syncSources, setSyncSources] = useState<Record<string, string[]>>({})
  /** 板块切换条：'' = 全部板块（原样纵向全览），否则只显示选中的那个板块 */
  const [activeSection, setActiveSection] = useState('')
  /** 「全部板块」视图下，鼠标最后停留的板块卡片（全局粘贴时用来判断目标板块） */
  const hoveredSectionRef = useRef('')
  /** 选中的板块被删掉时回到「全部板块」，避免页面空白 */
  useEffect(() => {
    if (activeSection && !sectionPlatforms.includes(activeSection)) setActiveSection('')
  }, [sectionPlatforms, activeSection])
  /**
   * 切换板块时把「当前选中行」也切过去。
   * 以前 activeRowId 一直停在第一个板块，导致切到快手后：蓝圈不在、识别结果写错行、
   * 粘贴截图也进了抖音（用户 2026-11-08）。
   */
  useEffect(() => {
    if (!activeSection) return
    const sectionRows = rows.filter(r => (r.platform as string) === activeSection)
    if (sectionRows.length === 0) return
    if (sectionRows.some(r => r.id === activeRowId)) return
    setActiveRowId(sectionRows[0].id)
  }, [activeSection, rows, activeRowId])

  /** 添加当前板块自己的规则（第一次改动会自动从通用规则复制一份出来） */
  const addSectionNote = useCallback(
    (key: string) => {
      const text = (noteDraft[key] ?? '').trim()
      if (!text) return
      setSectionNotes(prev => {
        const base = ownNotes(prev, key)
        const list = base[key] ?? []
        if (list.includes(text)) {
          toast.error('这条已经记住了')
          return prev
        }
        const next = { ...base, [key]: [...list, text] }
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
        const base = ownNotes(prev, key)
        const list = (base[key] ?? []).filter((_, i) => i !== index)
        const next = { ...base, [key]: list }
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
        const base = ownNotes(prev, key)
        const list = [...(base[key] ?? [])]
        if (index < 0 || index >= list.length) return prev
        list[index] = text
        const next = { ...base, [key]: list }
        persistNotes(next)
        return next
      })
    },
    [persistNotes],
  )

  /** 把勾选来源（其它板块 / 通用规则）合并到当前板块，去重、不覆盖已有 */
  const syncSectionNotes = useCallback(
    (target: string) => {
      const picked = (syncSources[target] ?? []).filter(k => k !== target)
      const list = [...notesFor(sectionNotes, target)]
      let added = 0
      for (const src of picked) {
        for (const rule of notesFor(sectionNotes, src)) {
          if (rule.trim() && !list.includes(rule)) {
            list.push(rule)
            added++
          }
        }
      }
      if (added === 0) {
        toast.error('没有新规则可同步（勾选的规则都已存在）')
        return
      }
      const next = { ...sectionNotes, [target]: list }
      setSectionNotes(next)
      persistNotes(next)
      toast.success(`已同步 ${added} 条规则到本板块`)
      setSyncOpenFor('')
    },
    [syncSources, sectionNotes, persistNotes, toast],
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
   * 板块配置一有变化就**双写**：
   * - localStorage：配置迁移（导出/导入）还在读它，也当兜底镜像；
   * - 主进程 JSON：真正防丢的那一份，强退 / 自动更新 / 覆盖安装都不会回退。
   * 加载完成前不写，避免默认值覆盖存档。
   */
  useEffect(() => {
    if (!sectionsLoadedRef.current) return
    try {
      localStorage.setItem('data-entry-sections', JSON.stringify(sectionPlatforms))
      localStorage.setItem('data-entry-section-names', JSON.stringify(sectionNames))
    } catch {
      // 存不进去不影响使用
    }
    void window.ipcRenderer
      .invoke(IPC_CHANNELS.dataEntry.saveSections, {
        sections: sectionPlatforms,
        names: sectionNames,
      })
      .catch(() => {})
  }, [sectionPlatforms, sectionNames])

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

  /** 上一次自动填入的定值：用来区分「用户手改过」和「规则带来的值」 */
  const lastFixedValuesRef = useRef<Record<string, string>>({})
  /**
   * 「规则固定」智能型：有定值就直接带进格子，不依赖识别、也不改任何配置。
   * 只在格子为空时填，用户手改过的一律保留；仅当规则里的定值变了、
   * 且当前值仍等于上次自动填的旧值时，才跟着更新。
   */
  useEffect(() => {
    if (rows.length === 0) return
    const fixedBySection = new Map<string, Record<string, string>>()
    for (const row of rows) {
      const pf = String(row.platform ?? '')
      if (!fixedBySection.has(pf)) {
        fixedBySection.set(pf, parseFixedValues(notesFor(sectionNotes, pf), columns))
      }
    }
    lastFixedValuesRef.current = Object.fromEntries(
      [...fixedBySection.values()].flatMap(v => Object.entries(v)),
    )
    setRows(prevRows => {
      let any = false
      const next = prevRows.map(row => {
        const vals = { ...row.values }
        let touched = false
        const fixedValues = fixedBySection.get(String(row.platform ?? '')) ?? {}
        const prev = lastFixedValuesRef.current
        for (const c of columns) {
          if (c.platform !== row.platform || c.source !== 'fixed') continue
          const want = fixedValues[c.key]
          if (!want) continue
          const cur = String(vals[c.key] ?? '')
          if (!cur || (prev[c.key] && cur === prev[c.key] && cur !== want)) {
            vals[c.key] = want
            touched = true
          }
        }
        if (touched) any = true
        return touched ? { ...row, values: vals } : row
      })
      return any ? next : prevRows
    })
  }, [columns, sectionNotes, rows])

  /** 一键清空某个板块这一行的全部字段值（截图不动） */
  const clearSectionValues = useCallback(
    (platform: string) => {
      setRows(prev =>
        prev.map(r =>
          (r.platform as string) === platform
            ? { ...r, values: buildDefaultValues(columns.filter(c => c.platform === platform)) }
            : r,
        ),
      )
      toast.success(`已清空「${sectionLabel(platform)}」这一行`)
    },
    [columns, sectionLabel, toast],
  )

  /**
   * 每个板块至少要有一行：识别结果要写进「当前选中行」，没有行就没地方写。
   * 以前靠「新增一行」按钮手点（用户嫌多余，2026-11-06 删掉了），那就自动补：
   * 板块一出现（新增板块 / 导入字段 / 恢复默认）就给它建一行。
   */
  useEffect(() => {
    if (!loadedRef.current || sectionPlatforms.length === 0) return
    setRows(prev => {
      const have = new Set(prev.map(r => r.platform as string))
      const missing = sectionPlatforms.filter(pf => !have.has(pf))
      if (missing.length === 0) return prev
      const adds = missing.map(pf =>
        createRow(
          columns.filter(c => (c.platform as string) === pf),
          pf as LiveControlPlatform,
        ),
      )
      return [...prev, ...adds]
    })
  }, [sectionPlatforms, columns])

  /**
   * 每个板块**有且只有一行**：存档里早先点「新增一行」留下的空行要清掉。
   * 注意必须等存档异步载入之后再跑，否则跑在默认状态上等于没跑（用户 2026-11-06 反馈「还在」）。
   * 同一板块有多行时，保留「填得最多」的那一条，绝不丢数据。
   */
  useEffect(() => {
    if (!loadedRef.current || rows.length === 0) return
    setRows(prev => {
      const bySection = new Map<string, DataRow>()
      const filled = (row: DataRow) =>
        Object.values(row.values).filter(v => String(v ?? '').trim() !== '').length
      for (const row of prev) {
        const key = String(row.platform ?? '')
        const existing = bySection.get(key)
        if (!existing || filled(row) > filled(existing)) bySection.set(key, row)
      }
      const kept = [...bySection.values()]
      return kept.length === prev.length && kept.every((r, i) => r === prev[i]) ? prev : kept
    })
  }, [rows])

  /** 当前选中行失效（被删 / 换板块 / 刚补了行）时自动选第一行，否则识别没地方写 */
  useEffect(() => {
    if (rows.length === 0) return
    if (rows.some(r => r.id === activeRowId)) return
    setActiveRowId(rows[0].id)
  }, [rows, activeRowId])

  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)
  // 初始加载完成前，禁止自动保存覆盖已存档数据
  const loadedRef = useRef(false)

  // 进入页面：从本地读取用户保存的列定义（缺省回退默认），并恢复已填的表单数据
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      /**
       * 板块列表 / 板块名：**以主进程存档为准**，再和 localStorage 镜像取并集。
       * 取并集而不是覆盖，是为了「任何一边有、另一边丢了」都能救回来，绝不删板块。
       */
      try {
        const saved = (await window.ipcRenderer.invoke(
          IPC_CHANNELS.dataEntry.getSections,
        )) as DataEntrySectionsState | null
        if (cancelled) return
        const fromDisk = normalizeSectionsState(saved)
        let fromLocal: DataEntrySectionsState = { sections: [], names: {} }
        try {
          fromLocal = normalizeSectionsState({
            sections: JSON.parse(localStorage.getItem('data-entry-sections') || 'null') ?? [],
            names: JSON.parse(localStorage.getItem('data-entry-section-names') || 'null') ?? {},
          })
        } catch {
          // 本地镜像坏了就用存档里的
        }
        const merged = mergeSectionsState(fromDisk, fromLocal)
        const nextSections = merged.sections.length > 0 ? merged.sections : [TABLE_PLATFORM]
        setSectionPlatforms(nextSections)
        setSectionNames(merged.names)
        // 合一之后立刻回写一份，两边从此保持一致（存档文件不存在时也就此建立）
        void window.ipcRenderer
          .invoke(IPC_CHANNELS.dataEntry.saveSections, {
            sections: nextSections,
            names: merged.names,
          })
          .catch(() => {})
        try {
          localStorage.setItem('data-entry-sections', JSON.stringify(nextSections))
          localStorage.setItem('data-entry-section-names', JSON.stringify(merged.names))
        } catch {
          // 忽略
        }
      } catch {
        // 读不到存档就沿用 localStorage 里的值
      }
      sectionsLoadedRef.current = true

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
  }, [TABLE_PLATFORM])

  // 首次进入：把闲置的视觉配置默认指向智谱 glm-4v-plus
  useEffect(() => {
    if (config.provider === 'deepseek') {
      setConfig({ provider: 'zhipu', model: 'glm-4v-plus' })
    }
  }, [config.provider, setConfig])

  const apiKey = apiKeys[config.provider] ?? ''
  /** 视觉模型配置默认收起，只显示摘要；没填过 Key 时自动展开一次 */
  const [visionConfigOpen, setVisionConfigOpen] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在首次挂载时判断一次，之后由用户手动开合
  useEffect(() => {
    if (!apiKey) setVisionConfigOpen(true)
  }, [])

  const providerOptions = useMemo(() => Object.entries(providers), [])
  const _modelOptions = providers[config.provider]?.models ?? []

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

  /**
   * 支持从剪贴板粘贴截图（macOS 截屏后 Cmd+V / Windows Ctrl+V）。
   *
   * 🔴 目标板块必须取「用户正在看的那个板块」，不能用 activeRow.platform：
   * 切换板块时 activeRowId 不会跟着变，会一直指向第一个板块（抖音），
   * 于是「在快手模块粘贴，图却进了抖音」（用户 2026-11-08 报的 bug）。
   * 优先级：切换条选中的板块 → 焦点所在卡片 → 鼠标最后停留的卡片 → 当前选中行。
   */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      const focusedCard = (document.activeElement as HTMLElement | null)?.closest?.(
        '[data-section-key]',
      ) as HTMLElement | null
      const target = (activeSection ||
        focusedCard?.dataset.sectionKey ||
        hoveredSectionRef.current ||
        String(activeRow?.platform ?? 'douyin')) as LiveControlPlatform
      let hasImage = false
      Array.from(items).forEach(item => {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            hasImage = true
            addImageFromFile(file, target)
          }
        }
      })
      if (hasImage) e.preventDefault()
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addImageFromFile, activeRow?.platform, activeSection])

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
      // 「规则固定」智能型：规则里写了定值的字段不发给 AI（后面直接填值）；
      // 只有格式说明 / 没写规则的，仍按普通视觉识别让 AI 读图、再由规则修正。
      const activeNotes = notesFor(sectionNotes, platform)
      const fixedValues = parseFixedValues(activeNotes, platformColumns)
      const columnsForAI = platformColumns.map(c =>
        c.source === 'fixed' && !fixedValues[c.key] ? { ...c, source: 'vision' as const } : c,
      )
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
      if (!effectiveModel.trim()) {
        toast.error('请先填写模型（模型 ID 或方舟接入点 ep-xxxxxxxx）')
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
            model: effectiveModel,
            apiKey,
            customBaseURL: config.provider === 'custom' ? customBaseURL : undefined,
          },
          columns: columnsForAI,
          runId, // 暂停时按这个 id 找到本次任务
          // 空规则（刚点「添加一条」还没写）不发给模型
          extraInstructions: activeNotes.map(n => n.trim()).filter(Boolean),
        })
        // 这次识别真正写进来的字段（非空、且与旧值不同）→ 高光 5 秒。
        // 之前只有「低置信度」黄框，识别干净时一个提示都没有，用户看不出改了哪些格子。
        if (targetRow) {
          const oldValues = targetRow.values
          const writtenKeys = Object.entries(result.values as Record<string, string>)
            .filter(([k, v]) => {
              const text = String(v ?? '').trim()
              return text !== '' && text !== String(oldValues[k] ?? '').trim()
            })
            .map(([k]) => k)
          if (result.values?.weekLabel && !writtenKeys.includes('weekLabel')) {
            writtenKeys.push('weekLabel')
          }
          if (writtenKeys.length > 0) {
            setFlash({ rowId: targetRow.id, keys: writtenKeys })
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
            flashTimerRef.current = setTimeout(() => setFlash(null), 5000)
          }
        }
        // 合并到当前活跃行
        setRows(prev =>
          prev.map(r => {
            if (r.id !== targetRow?.id) return r
            const merged = { ...r.values, ...result.values }
            // 有定值的「规则固定」字段被排除识别，这里补一次；只填空、不覆盖手改
            for (const [k, v] of Object.entries(fixedValues)) {
              if (!String(merged[k] ?? '').trim()) merged[k] = v
            }
            // 先按列单位归一化（万 / 百分比 / 小时），再按「小数位」四舍五入
            // —— 识别出来是「9700」（个）而表格要「0.97」（万）时，这一步自动换算
            for (const c of platformColumns) {
              if (merged[c.key] === undefined) continue
              merged[c.key] = convertColumnValue(c, merged[c.key])
              if (c.decimals !== undefined) merged[c.key] = roundByColumn(merged[c.key], c)
            }
            // 时间列补成「开始-结束」时间段
            composeTimeRange(merged)
            // 识别到日期时，自动补「周标签」
            const recognizedWeek = merged.date ? weekdayLabel(merged.date) : null
            if (recognizedWeek) merged.weekLabel = recognizedWeek
            // 重算派生列
            Object.assign(merged, computeDerivedValues(merged, platformColumns))
            // 识别 / 规则固定 / 自动算出来的值统一补显示后缀（如 %）
            applyColumnSuffixes(merged, platformColumns)
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
      effectiveModel,
      customBaseURL,
      toast,
      activeRowId,
      rows,
      columns,
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
   * 把指定的录入行归档进「软件内的日报总表」。
   * 只做 upsert（按 日期 + 板块 + 场次 去重），**绝不删记录** ——
   * 总表格子里用户可以直接改值并自动存，整表替换会把这些手改冲掉。
   */
  const archiveRowsToLedger = useCallback(
    async (targetRows: DataRow[]): Promise<number> => {
      const now = Date.now()
      const records: LedgerRecord[] = targetRows
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
      if (records.length === 0) return 0
      const all = (await window.ipcRenderer.invoke(
        IPC_CHANNELS.dataEntry.upsertLedger,
        records,
      )) as LedgerRecord[]
      setLedger(all ?? [])
      return records.length
    },
    [sectionLabel],
  )

  /** 板块底部「同步到总表」：只把**这个板块**的数据写进软件内总表，绝不碰外部 Excel */
  const [archiving, setArchiving] = useState('')
  const syncSectionToLedger = useCallback(
    async (pf: string) => {
      const sectionRows = rows.filter(r => (r.platform as string) === pf)
      if (sectionRows.length === 0) {
        toast.error('这个板块还没有数据行')
        return
      }
      setArchiving(pf)
      try {
        const count = await archiveRowsToLedger(sectionRows)
        toast.success(
          count > 0
            ? `已把「${sectionLabel(pf)}」的 ${count} 行同步到软件内日报总表（不改动外部 Excel 文件）`
            : '这个板块还没填内容，没有可同步的数据',
        )
      } catch (error) {
        toast.error(`同步失败：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        setArchiving('')
      }
    },
    [rows, archiveRowsToLedger, sectionLabel, toast],
  )

  /**
   * 🔴 这里**故意没有「自动归档」effect**（用户 2026-11-08 报的 bug）：
   * 以前每次识别 / 手填 / 改格子后防抖 1.2s 就自动 upsert 进总表，
   * 导致「没点『同步到总表』按钮，软件内总表也变了」，按钮形同虚设。
   * 现在软件内总表**只由板块底部的按钮写入**（syncSectionToLedger），
   * 外部 Excel 只由总表页顶部按钮写入。两条都是手动、都可预期。
   * 注意：删掉自动归档后，录入页改完但没点同步时，总表保持原样 —— 这正是用户要的。
   */

  // ── 总表：按板块分组，一个板块一张表 ──
  /**
   * 页面上也不再把各板块挤成一张宽表（用户 2026-11-07：「各个板块的表格不能放一起，
   * 后面字段肯定有不一样的地方」）。以前表头取字段并集，别的板块的列会混进来、一半格子空着。
   * 现在每个板块用自己的列 + 自己的行，单独渲染一张表；导出的 xlsx 本来就是分工作表的，两边一致。
   */
  const ledgerGroups = useMemo(() => {
    const keys = ledgerFilter
      ? [ledgerFilter]
      : [...new Set(ledger.map(r => String(r.sectionKey ?? '')))].filter(Boolean)
    return keys
      .map(key => ({
        key,
        name: sectionLabel(key),
        columns: buildLedgerColumns(columns.filter(c => String(c.platform ?? '') === key)),
        rows: sortLedgerDesc(ledger.filter(r => r.sectionKey === key)),
      }))
      .filter(group => group.rows.length > 0)
  }, [ledger, columns, ledgerFilter, sectionLabel])

  /**
   * 导出 / 实时同步用的数据：**一个板块一张表**。
   * 各平台字段完全不一样（抖音 53 列、小红书又是另一套），挤成一张表只能取并集、
   * 一半列全是空的，所以按板块分开，每个工作表只放这个板块自己的字段
   * （用户 2026-11-06：「分板块这个表，各个平台字段肯定不一样，没办法放一张表里」）。
   */
  const ledgerExportPayload = useMemo(() => {
    // 板块 key → 这个板块自己的字段（保持用户在「管理列」里定的顺序）
    const columnsBySection = new Map<string, LiveReportColumn[]>()
    for (const c of columns) {
      const key = String(c.platform ?? '')
      if (!key) continue
      const list = columnsBySection.get(key)
      if (list) list.push(c)
      else columnsBySection.set(key, [c])
    }
    // 板块 key → 行
    const rowsBySection = new Map<string, Record<string, string>[]>()
    for (const r of sortLedgerDesc(ledger)) {
      const list = rowsBySection.get(r.sectionKey)
      if (list) list.push({ ...r.values })
      else rowsBySection.set(r.sectionKey, [{ ...r.values }])
    }
    const sheets = [...columnsBySection.entries()]
      .map(([key, cols]) => ({
        name: sectionLabel(key),
        columns: cols,
        rows: rowsBySection.get(key) ?? [],
      }))
      // 只要配了字段就建工作表：新建板块暂时没数据时，也先放好表头，
      // 用户点一次同步就能看到新工作表，不用自己手工新建（用户 2026-11-07）
      .filter(sheet => sheet.columns.some(c => String(c.label ?? '').trim() !== ''))
    return {
      sheets,
      totalRows: sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0),
    }
  }, [ledger, columns, sectionLabel])

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
    if (ledgerExportPayload.sheets.length === 0) {
      toast.error('还没有配置任何板块字段，先去「管理列」添加')
      return
    }
    const outputPath = await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.selectOutputPath)
    if (!outputPath) return
    try {
      await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.exportLedger, {
        sheets: ledgerExportPayload.sheets,
        outputPath,
      })
      toast.success(
        `已导出 ${ledgerExportPayload.sheets.length} 个板块（共 ${ledgerExportPayload.totalRows} 行）到 ${outputPath}`,
      )
    } catch (error) {
      toast.error(`导出失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [ledgerExportPayload, toast])

  /**
   * 把软件内总表写进外部 .xlsx —— **只有「日报总表」页顶部的同步按钮会走到这里**。
   * 用户 2026-11-08：板块底部的按钮改成只归档软件内总表，外部文件一律只从总表页同步。
   */
  const writeLedgerSync = useCallback(
    async (outputPath: string) => {
      if (!outputPath) return
      const sheets = ledgerExportPayload.sheets
      // 还没配字段时不要碰文件，避免把已有内容冲掉
      if (sheets.length === 0) return
      setSyncing(true)
      try {
        await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.syncLedgerXlsx, {
          sheets,
          outputPath,
          incremental: true,
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

  /** 把整张总表写进外部 Excel；只在「日报总表」页顶部按钮调用 */
  const handleSyncNow = useCallback(async () => {
    if (!ledgerSync.filePath) {
      await handleStartLedgerSync()
      return
    }
    const sheets = ledgerExportPayload.sheets
    if (sheets.length === 0) {
      toast.error('还没有配置任何板块字段，先去「管理列」添加')
      return
    }
    await writeLedgerSync(ledgerSync.filePath)
    toast.success(
      `已同步 ${sheets.length} 个板块（共 ${sheets.reduce((n, s) => n + s.rows.length, 0)} 行）→ ${ledgerSync.filePath}`,
    )
  }, [ledgerSync.filePath, writeLedgerSync, handleStartLedgerSync, ledgerExportPayload, toast])

  /**
   * 外部 Excel 没有「自动同步定时器」：写文件只发生在
   * ①「日报总表」页顶部的同步按钮 ② 第一次点「实时同步到表格」选完文件那一次。
   * 之前这里写着「已挪到主进程 LedgerAutoSyncService，总表一变就写」——
   * 那是过时注释，主进程并不存在这个服务，已改正（2026-11-08）。
   */

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
          // 改了基础列时即时重算派生列（只给重算出来的列补后缀，
          // 不碰用户正在输入的那个格子，否则每敲一个字符都会被补 %）
          if (COMPUTED_DEPENDENCY_KEYS.includes(key)) {
            const derived = computeDerivedValues(next, columns)
            for (const [k, v] of Object.entries(derived)) {
              const col = columns.find(c => c.key === k)
              next[k] = col ? withColumnSuffix(col, v) : v
            }
          }
          // 人手动改过这个格子 = 已确认，去掉低置信度橙框
          const lowConfidence = (r.lowConfidence ?? []).filter(k => k !== key)
          return { ...r, values: next, lowConfidence }
        }),
      )
    },
    [columns],
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

  /** 新建板块：key 与平台解耦；建好直接切过去，方便马上改名 / 导入字段 */
  const addSection = useCallback(() => {
    const key = `custom-${Date.now().toString(36)}`
    setSectionPlatforms(prev => [...prev, key])
    setSectionNames(prev => {
      const next = { ...prev, [key]: `新板块 ${Object.keys(prev).length + 1}` }
      try {
        localStorage.setItem('data-entry-section-names', JSON.stringify(next))
      } catch {
        // 隐私模式写不进去就算了
      }
      return next
    })
    setActiveSection(key)
    toast.success('已新建板块，点标题可以改名')
  }, [toast])

  /** 导出该平台的行（只用该平台自己的列） */

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

      {/* 板块切换条：和「自动回复设置」的分组条同一种语言；默认「全部板块」保持原样，
          点某个板块就只看那一个，板块增删/改名时自动跟着变（用户 2026-11-07） */}
      {view === 'entry' && sectionPlatforms.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b pb-2">
          <button
            type="button"
            onClick={() => setActiveSection('')}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              activeSection === ''
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            全部板块
          </button>
          {sectionPlatforms.map(pf => (
            <button
              key={pf}
              type="button"
              onClick={() => setActiveSection(pf)}
              className={cn(
                'max-w-[180px] truncate rounded-md px-3 py-1.5 text-sm transition-colors',
                activeSection === pf
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
              title={sectionLabel(pf)}
            >
              {sectionLabel(pf)}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-muted-foreground">
            {activeSection ? '只看当前板块' : '显示所有板块'} · 共 {sectionPlatforms.length} 个
          </span>
          <button
            type="button"
            onClick={addSection}
            title="新建板块（建好后点标题改名，再到「管理列 → 导入字段」复制模板）"
            className="flex shrink-0 items-center gap-1 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <Plus className="h-3 w-3" /> 新建板块
          </button>
        </div>
      )}
      {view === 'entry' && sectionPlatforms.length > 0 && (
        <p className="-mt-1 text-[11px] text-muted-foreground/80">
          新建后点标题改名，再点「管理列 → 导入字段」从其它板块复制模板
        </p>
      )}

      {/* 按平台分板块：每个板块自带「截图识别 + 数据行」，板块与当前账号无关 */}
      {view === 'entry' &&
        sectionPlatforms.map(pf => {
          if (activeSection && activeSection !== pf) return null
          // 当前板块实际生效的规则（没有自己的一套时继承通用规则）
          const activeNotes = notesFor(sectionNotes, pf)
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
            <Card
              key={pf}
              data-section-key={pf}
              onMouseEnter={() => {
                hoveredSectionRef.current = pf
              }}
            >
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
                {/* 调教区：所有「怎么填」的规则都直接写在这里，随时可改可加可删。
                    用多行文本框而不是单行 input —— 长中文规则在单行里会被横向截断（用户 2026-11-06 反馈「好多规则看不到」）。 */}
                <div className="rounded-lg border bg-muted/30 px-2.5 py-2">
                  {/* 第一行：图标 / 标题 / 输入框 / 按钮 统一 items-center 垂直居中对齐 */}
                  <div className="flex items-center gap-2">
                    <MessageSquarePlus className="w-3.5 h-3.5 shrink-0 text-primary" />
                    <span className="shrink-0 text-[12px] font-medium text-muted-foreground">
                      填写规则
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground/70">
                        {sectionNotes[pf] === undefined ? '继承通用规则' : '本板块独立'} ·{' '}
                        {activeNotes.length} 条
                      </span>
                    </span>
                    <RuleComposer
                      value={noteDraft[pf] ?? ''}
                      onChange={v => setNoteDraft(prev => ({ ...prev, [pf]: v }))}
                      onSubmit={() => addSectionNote(pf)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2 text-[11px]"
                      onClick={() => addSectionNote(pf)}
                      disabled={!(noteDraft[pf] ?? '').trim()}
                    >
                      <Send className="w-3 h-3 mr-1" />
                      添加规则
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 px-2 text-[11px]"
                      onClick={() => setSyncOpenFor(prev => (prev === pf ? '' : pf))}
                      title="从其它板块勾选规则，合并到本板块"
                    >
                      <Copy className="w-3 h-3 mr-1" />
                      规则同步
                    </Button>
                  </div>

                  {/* 规则同步：勾选其它板块 / 通用规则，合并到本板块（去重、不覆盖已有） */}
                  {syncOpenFor === pf && (
                    <div className="mt-1.5 rounded-md border bg-background/70 px-2 py-1.5">
                      <p className="mb-1 text-[10px] text-muted-foreground">
                        勾选来源，把它们的规则合并到本板块（自动去重，不改已有规则）
                      </p>
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {[
                          { key: '__all__', name: '通用规则' },
                          ...sectionPlatforms
                            .filter(p => p !== pf)
                            .map(p => ({ key: p, name: sectionLabel(p) })),
                        ].map(src => (
                          <label key={src.key} className="flex items-center gap-1 text-[11px]">
                            <input
                              type="checkbox"
                              className="h-3 w-3 cursor-pointer accent-primary"
                              checked={(syncSources[pf] ?? []).includes(src.key)}
                              onChange={e =>
                                setSyncSources(prev => {
                                  const cur = prev[pf] ?? []
                                  return {
                                    ...prev,
                                    [pf]: e.target.checked
                                      ? [...cur, src.key]
                                      : cur.filter(k => k !== src.key),
                                  }
                                })
                              }
                            />
                            {src.name}（{notesFor(sectionNotes, src.key).length} 条）
                          </label>
                        ))}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <Button
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => syncSectionNotes(pf)}
                          disabled={(syncSources[pf] ?? []).length === 0}
                        >
                          <Copy className="w-3 h-3 mr-1" />
                          同步选中
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => setSyncOpenFor('')}
                        >
                          取消
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* 规则列表：一条一行、随内容长高。常用模板、「已写 N 条」提示、
                      底部重复的「添加一条」都已按用户要求删掉；空规则不会发给模型。
                      高度封顶约 4 行（104px），规则再多就在这里上下滑动，不把页面顶长 */}
                  {activeNotes.length > 0 && (
                    <div className="rule-scroll mt-1 max-h-[104px] space-y-0.5 overflow-y-auto overscroll-contain pr-1">
                      {activeNotes.map((note, i) => (
                        <div
                          // biome-ignore lint/suspicious/noArrayIndexKey: 规则是纯文本列表，允许重复文本、顺序固定
                          key={`${pf}-note-${i}`}
                          className="group flex items-start gap-1.5 rounded bg-background/70 px-1.5 py-0.5"
                        >
                          <span className="mt-1 shrink-0 rounded bg-primary/15 px-1 text-[10px] font-medium leading-4 text-primary">
                            {i + 1}
                          </span>
                          <RuleTextarea value={note} onChange={v => updateSectionNote(pf, i, v)} />
                          <button
                            type="button"
                            onClick={() => removeSectionNote(pf, i)}
                            className="mt-1 shrink-0 rounded p-0.5 text-muted-foreground opacity-60 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                            title="删掉这条规则"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
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

                {/* 表格上方的操作条：管理列 / 新增一行（2026-11-06 用户要求从标题栏挪到表格上面） */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    {pfRows.length > 0 ? `共 ${pfRows.length} 行` : '还没有数据行'}
                  </span>
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
                  </div>
                </div>

                {pfRows.length === 0 ? (
                  <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                    拖入截图识别后会自动生成这一行
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {pfRows.map(row => (
                      <RowCard
                        key={row.id}
                        row={row}
                        isActive={row.id === activeRowId}
                        columns={pfColumns}
                        onUpdateValues={updateCellValue}
                        flashKeys={flash?.rowId === row.id ? flash.keys : []}
                      />
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 border-t pt-3">
                  {/*
                    用户 2026-11-08：这个按钮只把**本板块**的数据归档到软件内的
                    「日报总表」，不写外部 Excel。外部文件只从总表页顶部按钮同步。
                  */}
                  <Button
                    size="sm"
                    onClick={() => syncSectionToLedger(pf)}
                    disabled={archiving === pf}
                    title="只把本板块的数据同步到软件内的「日报总表」，不改动电脑上的 Excel 文件；外部表格请到「日报总表」页点同步"
                  >
                    <Table className="w-4 h-4 mr-1" />
                    {archiving === pf ? '同步中…' : '同步到总表'}
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
                  <span className="flex-1" />
                  {/* 一键清空本板块这一行的所有数据（用户 2026-11-06 要的） */}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      if (!window.confirm(`清空「${sectionLabel(pf)}」这一行的全部数据？`)) return
                      clearSectionValues(pf)
                    }}
                    title="把这一行的字段值全部清空（截图不受影响）"
                  >
                    <Trash2 className="w-4 h-4 mr-1" /> 一键清空
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}

      {/* ── 总表：所有板块、所有日期的数据都在这一张表里 ── */}
      {view === 'ledger' && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">日报总表</CardTitle>
                <CardDescription className="text-xs">
                  共 {ledger.length} 条记录 · 格子里可以直接改，改完自动存
                  <span className="block text-[11px] text-muted-foreground/80">
                    录入页的数据<b>只有点了板块底部的「同步到总表」才会写进这里</b>； 同一场按「日期
                    + 板块 + 场次」去重，各板块只用自己的字段
                  </span>
                  <span className="block text-[11px] text-muted-foreground/80">
                    <b>外部 Excel 只在下面这个按钮同步</b>
                    {ledgerSync.enabled
                      ? `（每个板块一张工作表，目标：${syncFileName}，由软件覆盖写入，别在里面改）`
                      : ''}
                  </span>
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
                <Button
                  size="sm"
                  onClick={handleExportLedger}
                  disabled={ledgerExportPayload.sheets.length === 0}
                >
                  <Table className="w-4 h-4 mr-1" />
                  导出（{ledgerExportPayload.totalRows} 行 · {ledgerExportPayload.sheets.length}{' '}
                  张工作表）
                </Button>
                {/* 外部 .xlsx 的唯一写入口：点一次写一次（板块里的按钮不写文件） */}
                {ledgerSync.enabled ? (
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleSyncNow()}
                      disabled={syncing}
                      title={`${ledgerSync.filePath}\n${
                        lastSyncedAt
                          ? `上次同步 ${new Date(lastSyncedAt).toLocaleTimeString()}`
                          : ''
                      }`}
                    >
                      <FileSpreadsheet className="w-4 h-4 mr-1" />
                      {syncing ? '同步中…' : `同步到表格 · ${syncFileName}`}
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
          <CardContent className="space-y-4">
            {ledgerGroups.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
                总表还是空的：去「分板块录入」里识别或填写数据，有内容的行会自动汇总到这里
              </p>
            ) : (
              ledgerGroups.map(group => (
                <div key={group.key}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <h3 className="text-xs font-semibold">{group.name}</h3>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      {group.rows.length} 行 · {group.columns.length} 列
                    </span>
                  </div>
                  <div className="overflow-auto rounded-md border" style={{ maxHeight: 420 }}>
                    <table className="w-max border-collapse text-[11px]">
                      <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur">
                        <tr>
                          {/* 每个板块只渲染自己的字段；板块名已在上方标题里，不再占一列 */}
                          {group.columns.map(c => (
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
                        {group.rows.map(r => (
                          <tr key={r.id} className="hover:bg-muted/40">
                            {group.columns.map(c => (
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
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {/* 视觉模型配置：默认收成一条摘要（左边配置按钮，右边提供商/模型），
          点「配置 API Key」才展开完整表单（用户 2026-11-06 要的样式） */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => setVisionConfigOpen(v => !v)}
            title={visionConfigOpen ? '收起配置' : '展开服务商 / 模型 / API Key 配置'}
          >
            <Settings2 className="w-3.5 h-3.5 mr-1.5" />
            配置 API Key
            {visionConfigOpen ? (
              <ChevronUp className="w-3.5 h-3.5 ml-1.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 ml-1.5" />
            )}
          </Button>
          <div className="flex min-w-0 items-center gap-2 text-[11px]">
            <span className="shrink-0 rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground">
              提供商：{providers[config.provider]?.name ?? config.provider}
            </span>
            <span
              className="max-w-[280px] truncate rounded-md border px-2 py-1 text-muted-foreground"
              title={config.model || '还没填模型'}
            >
              模型：{config.model || '未填'}
            </span>
            {!apiKey && (
              <span className="shrink-0 rounded-md bg-destructive/10 px-2 py-1 text-destructive">
                还没填 Key
              </span>
            )}
          </div>
        </div>
      </Card>

      {visionConfigOpen && (
        <VisionConfigModal
          provider={config.provider}
          model={config.model}
          apiKey={apiKey}
          customBaseURL={customBaseURL}
          providerOptions={providerOptions}
          onClose={() => setVisionConfigOpen(false)}
          onSave={next => {
            setConfig({ provider: next.provider, model: next.model })
            setApiKey(next.provider, next.apiKey)
            setCustomBaseURL(next.customBaseURL)
            setVisionConfigOpen(false)
            toast.success('已保存 API Key 配置')
          }}
        />
      )}

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
          platform={columnModalPlatform}
          allColumns={columns}
          labelOf={sectionLabel}
          onCancel={() => setColumnModalOpen(false)}
          onSave={handleSaveColumns}
        />
      )}
    </div>
  )
}
