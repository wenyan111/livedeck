import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import {
  LIVE_REPORT_COLUMNS,
  convertColumnValue,
  computeDerivedValues,
  COMPUTED_DEPENDENCY_KEYS,
  getDefaultColumns,
  generateColumnKey,
  type LiveReportColumn,
} from 'shared/liveReportColumns'
import type { DataEntrySavedState } from 'shared/dataEntryState'
import { providers } from 'shared/providers'
import { useAIProvider } from '@/hooks/useAIProvider'
import { useToast } from '@/hooks/useToast'
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
import { Table, Trash2, Plus, ChevronDown, ChevronUp, Settings2, MapPin } from 'lucide-react'

import type { VisionTemplate } from 'electron/main/services/VisionRecognizer'

interface LocalImage {
  id: string
  url: string
  name: string
}

interface DataRow {
  id: string
  values: Record<string, string>
  lowConfidence: string[]
}

/** 把已有行的数据按新列定义重新对齐：保留仍存在的列值，丢掉已删列，新增列置空，并重算派生列 */
function reconcileRows(rows: DataRow[], newColumns: LiveReportColumn[]): DataRow[] {
  return rows.map(r => {
    const next: Record<string, string> = {}
    for (const c of newColumns) next[c.key] = r.values[c.key] ?? ''
    Object.assign(next, computeDerivedValues(next, newColumns))
    return { ...r, values: next }
  })
}

function todayStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function buildDefaultValues(columns: LiveReportColumn[]): Record<string, string> {
  const v: Record<string, string> = {}
  for (const c of columns) v[c.key] = ''
  v.date = todayStr()
  v.session = '1'
  return v
}

function createRow(columns: LiveReportColumn[]): DataRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
        <div
          ref={containerRef}
          className="relative inline-block max-h-[70vh] overflow-hidden"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
        >
          <img ref={imgRef} src={image.url} alt={image.name} className="max-h-[70vh] max-w-[90vw]" />
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
  rowCount,
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
      map.get(c.group)!.push(c)
    }
    return Array.from(map.entries())
  }, [columns])

  // 行摘要：日期 + 主播 + 场次
  const summary = `${row.values.date || '未填日期'} · ${row.values.anchorName || '未填主播'} · 第${row.values.session || '?'}场`

  return (
    <div
      className={`border rounded-lg transition-colors ${
        isActive ? 'border-primary bg-primary/[0.02]' : 'border-border'
      }`}
    >
      {/* 行头：摘要 + 操作按钮 */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded(e => !e)}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSelect() }}
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs font-bold shrink-0 ${
            isActive ? 'border-primary bg-primary text-white' : 'border-muted-foreground/30 text-muted-foreground'
          }`}
        >
          {rowIndex + 1}
        </button>
        <span className="text-sm font-medium flex-1 truncate">{summary}</span>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          {Object.entries(row.values).filter(([k, v]) => v.trim() !== '' && columns.find(c => c.key === k)?.source === 'vision').length} 项已识别
        </span>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(row.id) }}
          className="text-destructive hover:text-destructive/80 p-1 rounded hover:bg-destructive/10"
          title="删除此行"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* 展开的字段网格 */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t pt-3">
          {groups.map(([group, cols]) => (
            <div key={group}>
              <h3 className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wider">{group}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
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
                  const placeholder = isManual
                    ? '（人工填写）'
                    : isSkip
                      ? '（留空）'
                      : isComputed
                        ? '（自动计算）'
                        : ''
                  return (
                    <div key={col.key} className="space-y-1">
                      <Label className="text-[11px] leading-tight">{col.label}</Label>
                      <Input
                        value={val}
                        onChange={e => onUpdateValues(row.id, col.key, e.target.value)}
                        className={`h-8 text-sm ${ring}`}
                        disabled={isSkip}
                        placeholder={placeholder}
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
  onCancel,
  onSave,
}: {
  columns: LiveReportColumn[]
  onCancel: () => void
  onSave: (cols: LiveReportColumn[]) => void
}) {
  const [draft, setDraft] = useState<LiveReportColumn[]>(() => columns.map(c => ({ ...c })))

  const update = (idx: number, patch: Partial<LiveReportColumn>) =>
    setDraft(prev => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  const remove = (idx: number) => setDraft(prev => prev.filter((_, i) => i !== idx))
  const add = () =>
    setDraft(prev => [
      ...prev,
      { key: generateColumnKey(prev), label: '新标签', unit: 'text', source: 'manual', group: '自定义' },
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
          <span className="text-xs text-muted-foreground">{draft.length} 列</span>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {/* 表头 */}
          <div className="grid grid-cols-[1fr_88px_104px_110px_36px] gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
            <span>标签名</span>
            <span>单位</span>
            <span>类型</span>
            <span>分组</span>
            <span></span>
          </div>
          {draft.map((col, idx) => (
            <div key={col.key} className="grid grid-cols-[1fr_88px_104px_110px_36px] gap-2 items-center">
              <Input
                value={col.label}
                onChange={e => update(idx, { label: e.target.value })}
                className="h-8 text-sm"
              />
              <Select value={col.unit} onValueChange={u => update(idx, { unit: u as LiveReportColumn['unit'] })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">无</SelectItem>
                  <SelectItem value="wan">万</SelectItem>
                  <SelectItem value="hour">小时</SelectItem>
                  <SelectItem value="percent">百分比</SelectItem>
                  <SelectItem value="text">文本</SelectItem>
                </SelectContent>
              </Select>
              <Select value={col.source} onValueChange={s => update(idx, { source: s as LiveReportColumn['source'] })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
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
                className="h-8 text-sm"
              />
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
            <Button onClick={() => onSave(draft)}>
              保存
            </Button>
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

  const [images, setImages] = useState<LocalImage[]>([])
  const [cropTarget, setCropTarget] = useState<LocalImage | null>(null)
  const [recognizing, setRecognizing] = useState(false)
  const [rows, setRows] = useState<DataRow[]>([createRow(LIVE_REPORT_COLUMNS)])
  const [activeRowId, setActiveRowId] = useState<string>(() => rows[0]?.id ?? '')
  const [columnModalOpen, setColumnModalOpen] = useState(false)
  const [columns, setColumns] = useState<LiveReportColumn[]>(LIVE_REPORT_COLUMNS)
  const [isDragging, setIsDragging] = useState(false)
  // 视觉模板
  const [template, setTemplate] = useState<{ id: string; name: string; fieldCount: number } | null>(null)
  const [calibrating, setCalibrating] = useState(false)
  const dragCounter = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
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
        safe = cols && cols.length > 0 ? cols : getDefaultColumns()
        setColumns(safe)
      } catch {
        if (!cancelled) setColumns(getDefaultColumns())
      }

      // 载入已保存的表单数据（防 app 重启丢失）
      let restored = false
      try {
        const saved = (await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.getRows)) as
          | DataEntrySavedState
          | null
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
  const activeRow = useMemo(() => rows.find(r => r.id === activeRowId) ?? rows[0], [rows, activeRowId])

  const addImageFromFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      setImages(prev => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          url: String(reader.result),
          name: file.name || `截图-${prev.length + 1}.png`,
        },
      ])
    }
    reader.readAsDataURL(file)
  }, [])

  const addImageFiles = useCallback(
    (files: FileList | File[]) => {
      Array.from(files).forEach(f => addImageFromFile(f))
    },
    [addImageFromFile],
  )

  const handleSelectFiles = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files) return
      addImageFiles(files)
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
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current = 0
      setIsDragging(false)
      const files = e.dataTransfer.files
      if (files && files.length > 0) {
        addImageFiles(files)
      }
    },
    [addImageFiles],
  )

  const removeImage = (id: string) => setImages(prev => prev.filter(i => i.id !== id))

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
            addImageFromFile(file)
          }
        }
      })
      if (hasImage) e.preventDefault()
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addImageFromFile])

  /** 识别 → 结果写入当前活跃行 */
  const handleRecognize = useCallback(async () => {
    if (images.length === 0) {
      toast.error('请先选择截图')
      return
    }
    if (!apiKey) {
      toast.error('请先在上方填写视觉模型 API Key')
      return
    }
    setRecognizing(true)
    try {
      const result = await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.recognize, {
        images: images.map(i => ({ base64: i.url })),
        config: {
          provider: config.provider,
          model: config.model,
          apiKey,
          customBaseURL: config.provider === 'custom' ? customBaseURL : undefined,
        },
        columns,
        templateId: template ? 'use-saved' : undefined, // 有模板时使用位置引导
      })
      // 合并到当前活跃行
      setRows(prev => prev.map(r => {
        if (r.id !== activeRowId) return r
        const merged = { ...r.values, ...result.values }
        // 重算派生列
        Object.assign(merged, computeDerivedValues(merged, columns))
        return { ...r, values: merged, lowConfidence: result.lowConfidence ?? [] }
      }))
      const filled = Object.keys(result.values).length
      toast.success(`识别完成，成功提取 ${filled} 项写入第 ${rows.findIndex(r => r.id === activeRowId) + 1} 行，请核对后导出`)
    } catch (error) {
      toast.error(`识别失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setRecognizing(false)
    }
  }, [images, apiKey, config.provider, config.model, customBaseURL, toast, activeRowId, rows, columns])

  /** 加载已保存的模板 */
  useEffect(() => {
    window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.getTemplate).then((tmpl: VisionTemplate | null) => {
      if (tmpl) setTemplate({ id: tmpl.id, name: tmpl.name, fieldCount: tmpl.fields.length })
    }).catch(() => {})
  }, [])

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

  /** 校准模板：用当前截图 + 当前行数据作为已知值 */
  const handleCalibrate = useCallback(async () => {
    if (images.length === 0) {
      toast.error('请先上传一张标准截图')
      return
    }
    if (!apiKey) {
      toast.error('请先填写视觉模型 API Key')
      return
    }
    // 用当前活跃行的非空数据作为已知值（至少需要几个有值的字段）
    const activeRow = rows.find(r => r.id === activeRowId)
    const knownValues: Record<string, string> = {}
    if (activeRow) {
      for (const [k, v] of Object.entries(activeRow.values)) {
        if (v && v.trim() !== '') knownValues[k] = v.trim()
      }
    }
    if (Object.keys(knownValues).length < 5) {
      toast.error(`校准需要至少 5 个已填写的字段作为参考，当前只有 ${Object.keys(knownValues).length} 个。请先手动填几个关键字段（如时间、观看人数、GMV 等）`)
      return
    }

    setCalibrating(true)
    try {
      const result = await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.calibrateTemplate, {
        image: { base64: images[0].url }, // 用第一张图作为标准截图
        config: {
          provider: config.provider,
          model: config.model,
          apiKey,
          customBaseURL: config.provider === 'custom' ? customBaseURL : undefined,
        },
        knownValues,
      })
      setTemplate({ id: result.id, name: result.name, fieldCount: result.fields.length })
      toast.success(`模板校准完成！定位了 ${result.fields.length} 个字段位置。以后识别会自动使用此模板，准确度大幅提升。`)
    } catch (error) {
      toast.error(`校准失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setCalibrating(false)
    }
  }, [images, apiKey, config.provider, config.model, customBaseURL, toast, rows, activeRowId])

  /** 删除模板 */
  const handleDeleteTemplate = useCallback(async () => {
    try {
      await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.deleteTemplate)
      setTemplate(null)
      toast.success('已删除视觉模板')
    } catch {
      toast.error('删除失败')
    }
  }, [toast])

  /** 更新某行的某个字段值 */
  const updateCellValue = useCallback((rowId: string, key: string, val: string) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r
      const next = { ...r.values, [key]: val }
      // 改了基础列时即时重算派生列
      if (COMPUTED_DEPENDENCY_KEYS.includes(key)) {
        Object.assign(next, computeDerivedValues(next, columns))
      }
      return { ...r, values: next }
    }))
  }, [columns])

  /** 新增一行 */
  const addRow = useCallback(() => {
    const newRow = createRow(columns)
    setRows(prev => [...prev, newRow])
    setActiveRowId(newRow.id)
  }, [columns])

  /** 删除一行 */
  const deleteRow = useCallback((rowId: string) => {
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
  }, [activeRowId, toast])

  /** 保存列管理结果：对齐行数据 + 落盘 */
  const handleSaveColumns = useCallback(async (newCols: LiveReportColumn[]) => {
    setRows(prev => reconcileRows(prev, newCols))
    setColumns(newCols)
    setColumnModalOpen(false)
    try {
      await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.saveColumns, newCols)
      toast.success(`列配置已保存（${newCols.length} 列），导出与识别已同步更新`)
    } catch (error) {
      toast.error(`保存列配置失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [toast])

  /** 导出全部行为 CSV */
  const handleExport = useCallback(async () => {
    const outputPath = await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.selectOutputPath)
    if (!outputPath) return
    try {
      const convertedRows = rows.map(row => {
        const converted: Record<string, string> = {}
        for (const c of columns) {
          converted[c.key] = convertColumnValue(c, row.values[c.key] ?? '')
        }
        return converted
      })
      const saved = await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.exportExcel, {
        rows: convertedRows,
        outputPath,
        columns,
      })
      toast.success(`已导出 ${rows.length} 行数据：${saved}`)
    } catch (error) {
      toast.error(`导出失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [rows, columns, toast])

  return (
    <div className="container py-8 space-y-6 max-w-6xl">
      <Title title="直播日报" description="下播后：拖入截图 → 视觉识别 → 核对 → 导出本地 CSV" />

      {/* 视觉模型配置 */}
      <Card>
        <CardHeader>
          <CardTitle>视觉识别模型</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>服务商</Label>
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
            <Label>模型</Label>
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
              <Input
                value={config.model}
                onChange={e => setConfig({ model: e.target.value })}
                placeholder="如 glm-4v-plus"
              />
            )}
          </div>

          <div className="space-y-2">
            <Label>API Key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(config.provider, e.target.value)}
              placeholder="粘贴你的视觉模型 API Key"
            />
          </div>

          {config.provider === 'custom' && (
            <div className="space-y-2">
              <Label>API 地址</Label>
              <Input
                value={customBaseURL}
                onChange={e => setCustomBaseURL(e.target.value)}
                placeholder="https://open.bigmodel.cn/api/paas/v4/"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* 截图区 */}
      <Card>
        <CardHeader>
          <CardTitle>直播数据截图</CardTitle>
          <CardDescription>
            可多选：整张大屏、复盘页、流量来源、商品、人群画像等。也可直接把图片
            <strong className="text-foreground"> 拖拽到下方区域</strong>，或{' '}
            <kbd className="px-1 py-0.5 rounded bg-muted text-xs">⌘/Ctrl + V</kbd>{' '}
            粘贴剪贴板里的截图；支持「框选裁剪」只识别某块区域。
            识别结果将写入当前选中的行（带蓝色圆圈标记的）。
            {template && (
              <span className="text-success font-medium"> 已启用视觉模板（{template.fieldCount} 个字段已定位），识别准确度更高。</span>
            )}
            {!template && (
              <span className="text-warning"> 首次使用建议先点「校准模板」提升准确度。</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 拖拽放置区 */}
          <div
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className={`relative rounded-lg border-2 border-dashed transition-colors ${
              isDragging ? 'border-primary bg-primary/5' : 'border-transparent'
            }`}
          >
            {isDragging && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/5 rounded-lg pointer-events-none">
                <p className="text-sm font-medium text-primary">松开鼠标，把图片加入识别列表</p>
              </div>
            )}
            <div className="flex flex-wrap gap-3 p-1">
              <Button onClick={() => fileInputRef.current?.click()}>
                选择截图
              </Button>
              <Button variant="outline" onClick={handleRecognize} disabled={recognizing || images.length === 0}>
                {recognizing ? '识别中...' : `开始识别 → 写入第 ${rows.findIndex(r => r.id === activeRowId) + 1} 行`}
                {template && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] bg-success/10 text-success px-1.5 py-0.5 rounded">
                    <MapPin className="w-2.5 h-2.5" />模板
                  </span>
                )}
              </Button>
              <Button
                variant={template ? 'secondary' : 'default'}
                size="sm"
                onClick={handleCalibrate}
                disabled={calibrating || images.length === 0}
              >
                <MapPin className="w-3.5 h-3.5 mr-1" />
                {calibrating ? '校准中...' : template ? `已校准(${template.fieldCount}字段)` : '校准模板'}
              </Button>
              {template && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-destructive self-center"
                  onClick={handleDeleteTemplate}
                  title="删除视觉模板"
                >
                  删除模板
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleSelectFiles}
              />
              <span className="self-center text-xs text-muted-foreground hidden sm:inline">
                也可以直接把图片拖拽到这里，或从文件管理器拖入
              </span>
            </div>

            {images.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 p-1">
                {images.map(img => (
                  <div key={img.id} className="relative group border rounded-md overflow-hidden">
                    <img src={img.url} alt={img.name} className="w-full h-32 object-cover" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
                      <button
                        type="button"
                        className="text-xs text-white bg-primary px-2 py-1 rounded"
                        onClick={() => setCropTarget(img)}
                      >
                        裁剪
                      </button>
                      <button
                        type="button"
                        className="text-xs text-white bg-destructive px-2 py-1 rounded"
                        onClick={() => removeImage(img.id)}
                      >
                        删除
                      </button>
                    </div>
                    <p className="text-[10px] truncate px-1 py-0.5 text-muted-foreground">{img.name}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 多行数据管理 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>数据记录（{rows.length} 行）</CardTitle>
              <CardDescription>
                点击圆圈选择当前行（识别结果写入该行）；点击行展开编辑字段；每行代表一场直播的数据
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setColumnModalOpen(true)}>
                <Settings2 className="w-4 h-4 mr-1" /> 管理列
              </Button>
              <Button size="sm" onClick={addRow}>
                <Plus className="w-4 h-4 mr-1" /> 新增一行
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.map((row, idx) => (
            <RowCard
              key={row.id}
              row={row}
              rowIndex={idx}
              rowCount={rows.length}
              isActive={row.id === activeRowId}
              columns={columns}
              onSelect={() => setActiveRowId(row.id)}
              onUpdateValues={updateCellValue}
              onDelete={deleteRow}
            />
          ))}

          <div className="flex flex-wrap gap-3 pt-4 border-t mt-4">
            <Button onClick={handleExport}>
              <Table className="w-4 h-4 mr-1" /> 导出全部 {rows.length} 行为 CSV
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                const outputPath = await window.ipcRenderer.invoke(
                  IPC_CHANNELS.dataEntry.selectOutputPath,
                )
                if (!outputPath) return
                try {
                  const saved = await window.ipcRenderer.invoke(
                    IPC_CHANNELS.dataEntry.generateTemplate,
                    { outputPath, columns },
                  )
                  toast.success(`已生成模板：${saved}`)
                } catch (error) {
                  toast.error(`生成失败：${error instanceof Error ? error.message : String(error)}`)
                }
              }}
            >
              生成空白模板
            </Button>
          </div>
        </CardContent>
      </Card>

      {cropTarget && (
        <CropModal
          image={cropTarget}
          onCancel={() => setCropTarget(null)}
          onConfirm={dataUrl => {
            setImages(prev => [
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
          columns={columns}
          onCancel={() => setColumnModalOpen(false)}
          onSave={handleSaveColumns}
        />
      )}
    </div>
  )
}
