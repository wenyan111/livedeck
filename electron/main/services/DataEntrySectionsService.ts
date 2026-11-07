import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import {
  type DataEntrySectionsState,
  EMPTY_SECTIONS_STATE,
  normalizeSectionsState,
} from 'shared/dataEntrySections'
import { createLogger } from '#/logger'

const FILE_NAME = 'dataEntrySections.json'

/**
 * 板块列表 / 板块名的主进程存档。
 *
 * 为什么要有它：这两项原来只写在渲染进程 localStorage，只要进程是被强杀的
 * （自动更新、点确认关闭后立刻退出、任务管理器结束），LevelDB 还没落盘就丢了，
 * 下次启动板块就退回只剩「抖音」、名字退回「抖音小店」——
 * 用户 2026-11-07 连着踩了两次（「被你删的」）。
 *
 * 主进程用 fs 直接写文件，写完即落盘，不存在「缓冲区没刷新」的问题。
 */
export class DataEntrySectionsService {
  private logger = createLogger('板块配置')
  private filePath: string
  /** 串行化写入，避免连续改名时两个写并发把文件写坏 */
  private writing: Promise<unknown> = Promise.resolve()

  constructor() {
    this.filePath = path.join(app.getPath('userData'), FILE_NAME)
  }

  async load(): Promise<DataEntrySectionsState> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      return normalizeSectionsState(JSON.parse(raw) as Partial<DataEntrySectionsState>)
    } catch {
      // 没存过 → 空，由渲染进程回落到 localStorage / 默认板块
      return { ...EMPTY_SECTIONS_STATE, names: {} }
    }
  }

  async save(state: Partial<DataEntrySectionsState>): Promise<DataEntrySectionsState> {
    const next = normalizeSectionsState(state)
    const job = this.writing.then(async () => {
      try {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true })
        // 先写临时文件再 rename：写一半断电也不会留下半个 JSON
        const tmp = `${this.filePath}.tmp`
        await fs.writeFile(tmp, JSON.stringify(next), 'utf-8')
        await fs.rename(tmp, this.filePath)
      } catch (error) {
        this.logger.error(
          `板块配置保存失败：${error instanceof Error ? error.message : String(error)}`,
        )
        throw error
      }
      return next
    })
    this.writing = job.catch(() => undefined)
    return await job
  }
}

export const dataEntrySectionsService = new DataEntrySectionsService()
