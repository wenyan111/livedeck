import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { createLogger } from '#/logger'
import { accountManager } from '#/managers/AccountManager'
import { providerService } from '#/services/ProviderService'
import { typedIpcMainHandle } from '#/utils'

function setupIpcHandlers() {
  typedIpcMainHandle(IPC_CHANNELS.chrome.toggleDevTools, event => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools()
      } else {
        win.webContents.openDevTools()
      }
    }
  })

  typedIpcMainHandle(IPC_CHANNELS.app.openLogFolder, () => {
    shell.openPath(app.getPath('logs'))
  })

  typedIpcMainHandle(IPC_CHANNELS.app.openExternal, (_, url: string) => {
    shell.openExternal(url)
  })

  typedIpcMainHandle(IPC_CHANNELS.app.getProviders, () => {
    return providerService.providers
  })

  typedIpcMainHandle(IPC_CHANNELS.account.switch, (_, { account }) => {
    accountManager.setAccountName(account.id, account.name)
  })

  // 同步系统窗口（macOS 标题栏）明暗，跟随应用内的深色背景设置
  typedIpcMainHandle(IPC_CHANNELS.app.setTheme, (_, theme: 'light' | 'dark') => {
    nativeTheme.themeSource = theme
  })

  typedIpcMainHandle(IPC_CHANNELS.app.writeLog, (_, { level, message, scope }) => {
    const logger = createLogger(scope ?? 'App')
    if (level === 'error') {
      logger.error(message)
    } else if (level === 'warn') {
      logger.warn(message)
    } else if (level === 'success') {
      logger.success(message)
    } else {
      logger.info(message)
    }
  })
}

export function setupAppIpcHandlers() {
  setupIpcHandlers()
}
