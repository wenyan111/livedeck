import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'
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
    // 极少数情况下 app 尚未就绪，后续 resolvePath 会再次尝试
  }
}
ensureLogsDir()
const fileTransport = electronLog.transports.file
const defaultResolvePath = fileTransport.resolvePath
fileTransport.resolvePath = variables => {
  ensureLogsDir()
  return defaultResolvePath
    ? defaultResolvePath.call(fileTransport, variables)
    : app.getPath('logs')
}

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
