import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
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
 * 数字类文本一律写成真正的数值，否则 Excel/WPS 会在格子左上角挂绿色小三角
 * 「以文本形式存储的数字」（2026-11-05 用户要求「所有的绿色标都去掉」）。
 *  - 纯数字 1.11 / 千分位 1,234 → Number
 *  - 百分比 16.79% → 0.1679（配合 numFmt '0.00%' 仍显示 16.79%）
 *  - 日期 2026/11/04、时间段 6:48-9:19、带单位 6.45万 / 32秒、名称 → 保持文本
 */
function toCellValue(raw: unknown): string | number | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  if (/^[-+]?\d+(\.\d+)?$/.test(text)) return Number(text)
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
    return Number(text.replace(/,/g, ''))
  }
  if (/^[-+]?\d+(\.\d+)?%$/.test(text)) return Number(text.slice(0, -1)) / 100
  return String(raw)
}

/** 这一列的值是不是「xx%」，是的话给单元格套百分比格式 */
function isPercentText(raw: unknown): boolean {
  return /^[-+]?\d+(\.\d+)?%$/.test(String(raw ?? '').trim())
}

/** 把列号转成 Excel 列名（1→A、27→AA） */
function columnLetter(n: number): string {
  let s = ''
  let i = n
  while (i > 0) {
    const mod = (i - 1) % 26
    s = String.fromCharCode(65 + mod) + s
    i = Math.floor((i - 1) / 26)
  }
  return s || 'A'
}

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
    /**
     * ① 输出哪些列：**全部字段都输出**，包括还没填、标了「（留空）」的字段。
     *    曾经按「这一列有没有数据」筛过，结果用户新加/留空的字段在外部表格里连表头都没有
     *    （2026-11-06 反复反馈两次）。字段是用户自己在「管理列」里定的，就该原样同步出去。
     */
    const usedColumns = columns.filter(c => String(c.label ?? '').trim() !== '')

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
      const line = sheet.addRow(usedColumns.map(c => toCellValue(row[c.key])))
      usedColumns.forEach((c, i) => {
        if (isPercentText(row[c.key])) line.getCell(i + 1).numFmt = '0.00%'
      })
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
    // 兜底：即便某些值（6.45万 / 32秒 / 日期）必须保持文本，也告诉 Excel/WPS
    // 整个数据区不要显示任何错误检查标记（绿色小三角）。
    const finalBuffer = await this.suppressErrorIndicators(Buffer.from(buffer), usedColumns.length)

    // 原子落盘：先写同目录临时文件，再 rename 覆盖
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    const tmpPath = path.join(
      path.dirname(outputPath),
      `.${path.basename(outputPath)}.${process.pid}.tmp`,
    )
    await fs.writeFile(tmpPath, finalBuffer)
    await this.renameWithRetry(tmpPath, outputPath)

    this.logger.info(
      `同步 ${rows.length} 行 / ${usedColumns.length} 列（原始 ${columns.length} 列，已隐藏空列）到 ${outputPath}`,
    )
    return outputPath
  }

  /**
   * 往 sheet XML 里写 `<ignoredErrors>`（Excel/WPS 官方的「忽略此区域的错误检查」）。
   * ExcelJS 没有暴露这个能力，所以在生成完 zip 后用 jszip 补一段 XML。
   * 覆盖所有常见错误类型：文本型数字、两位年份、公式不一致、空单元格引用等。
   * 出问题就退回原始 buffer，绝不让同步失败。
   */
  private async suppressErrorIndicators(xlsx: Buffer, columnCount: number): Promise<Buffer> {
    try {
      const zip = await JSZip.loadAsync(xlsx)
      const entry = zip.file('xl/worksheets/sheet1.xml')
      if (!entry) return xlsx
      let xml = await entry.async('string')
      if (xml.includes('<ignoredErrors')) return xlsx
      // 覆盖整列（Excel 最大行 1048576），以后数据行变多也不用回来改
      const sqref = `A1:${columnLetter(Math.max(columnCount, 1))}1048576`
      const tag =
        `<ignoredErrors><ignoredError sqref="${sqref}" numberStoredAsText="1" ` +
        `twoDigitTextYear="1" evalError="1" formula="1" formulaRange="1" ` +
        `unlockedFormula="1" emptyCellReference="1" listDataValidation="1" ` +
        `calculatedColumn="1" omitLeadingZeros="1"/></ignoredErrors>`
      const at = xml.lastIndexOf('</worksheet>')
      if (at < 0) return xlsx
      xml = `${xml.slice(0, at)}${tag}${xml.slice(at)}`
      zip.file('xl/worksheets/sheet1.xml', xml)
      return await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      })
    } catch (error) {
      this.logger.warn(
        `写入忽略错误标记失败（不影响数据）：${error instanceof Error ? error.message : String(error)}`,
      )
      return xlsx
    }
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
