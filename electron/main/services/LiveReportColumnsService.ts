import path from 'node:path'
import fs from 'node:fs/promises'
import { app } from 'electron'
import { LIVE_REPORT_COLUMNS, type LiveReportColumn } from 'shared/liveReportColumns'
import { createLogger } from '#/logger'

/**
 * 直播日报「列定义」的持久化服务。
 * 列（标签/单位/类型/分组）可让用户增删改并落盘，缺省回退到代码内置的默认列。
 */
export class LiveReportColumnsService {
  private logger = createLogger('直播日报列配置')

  private get filePath(): string {
    return path.join(app.getPath('userData'), 'liveReportColumns.json')
  }

  /** 读取已保存的列定义；文件不存在/损坏时返回默认 53 列副本 */
  async loadColumns(): Promise<LiveReportColumn[]> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as LiveReportColumn[]
      if (Array.isArray(parsed) && parsed.length > 0) {
        // 补齐缺失字段，避免旧格式缺字段导致前端报错
        return parsed.map(c => ({
          key: String(c.key ?? ''),
          label: String(c.label ?? ''),
          unit: (c.unit ?? 'none') as LiveReportColumn['unit'],
          source: (c.source ?? 'manual') as LiveReportColumn['source'],
          group: c.group ?? '其它',
        }))
      }
    } catch {
      // 文件不存在或损坏 → 使用默认
    }
    return LIVE_REPORT_COLUMNS.map(c => ({ ...c }))
  }

  /** 保存列定义到 userData */
  async saveColumns(columns: LiveReportColumn[]): Promise<void> {
    await fs.writeFile(this.filePath, JSON.stringify(columns, null, 2), 'utf-8')
    this.logger.info(`已保存列配置：${columns.length} 列`)
  }
}

export const liveReportColumnsService = new LiveReportColumnsService()
