import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { DEFAULT_LEDGER_SYNC, type LedgerSyncConfig } from 'shared/ledgerSync'
import { createLogger } from '#/logger'

const FILE_NAME = 'ledgerSync.json'

/**
 * 「实时同步到本机表格」的开关与目标路径。
 * 只存配置，真正的写盘在 XlsxExportService。
 */
export class LedgerSyncService {
  private logger = createLogger('表格同步')
  private filePath: string

  constructor() {
    this.filePath = path.join(app.getPath('userData'), FILE_NAME)
  }

  async load(): Promise<LedgerSyncConfig> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<LedgerSyncConfig>
      return {
        enabled: parsed.enabled === true,
        filePath: typeof parsed.filePath === 'string' ? parsed.filePath : '',
      }
    } catch {
      // 没配过 → 默认关闭
    }
    return { ...DEFAULT_LEDGER_SYNC }
  }

  async save(config: LedgerSyncConfig): Promise<LedgerSyncConfig> {
    const next: LedgerSyncConfig = {
      enabled: config.enabled === true,
      filePath: config.filePath ?? '',
    }
    try {
      await fs.writeFile(this.filePath, JSON.stringify(next), 'utf-8')
      this.logger.info(next.enabled ? `已开启同步：${next.filePath}` : '已关闭同步（保留目标路径）')
    } catch (error) {
      this.logger.error(
        `同步配置保存失败：${error instanceof Error ? error.message : String(error)}`,
      )
      throw error
    }
    return next
  }
}

export const ledgerSyncService = new LedgerSyncService()
