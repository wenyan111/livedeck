import * as fs from 'node:fs'
import * as path from 'node:path'
import { app, BrowserWindow } from 'electron'
import electronLog, { type FormatParams, type LogFunctions } from 'electron-log'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import windowManager from './windowManager'

// 日志目录自愈：腾讯柠檬等清理工具会删除 ~/Library/Logs/<appName>，
// 导致 electron-log 的 file transport 写盘失败（Can't write to ...）。
// 启动时创建目录，并让 file transport 每次解析路径前也确保目录存在，
// 这样即使被外部删除，下一次写日志也会自动重建目录、恢复落盘。
function ensureLogsDir() {
  try {
    fs.mkdirSync(app.getPath('logs'), { recursive: true })
  } catch {
    // 极少数情况下 app 尚未就绪，后续 resolvePathFn 会再次尝试
  }
}
ensureLogsDir()
const fileTransport = electronLog.transports.file
// ⚠️ 必须覆写 resolvePathFn（electron-log v5 真正使用的属性）。
// 早期版本误覆写了 resolvePath：该属性默认并不存在，赋上它反而会被 electron-log
// 当成「用户自定义路径函数」替换掉默认的 resolvePathFn，而当时返回的是
// app.getPath('logs')（目录而非文件），导致每次写日志都 EISDIR 失败——
// 表现为 main.log 从装上那一秒起就一行都不再增长。
const defaultResolvePathFn = fileTransport.resolvePathFn
fileTransport.resolvePathFn = (variables, message) => {
  ensureLogsDir()
  return defaultResolvePathFn
    ? defaultResolvePathFn.call(fileTransport, variables, message)
    : path.join(app.getPath('logs'), 'main.log')
}

/**
 * 系统级提醒：出现警告/失败时让窗口「引起注意」。
 *   Windows：任务栏按钮闪烁（flashFrame），点回窗口就停
 *   macOS：Dock 图标跳一下 + 角标打一个标记（点回窗口清掉）
 *
 * 30 秒内只提醒一次，避免断播后上百条警告把 Dock 弹成迪斯科。
 */
let lastAttentionAt = 0
function triggerAttention(level: string) {
  // level 目前只用于日志，角标统一显示「!」
  void level
  const now = Date.now()
  if (now - lastAttentionAt < 30_000) return
  lastAttentionAt = now
  try {
    const win = BrowserWindow.getAllWindows()[0]
    if (process.platform === 'win32') {
      win?.flashFrame(true)
      setTimeout(() => win?.flashFrame(false), 10_000)
    } else if (process.platform === 'darwin') {
      app.dock?.bounce('informational')
      // 统一用「!」：警告和失败都足够醒目（用户 2026-11-05：角标要用感叹号）
      app.dock?.setBadge('!')
    }
  } catch {
    // 提醒失败不影响主流程
  }
}

electronLog.hooks.push(message => {
  if (message.level === 'warn' || message.level === 'error') {
    triggerAttention(message.level)
  }
  return message
})

// 用户回到窗口就把角标/闪烁清掉
app.on('browser-window-focus', () => {
  try {
    app.dock?.setBadge('')
    for (const w of BrowserWindow.getAllWindows()) w.flashFrame(false)
  } catch {
    // 忽略
  }
})

const appRoot = path.join(app.getAppPath(), path.sep)
const cleanPathRegex = new RegExp(appRoot.replace(/\\/g, '\\\\').replace(/\//g, '[\\\\/]'), 'gi')

function cleanStack(stack?: string) {
  if (!stack) return stack
  return stack.replace(cleanPathRegex, `APP:${path.sep}`)
}

function formatLogData(data: FormatParams['data'], _level: FormatParams['level']) {
  function errorMessage(item: Error) {
    return `${item.message}\n${cleanStack(item.stack)}${item.cause ? `\nCaused by: ${item.cause}` : ''}`
  }
  return data.map(item => (item instanceof Error ? errorMessage(item) : item)).join(' ')
}

// [2025-02-11 07:30:03.037] [中控台] » INFO         启动中……
electronLog.transports.console.format = ({ data, level, message }) => {
  // TODO: error 有可能是：message + Error 的形式，如果带有 Error，要记录堆栈信息
  const text = formatLogData(data, level)
  // 不放 hooks 里了，这样少一次 format 计算
  if (level !== 'verbose' && level !== 'debug') {
    windowManager.send(IPC_CHANNELS.log, { ...message, data: [text] })
  }
  return [
    `[${message.date.toLocaleString()}]`,
    message.scope ? `[${message.scope}]` : '',
    '»',
    `${level.toUpperCase()}`,
    `\t${text}`,
  ]
}
electronLog.transports.file.format = ({ data, level, message }) => {
  const text = formatLogData(data, level)
  return [
    `[${message.date.toISOString().replace('T', ' ').slice(0, -1)}]`,
    `[${level.toUpperCase()}]`,
    message.scope ? `[${message.scope}]` : '',
    `\t${text}`,
  ]
}
electronLog.scope.labelPadding = false
electronLog.addLevel('success', 3)

export interface ScopedLogger extends LogFunctions {
  scope(name: string): ScopedLogger
}

export function createLogger(name: string): ScopedLogger {
  const logger = electronLog.scope(name)
  return {
    scope(scopeName: string) {
      const newScopeName = `${name} -> ${scopeName}`
      return createLogger(newScopeName)
    },
    ...logger,
  }
}

export default electronLog
