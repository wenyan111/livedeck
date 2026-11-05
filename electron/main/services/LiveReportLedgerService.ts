import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { type LedgerRecord, mergeLedgerRecords } from 'shared/dataEntryLedger'
import { createLogger } from '#/logger'

const FILE_NAME = 'liveReportLedger.json'

/**
 * 直播日报「总表」的持久化。
 *
 * 所有板块的数据行归档到同一个文件，按「日期 + 板块 + 场次」去重，
 * 这样用户不用每个板块导一次再手工拼表（用户 2026-11-05 需求）。
 */
export class LiveReportLedgerService {
  private logger = createLogger('日报总表')
  private filePath: string

  constructor() {
    this.filePath = path.join(app.getPath('userData'), FILE_NAME)
  }

  /** 读取整张总表（没有就是空表） */
  async load(): Promise<LedgerRecord[]> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return (parsed as LedgerRecord[]).map(r => ({
          ...r,
          platform: (r.platform ?? 'douyin') as LiveControlPlatform,
          values: r.values ?? {},
          createdAt: r.createdAt ?? Date.now(),
          updatedAt: r.updatedAt ?? r.createdAt ?? Date.now(),
        }))
      }
    } catch {
      // 文件不存在或损坏 → 空表
    }
    return []
  }

  /** 整表覆盖保存（总表里直接改单元格、删行都走这里） */
  async saveAll(records: LedgerRecord[]): Promise<LedgerRecord[]> {
    try {
      await fs.writeFile(this.filePath, JSON.stringify(records), 'utf-8')
    } catch (err) {
      this.logger.error(`总表写入失败：${err instanceof Error ? err.message : String(err)}`)
      throw err
    }
    return records
  }

  /** 归档：把当前页面的行合并进总表，返回合并后的全表 */
  async upsert(incoming: LedgerRecord[]): Promise<LedgerRecord[]> {
    const existing = await this.load()
    const merged = mergeLedgerRecords(existing, incoming)
    const added = merged.length - existing.length
    this.logger.info(
      `归档 ${incoming.length} 行 → 总表现有 ${merged.length} 行${added > 0 ? `（新增 ${added}）` : '（全部为更新）'}`,
    )
    return this.saveAll(merged)
  }
}

export const liveReportLedgerService = new LiveReportLedgerService()
