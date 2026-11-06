// utils/windowManager.js
import type { BrowserWindow } from 'electron'
import type { IpcChannels } from 'shared/electron-api'

class WindowManager {
  private mainWindow?: BrowserWindow
  /** 用户已确认关闭 / 自动更新要重启安装：跳过「关闭确认」弹窗 */
  private forceQuit = false

  markForceQuit() {
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
