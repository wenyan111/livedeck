import type { VisionTemplate } from 'electron/main/services/VisionRecognizer'
import type { LogMessage } from 'electron-log'
import type { ProgressInfo, UpdateDownloadedEvent } from 'electron-updater'
import type { DashboardSnapshot, DouyinDashboardConfig } from './dashboard'
import type { DataEntrySavedState } from './dataEntryState'
import { IPC_CHANNELS } from './ipcChannels'
import type { LiveReportColumn } from './liveReportColumns'

export interface IpcChannels {
  // LiveControl
  [IPC_CHANNELS.tasks.liveControl.connect]: (params: {
    chromePath?: string
    headless?: boolean
    storageState?: string
    platform: LiveControlPlatform
    account: Account
  }) => boolean
  [IPC_CHANNELS.tasks.liveControl.disconnect]: (accountId: string) => boolean
  /**
   * @param resumableTaskTypes 断线瞬间仍在运行、值得重连后恢复的任务类型
   * （'auto-comment' / 'auto-popup' / 'comment-listener' / 'open-price'）
   */
  [IPC_CHANNELS.tasks.liveControl.disconnectedEvent]: (
    id: string,
    resumableTaskTypes: string[],
  ) => void
  [IPC_CHANNELS.tasks.liveControl.notifyAccountName]: (
    params:
      | {
          ok: true
          accountId: string
          accountName: string | null
        }
      | { ok: false },
  ) => void

  // AutoMessage
  [IPC_CHANNELS.tasks.autoMessage.start]: (accountId: string, config: AutoCommentConfig) => boolean
  [IPC_CHANNELS.tasks.autoMessage.stop]: (accountId: string) => boolean
  [IPC_CHANNELS.tasks.autoMessage.stoppedEvent]: (id: string) => void
  [IPC_CHANNELS.tasks.autoMessage.sendBatchMessages]: (
    accountId: string,
    messages: string[],
    count: number,
  ) => boolean
  [IPC_CHANNELS.tasks.autoMessage.updateConfig]: (
    accountId: string,
    config: Parital<AutoCommentConfig>,
  ) => void
  [IPC_CHANNELS.tasks.autoMessage.startOpenPriceWatcher]: (
    accountId: string,
    messages: { content: string; pinTop: boolean }[],
  ) => boolean
  [IPC_CHANNELS.tasks.autoMessage.stopOpenPriceWatcher]: (accountId: string) => void
  [IPC_CHANNELS.tasks.autoMessage.updateOpenPriceMessages]: (
    accountId: string,
    messages: { content: string; pinTop: boolean }[],
  ) => void
  [IPC_CHANNELS.tasks.autoMessage.getOpenPriceWatcherStatus]: (accountId: string) => boolean
  [IPC_CHANNELS.tasks.autoMessage.openPriceWarmupTriggered]: (accountId: string) => void
  /** 开价监听失效（脚本丢失且自愈失败） */
  [IPC_CHANNELS.tasks.autoMessage.openPriceWatcherLost]: (accountId: string) => void
  /** 开价监听已自动恢复 */
  [IPC_CHANNELS.tasks.autoMessage.openPriceWatcherRestored]: (accountId: string) => void
  [IPC_CHANNELS.tasks.autoMessage.sendOpenPriceMessages]: (
    accountId: string,
    messages: { content: string; pinTop: boolean }[],
  ) => boolean

  // AutoPopup
  [IPC_CHANNELS.tasks.autoPopUp.start]: (accountId: string, config: AutoPopupConfig) => boolean
  [IPC_CHANNELS.tasks.autoPopUp.stop]: (accountId: string) => boolean
  [IPC_CHANNELS.tasks.autoPopUp.stoppedEvent]: (id: string) => void
  [IPC_CHANNELS.tasks.autoPopUp.updateConfig]: (
    accountId: string,
    config: Parital<AutoPopupConfig>,
  ) => void
  [IPC_CHANNELS.tasks.autoPopUp.registerShortcuts]: (
    accountId: string,
    shortcuts: { accelerator: string; goodsIds: number[] }[],
  ) => void
  [IPC_CHANNELS.tasks.autoPopUp.unregisterShortcuts]: () => void

  // AutoReply
  [IPC_CHANNELS.tasks.autoReply.startCommentListener]: (
    accountId: string,
    config: CommentListenerConfig,
  ) => boolean
  [IPC_CHANNELS.tasks.autoReply.stopCommentListener]: (accountId: string) => void
  [IPC_CHANNELS.tasks.autoReply.sendReply]: (accountId: string, replyContent: string) => void
  [IPC_CHANNELS.tasks.autoReply.listenerStopped]: (accountId: string) => void
  [IPC_CHANNELS.tasks.autoReply.showComment]: (data: {
    comment: LiveMessage
    accountId: string
  }) => void

  // AIChat
  [IPC_CHANNELS.tasks.aiChat.normalChat]: (params: {
    messages: AIChatMessage[]
    provider: string
    model: string
    apiKey: string
    customBaseURL?: string
  }) => string | null
  [IPC_CHANNELS.tasks.aiChat.testApiKey]: (params: {
    apiKey: string
    provider: string
    customBaseURL?: string
  }) => { success: boolean; models?: string[]; error?: string }
  [IPC_CHANNELS.tasks.aiChat.chat]: (params: {
    messages: AIChatMessage[]
    provider: string
    model: string
    apiKey: string
    customBaseURL?: string
  }) => void
  [IPC_CHANNELS.tasks.aiChat.stream]: (
    data:
      | {
          chunk: string
          type: 'content' | 'reasoning'
        }
      | { done: boolean },
  ) => void
  [IPC_CHANNELS.tasks.aiChat.error]: (data: { error: string }) => void

  // 视频号上墙
  [IPC_CHANNELS.tasks.pinComment]: (params: { accountId: string; content: string }) => void

  // 一键发红包
  [IPC_CHANNELS.tasks.redPacket.send]: (accountId: string, duration: string) => boolean

  // Updater
  [IPC_CHANNELS.updater.checkUpdate]: () => Promise<
    { latestVersion: string; currentVersion: string; releaseNote?: string } | undefined
  >
  [IPC_CHANNELS.updater.startDownload]: (source: string) => void
  [IPC_CHANNELS.updater.quitAndInstall]: () => void
  [IPC_CHANNELS.updater.updateAvailable]: (info: VersionInfo) => void
  [IPC_CHANNELS.updater.updateError]: (error: ErrorType) => void
  [IPC_CHANNELS.updater.downloadProgress]: (progress: ProgressInfo) => void
  [IPC_CHANNELS.updater.updateDownloaded]: (event?: UpdateDownloadedEvent) => void

  // Chrome
  [IPC_CHANNELS.chrome.selectPath]: () => string | null
  [IPC_CHANNELS.chrome.getPath]: (edge?: boolean) => string | null
  [IPC_CHANNELS.chrome.toggleDevTools]: () => void
  [IPC_CHANNELS.chrome.setPath]: (path: string) => void
  [IPC_CHANNELS.chrome.saveState]: (accountId: string, state: string) => void

  // App
  [IPC_CHANNELS.app.openLogFolder]: () => void
  [IPC_CHANNELS.app.openExternal]: (url: string) => void
  [IPC_CHANNELS.app.notifyUpdate]: (arg: {
    currentVersion: string
    latestVersion: string
    releaseNote?: string
  }) => void
  [IPC_CHANNELS.app.getProviders]: () => Record<string, ProviderInfo>
  [IPC_CHANNELS.app.providersUpdated]: (providers: Record<string, ProviderInfo>) => void
  [IPC_CHANNELS.app.writeLog]: (params: {
    level: 'info' | 'warn' | 'error' | 'success'
    message: string
    scope?: string
  }) => void
  /** 设置应用外观主题（同步系统标题栏明暗） */
  [IPC_CHANNELS.app.setTheme]: (theme: 'light' | 'dark') => void
  /** 返回运行时真实版本号（asar 内 package.json） */
  [IPC_CHANNELS.app.getVersion]: () => string

  [IPC_CHANNELS.account.switch]: (params: { account: Account }) => void

  // 抖音直播数据大屏
  [IPC_CHANNELS.dashboard.getSnapshot]: () => DashboardSnapshot | null
  [IPC_CHANNELS.dashboard.refresh]: () => DashboardSnapshot | null
  [IPC_CHANNELS.dashboard.setConfig]: (
    config: Partial<DouyinDashboardConfig>,
  ) => DouyinDashboardConfig
  [IPC_CHANNELS.dashboard.getConfig]: () => DouyinDashboardConfig
  [IPC_CHANNELS.dashboard.updated]: (snapshot: DashboardSnapshot) => void

  // 直播日报（视觉识别 + 本地 Excel 导出）
  [IPC_CHANNELS.dataEntry.recognize]: (params: {
    images: { path?: string; base64?: string }[]
    config: { provider: string; model: string; apiKey: string; customBaseURL?: string }
    columns?: LiveReportColumn[]
    templateId?: string // 传 'use-saved' 使用已保存的模板
  }) => { values: Record<string, string>; lowConfidence: string[] }
  [IPC_CHANNELS.dataEntry.selectOutputPath]: () => string | null
  [IPC_CHANNELS.dataEntry.exportExcel]: (params: {
    values?: Record<string, string>
    rows?: Record<string, string>[]
    outputPath: string
    columns?: LiveReportColumn[]
  }) => string
  [IPC_CHANNELS.dataEntry.generateTemplate]: (params: {
    outputPath: string
    columns?: LiveReportColumn[]
  }) => string
  [IPC_CHANNELS.dataEntry.getColumns]: () => LiveReportColumn[]
  [IPC_CHANNELS.dataEntry.saveColumns]: (columns: LiveReportColumn[]) => void
  // 视觉模板校准
  [IPC_CHANNELS.dataEntry.calibrateTemplate]: (params: {
    image: { path?: string; base64?: string }
    config: { provider: string; model: string; apiKey: string; customBaseURL?: string }
    knownValues: Record<string, string>
  }) => VisionTemplate
  [IPC_CHANNELS.dataEntry.getTemplate]: () => VisionTemplate | null
  [IPC_CHANNELS.dataEntry.deleteTemplate]: () => void
  // 表单数据持久化
  [IPC_CHANNELS.dataEntry.getRows]: () => DataEntrySavedState | null
  [IPC_CHANNELS.dataEntry.saveRows]: (state: DataEntrySavedState) => void

  // Log
  [IPC_CHANNELS.log]: (message: LogMessage) => void
}

export interface ElectronAPI {
  ipcRenderer: {
    invoke: <Channel extends keyof IpcChannels>(
      channel: Channel,
      ...args: Parameters<IpcChannels[Channel]>
    ) => ReturnType<IpcChannels[Channel]> extends Promise<infer _U>
      ? ReturnType<IpcChannels[Channel]>
      : Promise<ReturnType<IpcChannels[Channel]>>

    send: <Channel extends keyof IpcChannels>(
      channel: Channel,
      ...args: Parameters<IpcChannels[Channel]>
    ) => void

    on: <Channel extends keyof IpcChannels>(
      channel: Channel,
      listener: (...args: Parameters<IpcChannels[Channel]>) => void,
    ) => () => void
  }
}
