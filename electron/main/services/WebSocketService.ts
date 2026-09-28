import { WebSocketServer } from 'ws'
import { createLogger } from '#/logger'

const DEFAULT_PORT = 12354

/**
 * WebSocket 服务单例：所有平台（小红书/视频号/快手等）共享同一个服务实例，
 * 避免多平台同时启动监听时端口冲突（EADDRINUSE）。
 */
let _singleton: WebSocketService | null = null

export function getWebSocketService(): WebSocketService {
  if (!_singleton) {
    _singleton = new WebSocketService()
  }
  return _singleton
}

export class WebSocketService {
  private wss: WebSocketServer | null = null
  private logger: ReturnType<typeof createLogger>

  constructor() {
    this.logger = createLogger('WebSocket服务')
  }

  start(port: number) {
    return new Promise<void>((resolve, reject) => {
      let _port = port
      if (!port || Number.isNaN(port) || port < 0 || !Number.isInteger(port)) {
        _port = DEFAULT_PORT
      }
      if (this.wss) {
        // 本实例已在运行（同一端口），直接复用
        this.logger.warn('WebSocket服务已在运行')
        return resolve()
      }
      const server = new WebSocketServer({ port: _port })

      const startErrorHandler = (err: Error) => {
        this.logger.error('WebSocket服务启动失败', err)
        this.wss = null
        server.close()
        reject(err)
      }
      // 如果端口被占用会报错
      server.once('error', startErrorHandler)
      server.once('listening', () => {
        this.logger.success(`WebSocket服务已启动，端口: ${_port}`)
        server.off('error', startErrorHandler)
        resolve()
      })
      server.on('connection', ws => {
        this.logger.info('客户端已连接')
        ws.on('close', () => {
          this.logger.info('客户端已断开')
        })
      })
      this.wss = server
    })
  }

  broadcast<T>(data: T) {
    if (!this.wss) return

    const message = JSON.stringify(data)
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message)
      }
    }
  }

  stop(reason?: unknown) {
    if (this.wss) {
      this.wss.close()
      this.wss = null
      this.logger.info('WebSocket服务已停止', reason)
    }
  }

  /** 检查服务是否正在运行 */
  get isRunning() {
    return this.wss !== null
  }
}
