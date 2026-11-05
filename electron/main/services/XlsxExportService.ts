import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import type { LiveReportColumn } from 'shared/liveReportColumns'
import { createLogger } from '#/logger'

/**
 * 把日报总表写成真正的 .xlsx（Excel / WPS / Numbers 都能直接打开）。
 *
 * 用户 2026-11-05 需求：软件里填完的数据想「实时落到我电脑上的表格里」，
 * 所以这里每次都用「写临时文件 → rename 原子替换」，
 * 保证任何时刻读到的都是一个完整可打开的 xlsx（哪怕软件在写盘中途崩了）。
 */
export class XlsxExportService {
  private logger = createLogger('表格同步')

  async writeLedgerXlsx(
    rows: Record<string, string>[],
    columns: LiveReportColumn[],
    outputPath: string,
  ): Promise<string> {
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'LiveDeck・直播台'
    workbook.created = new Date()

    const sheet = workbook.addWorksheet('日报总表', {
      views: [{ state: 'frozen', ySplit: 1, xSplit: 3 }],
    })

    sheet.columns = columns.map(c => ({
      header: c.label,
      key: c.key,
      width: Math.min(Math.max(c.label.length * 2 + 6, 10), 26),
    }))

    for (const row of rows) {
      sheet.addRow(row)
    }

    // 表头样式：加粗 + 浅灰底 + 居中，冻结首行方便滚动
    const header = sheet.getRow(1)
    header.font = { bold: true, size: 11 }
    header.alignment = { vertical: 'middle', horizontal: 'center' }
    header.height = 22
    for (let i = 1; i <= columns.length; i++) {
      header.getCell(i).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEDEFF2' },
      }
      header.getCell(i).border = {
        bottom: { style: 'thin', color: { argb: 'FFB9BEC6' } },
      }
    }
    // 数据区：细边框 + 单元格允许换行，长文本不撑破列宽
    for (let r = 2; r <= sheet.rowCount; r++) {
      const line = sheet.getRow(r)
      for (let c = 1; c <= columns.length; c++) {
        const cell = line.getCell(c)
        cell.alignment = { vertical: 'middle', wrapText: true }
        cell.border = {
          bottom: { style: 'hair', color: { argb: 'FFE3E6EA' } },
        }
      }
    }
    if (columns.length > 0) {
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: columns.length },
      }
    }

    const buffer = await workbook.xlsx.writeBuffer()

    // 原子落盘：先写同目录临时文件，再 rename 覆盖
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    const tmpPath = path.join(
      path.dirname(outputPath),
      `.${path.basename(outputPath)}.${process.pid}.tmp`,
    )
    await fs.writeFile(tmpPath, Buffer.from(buffer))
    await this.renameWithRetry(tmpPath, outputPath)

    this.logger.info(`同步 ${rows.length} 行到 ${outputPath}`)
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
    // 兜底：清掉临时文件，抛给上层提示用户
    await fs.unlink(from).catch(() => {})
    throw lastError
  }
}

export const xlsxExportService = new XlsxExportService()
