// utils/windowManager.js
import { type BrowserWindow, session } from 'electron'
import type { IpcChannels } from 'shared/electron-api'

class WindowManager {
  private mainWindow?: BrowserWindow
  /** 用户已确认关闭 / 自动更新要重启安装：跳过「关闭确认」弹窗 */
  private forceQuit = false

  markForceQuit() {
    // 自动更新会直接重启进程；先强制把 localStorage 等 DOMStorage 落盘，
    // 否则重启后配置会整片回退（2026-11-07 两次「规则全没了」事故）。
    // 只刷盘、不拦截退出流程，避免干扰 electron-updater 的安装器启动。
    try {
      session.defaultSession.flushStorageData()
    } catch {
      // 刷盘失败也不能卡住更新
    }
    this.forceQuit = true
  }

  get isForceQuit() {
    return this.forceQuit
  }

  setMainWindow(win: BrowserWindow) {
    this.mainWindow = win

    // 自动清理引用
    win.on('closed', () => {
      this.mainWindow = undefined
    })
  }

  send<Channel extends keyof IpcChannels>(
    channel: Channel,
    ...args: Parameters<IpcChannels[Channel]>
  ): boolean {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, ...args)
      return true
    }
    return false
  }
}

export default new WindowManager()
