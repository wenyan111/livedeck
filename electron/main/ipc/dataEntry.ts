import fs from 'node:fs/promises'
import path from 'node:path'
import { app, dialog } from 'electron'
import ExcelJS from 'exceljs'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { dataEntryImagesService } from '#/services/DataEntryImagesService'
import { dataEntryStateService } from '#/services/DataEntryStateService'
import { ledgerSyncService } from '#/services/LedgerSyncService'
import { liveReportColumnsService } from '#/services/LiveReportColumnsService'
import { liveReportLedgerService } from '#/services/LiveReportLedgerService'
import { tableFileService } from '#/services/TableFileService'
import { VisionRecognizer } from '#/services/VisionRecognizer'
import { visionTemplateService } from '#/services/VisionTemplateService'
import { xlsxExportService } from '#/services/XlsxExportService'
import { typedIpcMainHandle } from '#/utils'

const visionRecognizer = new VisionRecognizer()

function setupIpcHandlers() {
  typedIpcMainHandle(IPC_CHANNELS.dataEntry.recognize, async (_, params) => {
    // 如果请求使用模板，加载已保存的模板
    const template =
      params.templateId === 'use-saved' ? await visionTemplateService.loadTemplate() : null
    return await visionRecognizer.recognize(
      params.images,
      params.config,
      params.columns,
      template ?? undefined,
      params.runId,
      params.extraInstructions,
    )
  })

  // 暂停识别：在两次模型调用之间停下，已完成的结果照常返回给页面
  typedIpcMainHandle(IPC_CHANNELS.dataEntry.pauseRecognize, async (_, params) => {
    visionRecognizer.requestPause(params?.runId)
    return true
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

  /**
   * 从外部 Excel / CSV 读第一行表头，直接变成字段标签。
   * 用户 2026-11-06：一个个手加太麻烦，能不能导入文件识别标签列。
   */
  typedIpcMainHandle(IPC_CHANNELS.dataEntry.importColumnHeaders, async () => {
    const res = await dialog.showOpenDialog({
      title: '选择要导入字段的表格',
      properties: ['openFile'],
      filters: [
        { name: '表格', extensions: ['xlsx', 'xlsm', 'csv', 'tsv', 'txt'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    })
    const filePath = res.canceled ? undefined : res.filePaths[0]
    if (!filePath) return null

    const ext = path.extname(filePath).toLowerCase()
    if (ext === '.csv' || ext === '.tsv' || ext === '.txt') {
      const raw = await fs.readFile(filePath, 'utf8')
      const firstLine = raw.split(/\r?\n/).find(line => line.trim()) ?? ''
      const sep =
        ext === '.tsv' || ext === '.txt'
          ? '\t'
          : firstLine.includes('\t') && !firstLine.includes(',')
            ? '\t'
            : ','
      return firstLine
        .split(sep)
        .map(cell => cell.trim().replace(/^"|"$/g, '').trim())
        .filter(Boolean)
    }

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(filePath)
    const sheet = workbook.worksheets[0]
    if (!sheet) return []
    const firstRow = sheet.getRow(1)
    const headers: string[] = []
    firstRow.eachCell({ includeEmpty: false }, cell => {
      const text = String(cell.text ?? cell.value ?? '').trim()
      if (text) headers.push(text)
    })
    return headers
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

  // ── 截图存档（下次打开还在） ──
  typedIpcMainHandle(IPC_CHANNELS.dataEntry.getImages, async () => {
    return await dataEntryImagesService.load()
  })

  typedIpcMainHandle(IPC_CHANNELS.dataEntry.saveImages, async (_, data) => {
    await dataEntryImagesService.save(data)
  })

  // ── 日报总表（所有板块汇总成一张表） ──
  typedIpcMainHandle(IPC_CHANNELS.dataEntry.getLedger, async () => {
    return await liveReportLedgerService.load()
  })

  typedIpcMainHandle(IPC_CHANNELS.dataEntry.upsertLedger, async (_, records) => {
    return await liveReportLedgerService.upsert(records)
  })

  typedIpcMainHandle(IPC_CHANNELS.dataEntry.saveLedger, async (_, records) => {
    return await liveReportLedgerService.saveAll(records)
  })

  typedIpcMainHandle(IPC_CHANNELS.dataEntry.exportLedger, async (_, params) => {
    // 总表的「板块 / 平台」两列由渲染进程拼好，这里只负责落盘
    return await xlsxExportService.writeLedgerXlsx(params.sheets, params.outputPath)
  })

  // ── 实时同步到本机表格（xlsx） ──
  typedIpcMainHandle(IPC_CHANNELS.dataEntry.getLedgerSync, async () => {
    return await ledgerSyncService.load()
  })

  typedIpcMainHandle(IPC_CHANNELS.dataEntry.setLedgerSync, async (_, config) => {
    return await ledgerSyncService.save(config)
  })

  typedIpcMainHandle(IPC_CHANNELS.dataEntry.chooseLedgerSyncPath, async () => {
    const defaultPath = path.join(app.getPath('documents'), '直播日报总表.xlsx')
    const result = await dialog.showSaveDialog({
      title: '选择总表要实时写入的表格文件',
      defaultPath,
      buttonLabel: '同步到这个文件',
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
    })
    if (result.canceled || !result.filePath) return null
    // 用户没写扩展名时补上 .xlsx，否则 Excel 打不开
    return result.filePath.toLowerCase().endsWith('.xlsx')
      ? result.filePath
      : `${result.filePath}.xlsx`
  })

  typedIpcMainHandle(IPC_CHANNELS.dataEntry.syncLedgerXlsx, async (_, params) => {
    return await xlsxExportService.writeLedgerXlsx(params.sheets, params.outputPath)
  })
}

export function setupDataEntryIpcHandlers() {
  setupIpcHandlers()
}
