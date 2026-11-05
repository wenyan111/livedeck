import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { createLogger } from '#/logger'

const FILE_NAME = 'data-entry-images.json'

/** 一张截图的存档形态（url 是 dataURL） */
export interface StoredImage {
  id: string
  url: string
  name: string
  recognized?: boolean
}

/** 按板块 key 分组的截图列表 */
export type StoredImages = Record<string, StoredImage[]>

/**
 * 直播日报里「已拖进来的截图」也要能跨重启保留。
 *
 * 之前截图只存在页面内存里，关掉软件就得重新拖一遍（用户 2026-11-05 要求「下次打开上次的图片还在」）。
 * 图片是 dataURL（base64），体积不小，所以放磁盘文件而不是 localStorage（后者只有几 MB）。
 */
export class DataEntryImagesService {
  private logger = createLogger('日报截图')
  private filePath: string

  constructor() {
    this.filePath = path.join(app.getPath('userData'), FILE_NAME)
  }

  async load(): Promise<StoredImages> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') return parsed as StoredImages
    } catch {
      // 没有存档 / 损坏 → 当空
    }
    return {}
  }

  async save(data: StoredImages): Promise<void> {
    try {
      const count = Object.values(data).reduce((n, list) => n + list.length, 0)
      await fs.writeFile(this.filePath, JSON.stringify(data), 'utf-8')
      this.logger.info(`已保存 ${count} 张截图（下次打开还在）`)
    } catch (err) {
      this.logger.error(`截图存档失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** 清空全部截图存档 */
  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath)
    } catch {
      /* 文件不存在就算了 */
    }
  }
}

export const dataEntryImagesService = new DataEntryImagesService()
