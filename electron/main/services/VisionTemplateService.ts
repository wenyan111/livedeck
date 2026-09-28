import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { VisionTemplate } from './VisionRecognizer'

const FILE_NAME = 'visionTemplate.json'

export class VisionTemplateService {
  private filePath: string

  constructor() {
    this.filePath = path.join(app.getPath('userData'), FILE_NAME)
  }

  /** 加载模板（不存在返回 null） */
  async loadTemplate(): Promise<VisionTemplate | null> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (parsed && parsed.id && Array.isArray(parsed.fields)) return parsed as VisionTemplate
    } catch {
      // 文件不存在或损坏 → 返回 null
    }
    return null
  }

  /** 保存模板 */
  async saveTemplate(template: VisionTemplate): Promise<void> {
    await fs.writeFile(this.filePath, JSON.stringify(template, null, 2), 'utf-8')
  }

  /** 删除模板 */
  async deleteTemplate(): Promise<void> {
    try { await fs.unlink(this.filePath) } catch { /* ignore */ }
  }

  /** 检查是否有已保存的模板 */
  async hasTemplate(): Promise<boolean> {
    try {
      await fs.access(this.filePath)
      return true
    } catch {
      return false
    }
  }
}

export const visionTemplateService = new VisionTemplateService()
