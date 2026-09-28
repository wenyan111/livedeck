import { Result } from '@praha/byethrow'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import type { ScopedLogger } from '#/logger'
import type { ICommentListener } from '#/platforms/IPlatform'
import { getWebSocketService } from '#/services/WebSocketService'
import { MessageDeduplicator } from '#/utils/dedup'
import windowManager from '#/windowManager'
import { createTask } from './BaseTask'
import { TaskStopReason } from './ITask'

const TASK_NAME = '自动回复'

export function createCommentListenerTask(
  platform: ICommentListener,
  config: CommentListenerConfig,
  account: Account,
  _logger: ScopedLogger,
) {
  const logger = _logger.scope(TASK_NAME)
  // 使用全局单例，所有平台共享同一个 WebSocket 服务，避免端口冲突
  const wsService = getWebSocketService()
  let wsStartedByThisTask = false
  /** 出口去重：跨监听器实例的最后一道防线 */
  const dedup = new MessageDeduplicator()

  async function execute() {
    try {
      if (config.ws) {
        if (!wsService.isRunning) {
          wsStartedByThisTask = true
          wsService.start(config.ws.port).catch(err => {
            wsService.stop(err)
          })
        } else {
          logger.info('WebSocket 服务已在运行（其他平台已启动），复用现有连接')
        }
      }
      await platform.startCommentListener(broadcastMessage, config.source)
      logger.info('开始监听评论')
    } catch (err) {
      // 失败了还要告诉渲染层关闭按钮
      windowManager.send(IPC_CHANNELS.tasks.autoReply.listenerStopped, account.id)
      task.stop(TaskStopReason.ERROR, err)
    }
  }

  function broadcastMessage(message: LiveMessage) {
    // 出口兜底去重：这里是所有评论推送给界面 / WebSocket 的唯一通道。
    // 监听器实例各自维护去重窗口，万一出现「同一页面上挂了两个监听器」
    // （历史 bug：重复启动时旧实例没被停掉），各自去重就形同虚设。
    // 在出口再拦一道，无论上游有几个实例，界面都只会收到一条。
    if (!dedup.isNew(message.msg_id)) {
      return
    }
    const comment: LiveMessage = {
      ...message,
      time: Date.now(),
    }
    windowManager.send(IPC_CHANNELS.tasks.autoReply.showComment, {
      accountId: account.id,
      comment: comment,
    })

    wsService.broadcast(comment)
  }

  function updateConfig(cfg: Partial<CommentListenerConfig>) {
    if (cfg.ws && cfg.ws.port !== config.ws?.port) {
      config.ws = cfg.ws
      wsService.stop()
      wsStartedByThisTask = true
      wsService.start(config.ws.port).catch(err => {
        wsService.stop(err)
      })
    }
    if (cfg.source && config.source !== cfg.source) {
      config.source = cfg.source
      platform.stopCommentListener()
      platform.startCommentListener(broadcastMessage, cfg.source)
    }
    return Result.succeed()
  }

  const task = createTask(
    {
      taskName: TASK_NAME,
      logger,
    },
    {
      onStart: async () => {
        await execute()
      },
      onStop: () => {
        platform.stopCommentListener()
        // 只有本任务启动的 WebSocket 才由本任务停止；
        // 其他平台还在用的话不能关，否则它们的 broadcast 会静默失败。
        if (wsStartedByThisTask) {
          wsService.stop()
          wsStartedByThisTask = false
        }
      },
    },
  )

  return Result.succeed({
    ...task,
    updateConfig,
  })
}
