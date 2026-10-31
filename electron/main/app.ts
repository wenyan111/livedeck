import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { emitter } from './event/eventBus'
import { updateManager } from './managers/UpdateManager'
import { douyinDashboardService } from './services/DouyinDashboardService'
import { providerService } from './services/ProviderService'
import windowManager from './windowManager'
import './ipc'
import { createLogger } from './logger'
import { accountManager } from './managers/AccountManager'

// const _require = createRequire(import.meta.url)

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.mjs   > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//

function createBoxedString(lines: string[]) {
  // 1. 计算最长的一行文字长度
  const maxLength = Math.max(...lines.map(line => line.length))

  // 2. 定义边框样式
  // 顶部和底部边框 (例如: +----------------+)
  const horizontalLine = `+${'-'.repeat(maxLength + 2)}+`

  // 3. 生成中间的内容行
  const content = lines
    .map(line => {
      // 使用 padEnd 补齐空格，使得右边框对齐
      return `| ${line.padEnd(maxLength)} |`
    })
    .join('\n')

  // 4. 拼接结果
  return `\n${horizontalLine}\n${content}\n${horizontalLine}`
}

function logStartupInfo() {
  const appInfo = [
    `App Name:     ${app.getName()}`,
    `App Version:  ${app.getVersion()}`,
    `Electron Ver: ${process.versions.electron}`,
    `Node Ver:     ${process.versions.node}`,
    `Platform:     ${process.platform} (${process.arch})`,
    `Environment:  ${app.isPackaged ? 'Production' : 'Development'}`,
  ]
  const logger = createLogger('startup')
  logger.debug(createBoxedString(appInfo))
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '../..')

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

app.commandLine.appendSwitch('remote-debugging-port', '9222')

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
const preload = path.join(__dirname, '../preload/index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')

async function createWindow() {
  win = new BrowserWindow({
    title: `LiveDeck・直播台 - v${app.getVersion()}`,
    width: 1280,
    height: 800,
    autoHideMenuBar: app.isPackaged,
    icon: path.join(process.env.VITE_PUBLIC, 'favicon.ico'),
    webPreferences: {
      preload,
      // Warning: Enable nodeIntegration and disable contextIsolation is not secure in production
      // nodeIntegration: true,
      nodeIntegration: process.env.NODE_ENV === 'development',
      // Consider using contextBridge.exposeInMainWorld
      // Read more on https://www.electronjs.org/docs/latest/tutorial/context-isolation
      // contextIsolation: false,
    },
  })

  windowManager.setMainWindow(win)

  /**
   * 窗口变小时**整页等比缩放**，而不是让布局重排挤压。
   *
   * 原理：页面 CSS 布局视口宽 = 窗口内容宽 / zoomFactor。按 1280 的基准宽算系数，
   * 布局宽就恒定在 1280 —— 列宽、间距、字号全部同比例缩小，界面不变形
   * （等价于浏览器 Ctrl+- 缩放，但由窗口宽度自动驱动）。
   *
   * 下限 0.7：再小字就看不清了，那时才回落到普通响应式布局（页面里有 max-xl: 的折叠样式兜底）。
   */
  const ZOOM_BASE_WIDTH = 1280
  const ZOOM_MIN_FACTOR = 0.7
  const applyZoom = () => {
    if (!win || win.isDestroyed()) return
    const [contentWidth] = win.getContentSize()
    const factor = Math.min(1, Math.max(ZOOM_MIN_FACTOR, contentWidth / ZOOM_BASE_WIDTH))
    win.webContents.setZoomFactor(Number(factor.toFixed(2)))
  }
  // 拖动窗口边会高频触发 resize，节流一下再算
  let zoomTimer: NodeJS.Timeout | null = null
  win.on('resize', () => {
    if (zoomTimer) clearTimeout(zoomTimer)
    zoomTimer = setTimeout(applyZoom, 80)
  })
  // 首次加载完立刻按当前尺寸缩一次（窗口可能被记住的尺寸直接开成小的）
  win.webContents.on('did-finish-load', applyZoom)

  if (VITE_DEV_SERVER_URL) {
    // #298
    win.loadURL(VITE_DEV_SERVER_URL)
    // Open devTool if the app is not packaged
    win.webContents.openDevTools()
  } else {
    win.loadFile(indexHtml)
  }

  // 加载完成后检查更新
  win.webContents.on('did-finish-load', async () => {
    await updateManager.silentCheckForUpdate()
  })

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 当返回最新 providers 时推送到渲染进程
  emitter.on('providers-updated', providers => {
    win?.webContents.send(IPC_CHANNELS.app.providersUpdated, providers)
  })
}

app
  .whenReady()
  .then(logStartupInfo)
  .then(() => providerService.initialize())
  .then(() => douyinDashboardService.start())
  .then(createWindow)

app.on('window-all-closed', async () => {
  win = null
  accountManager.cleanup()
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})

process.on('uncaughtException', error => {
  const logger = createLogger('uncaughtException')
  logger.error('--------------意外的未捕获异常---------------')
  logger.error(error)
  logger.error('---------------------------------------------')

  dialog.showErrorBox(
    '应用程序错误',
    `发生了一个意外的错误，请前往 Github Issue 页面反馈：\n${error.message}`,
  )
})

process.on('unhandledRejection', reason => {
  // playwright-extra 插件问题：在 browser.close() 时概率触发
  // https://github.com/berstend/puppeteer-extra/issues/858
  const logger = createLogger('unhandledRejection')
  if (
    reason instanceof Error &&
    reason.message.includes('cdpSession.send: Target page, context or browser has been closed')
  ) {
    return logger.verbose(reason)
  }

  logger.error('--------------未被处理的错误---------------')
  logger.error(reason)
  logger.error('-------------------------------------------')
})

// New window example arg: new windows url
ipcMain.handle('open-win', (_, arg) => {
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    childWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`)
  } else {
    childWindow.loadFile(indexHtml, { hash: arg })
  }
})
