import { dialog } from 'electron'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { typedIpcMainHandle } from '#/utils'
import { VisionRecognizer } from '#/services/VisionRecognizer'
import { tableFileService } from '#/services/TableFileService'
import { liveReportColumnsService } from '#/services/LiveReportColumnsService'
import { visionTemplateService } from '#/services/VisionTemplateService'
import { dataEntryStateService } from '#/services/DataEntryStateService'

const visionRecognizer = new VisionRecognizer()

function setupIpcHandlers() {
  typedIpcMainHandle(IPC_CHANNELS.dataEntry.recognize, async (_, params) => {
    // 如果请求使用模板，加载已保存的模板
    const template = params.templateId === 'use-saved'
      ? await visionTemplateService.loadTemplate()
      : null
    return await visionRecognizer.recognize(params.images, params.config, params.columns, template ?? undefined)
  })

  typedIpcMainHandle(IPC_CHANNELS.dataEntry.selectOutputPath, async () => {
    const res = await dialog.showSaveDialog({
      title: '保存直播日报',
      defaultPath: '直播日报.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    return res.canceled ? null : (res.filePath ?? null)
  })

  typedIpcMainHandle(IPC_CHANNELS.dataEntry.exportExcel, async (_, params) => {
    if (params.rows && Array.isArray(params.rows)) {
      return await tableFileService.exportRows(params.rows, params.outputPath, params.columns)
    }
    return await tableFileService.exportRow(params.values ?? {}, params.outputPath, params.columns)
  })

  typedIpcMainHandle(IPC_CHANNELS.dataEntry.generateTemplate, async (_, params) => {
    return await tableFileService.generateTemplate(params.outputPath, params.columns)
  })

  // 列定义（标签/单位/类型/分组）的读取与持久化
  typedIpcMainHandle(IPC_CHANNELS.dataEntry.getColumns, async () => {
    return await liveReportColumnsService.loadColumns()
  })

  typedIpcMainHandle(IPC_CHANNELS.dataEntry.saveColumns, async (_, columns) => {
    await liveReportColumnsService.saveColumns(columns)
  })

  // ── 视觉模板校准 ──
  typedIpcMainHandle(IPC_CHANNELS.dataEntry.calibrateTemplate, async (_, params) => {
    const template = await visionRecognizer.calibrateTemplate(
      params.image,
      params.config,
      undefined, // 使用默认列
      params.knownValues,
    )
    // 自动保存
    await visionTemplateService.saveTemplate(template)
    return template
  })

  typedIpcMainHandle(IPC_CHANNELS.dataEntry.getTemplate, async () => {
    return await visionTemplateService.loadTemplate()
  })

  typedIpcMainHandle(IPC_CHANNELS.dataEntry.deleteTemplate, async () => {
    await visionTemplateService.deleteTemplate()
  })

  // ── 表单数据持久化 ──
  typedIpcMainHandle(IPC_CHANNELS.dataEntry.getRows, async () => {
    return await dataEntryStateService.loadState()
  })

  typedIpcMainHandle(IPC_CHANNELS.dataEntry.saveRows, async (_, state) => {
    await dataEntryStateService.saveState(state)
  })
}

export function setupDataEntryIpcHandlers() {
  setupIpcHandlers()
}
