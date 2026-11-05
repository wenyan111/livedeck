import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import type { LiveReportColumn } from 'shared/liveReportColumns'
import { createLogger } from '#/logger'

/** 一个中文/全角字符在 Excel 里约占 2 个半角宽度 */
function displayWidth(text: string): number {
  let width = 0
  for (const ch of String(text ?? '')) {
    width +=
      /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uff60\uffe0-\uffe6]/.test(ch)
        ? 2
        : 1
  }
  return width
}

/**
 * 纯数字写成真正的数值。
 * 之前所有值都按文本写，Excel/WPS 会在每个数字格左上角挂绿色小三角
 * 「以文本形式存储的数字」（2026-11-05 用户要求「这些绿标去掉」）。
 * 日期（2026/11/04）、时间段（6:48-9:19）、百分比、名称都保持文本。
 */
function toCellValue(raw: unknown): string | number | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  if (/^[-+]?\d+(\.\d+)?$/.test(text)) return Number(text)
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
    return Number(text.replace(/,/g, ''))
  }
  return String(raw)
}

/** 这几列即便全空也要留着，否则表就看不懂了 */
const ALWAYS_KEEP_KEYS = new Set(['__section', '__platform', 'date', 'session', 'weekLabel'])

/** 参考「英子数据记录.xlsx」的排版：微软雅黑 11、四边细边框、居中、白底 */
const CELL_BORDER: ExcelJS.Borders = {
  left: { style: 'thin', color: { argb: 'FF9AA4AD' } },
  right: { style: 'thin', color: { argb: 'FF9AA4AD' } },
  top: { style: 'thin', color: { argb: 'FF9AA4AD' } },
  bottom: { style: 'thin', color: { argb: 'FF9AA4AD' } },
  diagonal: {},
}

/**
 * 把日报总表写成真正的 .xlsx（Excel / WPS / Numbers 都能直接打开）。
 *
 * 排版照用户给的「英子数据记录.xlsx」来：白底、每格四边细边框、微软雅黑 11、
 * 全部居中、表头行高 40 / 数据行 24、列宽跟着内容走、冻结表头与前几列。
 * 另外：整列全空的列不写（总表是所有板块字段的并集，留着就是一大片空白），
 * 数字写成数值类型（消掉 Excel 的绿色小三角）。
 * 落盘用「写临时文件 → rename 原子替换」，任何时刻读到的都是完整文件。
 */
export class XlsxExportService {
  private logger = createLogger('表格同步')

  async writeLedgerXlsx(
    rows: Record<string, string>[],
    columns: LiveReportColumn[],
    outputPath: string,
  ): Promise<string> {
    // ① 丢掉全空列：用户只用了一个板块时，别的板块那几十列就别占地方了
    const usedColumns = columns.filter(c => {
      if (ALWAYS_KEEP_KEYS.has(c.key)) return true
      return rows.some(row => String(row[c.key] ?? '').trim() !== '')
    })

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'LiveDeck・直播台'
    workbook.created = new Date()

    const sheet = workbook.addWorksheet('日报总表', {
      views: [
        {
          state: 'frozen',
          ySplit: 1,
          xSplit: Math.min(6, usedColumns.length),
          showGridLines: false,
        },
      ],
    })

    // ② 列宽自适应：以实际数据为主，长表头折行，不再把整列撑宽
    sheet.columns = usedColumns.map(c => {
      let maxData = 0
      for (const row of rows) {
        maxData = Math.max(maxData, displayWidth(String(row[c.key] ?? '')))
      }
      const width = Math.min(Math.max(maxData + 3, Math.min(displayWidth(c.label), 12) + 2, 9), 22)
      return { header: c.label, key: c.key, width }
    })

    for (const row of rows) {
      sheet.addRow(usedColumns.map(c => toCellValue(row[c.key])))
    }

    // ③ 逐格套参考表样式：白底 + 四边细边框 + 居中 + 自动换行
    for (let r = 1; r <= sheet.rowCount; r++) {
      const line = sheet.getRow(r)
      line.height = r === 1 ? 40 : 24
      line.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      line.font = { name: '微软雅黑', size: 11, bold: true, color: { argb: 'FF1F2933' } }
      for (let c = 1; c <= usedColumns.length; c++) {
        line.getCell(c).border = CELL_BORDER
      }
    }

    sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1 }

    const buffer = await workbook.xlsx.writeBuffer()

    // 原子落盘：先写同目录临时文件，再 rename 覆盖
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    const tmpPath = path.join(
      path.dirname(outputPath),
      `.${path.basename(outputPath)}.${process.pid}.tmp`,
    )
    await fs.writeFile(tmpPath, Buffer.from(buffer))
    await this.renameWithRetry(tmpPath, outputPath)

    this.logger.info(
      `同步 ${rows.length} 行 / ${usedColumns.length} 列（原始 ${columns.length} 列，已隐藏空列）到 ${outputPath}`,
    )
    return outputPath
  }

  /** Excel 正在打开文件时 rename 偶发 EBUSY/EPERM，短暂重试即可 */
  private async renameWithRetry(from: string, to: string): Promise<void> {
    let lastError: unknown
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await fs.rename(from, to)
        return
      } catch (error) {
        lastError = error
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') break
        await new Promise(resolve => setTimeout(resolve, 120 * (attempt + 1)))
      }
    }
    await fs.unlink(from).catch(() => {})
    throw lastError
  }
}

export const xlsxExportService = new XlsxExportService()
