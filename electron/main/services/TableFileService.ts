import fs from 'node:fs/promises'
import { LIVE_REPORT_COLUMNS, type LiveReportColumn } from 'shared/liveReportColumns'
import { createLogger } from '#/logger'

function csvCell(v: unknown): string {
  const s = (v ?? '').toString()
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export class TableFileService {
  private logger = createLogger('表格文件')

  private buildLines(columns: LiveReportColumn[], values?: Record<string, string>): string {
    const lines: string[] = []
    lines.push(columns.map(c => csvCell(c.label)).join(','))
    if (values) {
      lines.push(columns.map(c => csvCell(values[c.key] ?? '')).join(','))
    }
    return lines.join('\r\n')
  }

  /** 生成仅含表头的空白模板（CSV，带 BOM 以便 Excel 正确识别中文） */
  async generateTemplate(
    outputPath: string,
    columns: LiveReportColumn[] = LIVE_REPORT_COLUMNS,
  ): Promise<string> {
    const content = '﻿' + this.buildLines(columns)
    await fs.writeFile(outputPath, content, 'utf-8')
    this.logger.info(`已生成模板：${outputPath}`)
    return outputPath
  }

  /** 写入一行数据（含表头） */
  async exportRow(
    values: Record<string, string>,
    outputPath: string,
    columns: LiveReportColumn[] = LIVE_REPORT_COLUMNS,
  ): Promise<string> {
    const content = '﻿' + this.buildLines(columns, values)
    await fs.writeFile(outputPath, content, 'utf-8')
    this.logger.info(`已导出：${outputPath}`)
    return outputPath
  }

  /** 写入多行数据（含表头） */
  async exportRows(
    rows: Record<string, string>[],
    outputPath: string,
    columns: LiveReportColumn[] = LIVE_REPORT_COLUMNS,
  ): Promise<string> {
    const lines: string[] = []
    // BOM + 表头
    lines.push('﻿' + columns.map(c => csvCell(c.label)).join(','))
    // 每行数据
    for (const row of rows) {
      lines.push(columns.map(c => csvCell(row[c.key] ?? '')).join(','))
    }
    await fs.writeFile(outputPath, lines.join('\r\n'), 'utf-8')
    this.logger.info(`已导出 ${rows.length} 行：${outputPath}`)
    return outputPath
  }
}

export const tableFileService = new TableFileService()
