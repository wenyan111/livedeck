import type { LedgerRecord } from 'shared/dataEntryLedger'
import type { LedgerSheetPayload } from 'shared/electron-api'
import type { LiveReportColumn } from 'shared/liveReportColumns'
import { createLogger } from '#/logger'
import { ledgerSyncService } from './LedgerSyncService'
import { liveReportColumnsService } from './LiveReportColumnsService'
import { liveReportLedgerService } from './LiveReportLedgerService'
import { xlsxExportService } from './XlsxExportService'

const logger = createLogger('表格同步')

/** 防抖窗口：连续改动（识别一批图、连敲几格）只写最后一次 */
const DEBOUNCE_MS = 800
let timer: NodeJS.Timeout | null = null
let running = false
let pending = false

/**
 * 把「字段配置 + 总表记录」拼成「一个板块一张工作表」的数据。
 * 板块名优先用记录里存的 sectionName（自定义板块只有渲染层知道名字），
 * 没记录时退回板块 key。
 */
export function buildLedgerSheets(
  columns: LiveReportColumn[],
  records: LedgerRecord[],
): LedgerSheetPayload[] {
  const columnsBySection = new Map<string, LiveReportColumn[]>()
  for (const col of columns) {
    const key = String(col.platform ?? '')
    if (!key) continue
    const list = columnsBySection.get(key)
    if (list) list.push(col)
    else columnsBySection.set(key, [col])
  }

  const rowsBySection = new Map<string, Record<string, string>[]>()
  const nameBySection = new Map<string, string>()
  for (const record of records) {
    const key = String(record.sectionKey ?? '')
    if (!key) continue
    if (!nameBySection.has(key) && record.sectionName) nameBySection.set(key, record.sectionName)
    const list = rowsBySection.get(key)
    if (list) list.push({ ...record.values })
    else rowsBySection.set(key, [{ ...record.values }])
  }

  return (
    [...columnsBySection.entries()]
      .map(([key, cols]) => ({
        name: nameBySection.get(key) ?? key,
        columns: cols,
        rows: rowsBySection.get(key) ?? [],
      }))
      // 只输出真有数据的板块：空板块既没有板块名（自定义板块名只有页面知道），
      // 建出来也只是个名叫 custom-xxxx 的空工作表
      .filter(
        sheet =>
          sheet.rows.length > 0 && sheet.columns.some(c => String(c.label ?? '').trim() !== ''),
      )
  )
}

/**
 * 立刻把当前配置 + 总表写进用户指定的 xlsx。
 * 放在主进程而不是页面里：以前只有「直播日报」页面打开时才同步，
 * 用户不打开那个页面（在中控台看直播）外部表格就一直是旧的（2026-11-06 反馈）。
 */
export async function syncLedgerNow(): Promise<string | null> {
  const config = await ledgerSyncService.load()
  if (!config.enabled || !config.filePath) return null
  // 正在写就不再叠一个，等这次写完再看有没有新改动
  if (running) {
    pending = true
    return null
  }
  running = true
  try {
    const [columns, records] = await Promise.all([
      liveReportColumnsService.loadColumns(),
      liveReportLedgerService.load(),
    ])
    const sheets = buildLedgerSheets(columns, records)
    if (sheets.length === 0) return null
    return await xlsxExportService.writeLedgerXlsx(sheets, config.filePath)
  } catch (error) {
    logger.error(`同步失败：${error instanceof Error ? error.message : String(error)}`)
    return null
  } finally {
    running = false
    if (pending) {
      pending = false
      scheduleLedgerSync(200)
    }
  }
}

/** 防抖排队：字段改了、总表变了都调它 */
export function scheduleLedgerSync(delay = DEBOUNCE_MS) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void syncLedgerNow()
  }, delay)
}
