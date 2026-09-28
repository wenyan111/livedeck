import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { DataEntrySavedState } from 'shared/dataEntryState'

const FILE_NAME = 'dataEntryState.json'

export class DataEntryStateService {
  private filePath: string

  constructor() {
    this.filePath = path.join(app.getPath('userData'), FILE_NAME)
  }

  /** 加载已保存的表单数据（不存在返回 null） */
  async loadState(): Promise<DataEntrySavedState | null> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.rows) && parsed.rows.length > 0 && typeof parsed.activeRowId === 'string') {
        return parsed as DataEntrySavedState
      }
    } catch {
      // 文件不存在或损坏 → 返回 null
    }
    return null
  }

  /** 保存表单数据 */
  async saveState(state: DataEntrySavedState): Promise<void> {
    try {
      await fs.writeFile(this.filePath, JSON.stringify(state), 'utf-8')
    } catch {
      // 写入失败（如 userData 不可写）忽略，下次再试
    }
  }

  /** 清空已保存的表单数据 */
  async clearState(): Promise<void> {
    try {
      await fs.unlink(this.filePath)
    } catch {
      /* ignore */
    }
  }
}

export const dataEntryStateService = new DataEntryStateService()
