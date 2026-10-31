import { readFile, writeFile } from 'node:fs/promises'
import { dialog } from 'electron'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { createLogger } from '#/logger'
import { typedIpcMainHandle } from '#/utils'

const logger = createLogger('配置迁移')

function setupIpcHandlers() {
  /**
   * 导出：渲染进程把「要导出的配置」整理好传进来，这里只负责弹保存框并落盘。
   *
   * 为什么序列化放渲染进程：配置全在 localStorage（zustand persist）里，
   * 主进程读不到；主进程只做它擅长的文件对话框和写盘。
   */
  typedIpcMainHandle(IPC_CHANNELS.configTransfer.exportFile, async (_, payload: unknown) => {
    const stamp = new Date().toISOString().slice(0, 10)
    const res = await dialog.showSaveDialog({
      title: '导出账号配置',
      defaultPath: `livedeck-配置-${stamp}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (res.canceled || !res.filePath) return null
    await writeFile(res.filePath, JSON.stringify(payload, null, 2), 'utf-8')
    logger.info(`配置已导出：${res.filePath}`)
    return res.filePath
  })

  /** 导入：弹打开框，读回 JSON 交给渲染进程去合并 */
  typedIpcMainHandle(IPC_CHANNELS.configTransfer.importFile, async () => {
    const res = await dialog.showOpenDialog({
      title: '导入账号配置',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (res.canceled || res.filePaths.length === 0) return null
    try {
      const raw = await readFile(res.filePaths[0], 'utf-8')
      return JSON.parse(raw) as unknown
    } catch (err) {
      logger.error('读取配置文件失败：', err)
      return null
    }
  })
}

export function setupConfigTransferIpcHandlers() {
  setupIpcHandlers()
}
