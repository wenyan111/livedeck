import { Result } from '@praha/byethrow'
import type { ScopedLogger } from '#/logger'
import { isPerformComment, isPinComment, type IPlatform } from '#/platforms/IPlatform'
import { replaceVariant, sleep } from '#/utils'
import { createTask } from './BaseTask'
import { TaskStopReason } from './ITask'

const TASK_NAME = '开价话术'

/**
 * 开价变预热时，按顺序把配置的话术发送到直播间公屏。
 * 不做随机、不插入空格（话术内容原样发送）。首条是否置顶由 config 中的 pinTop 决定。
 *
 * 置顶/上墙策略因平台而异：
 * - 抖音等平台：performComment 内部已处理置顶（勾选置顶框），无需额外操作。
 * - 视频号等平台：performComment 仅发送评论，需发送后再调用 pinComment 把该条「上墙」。
 */
export function createOpenPriceMessageTask(
  platform: IPlatform,
  config: OpenPriceMessagesConfig,
  _logger: ScopedLogger,
) {
  const logger = _logger.scope(TASK_NAME)

  if (!isPerformComment(platform)) {
    logger.error('当前平台不支持发送评论，无法执行开价话术')
    return Result.fail(new Error('平台不支持发送评论'))
  }
  const commentPlatform = platform

  async function execute() {
    try {
      const { messages } = config
      for (let i = 0; i < messages.length; i++) {
        if (!task.isRunning()) {
          break
        }
        const message = replaceVariant(messages[i].content)
        const pinTop = messages[i].pinTop
        const result = await commentPlatform.performComment(message, pinTop)
        if (Result.isFailure(result)) {
          return task.stop(TaskStopReason.ERROR, result.error)
        }
        logger.success(
          `成功发送第 ${i + 1}/${messages.length} 条话术：${message}${pinTop ? '（已置顶）' : ''}`,
        )
        // 抖音等平台由 performComment 直接置顶；视频号等平台需额外「上墙」。
        if (pinTop && isPinComment(commentPlatform)) {
          // 等待刚发送的评论渲染到公屏评论列表，再按内容匹配上墙
          await sleep(1500)
          const pinResult = await commentPlatform.pinComment(message)
          if (Result.isFailure(pinResult)) {
            logger.warn(`第 ${i + 1} 条话术上墙失败：${pinResult.error}`)
          } else {
            logger.success(`第 ${i + 1} 条话术已上墙`)
          }
        }
        // 以防万一，加一个 1s 的小停顿
        await sleep(1000)
      }
      task.stop(TaskStopReason.COMPLETED)
    } catch (error) {
      task.stop(TaskStopReason.ERROR, error)
    }
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
    },
  )

  return Result.succeed({
    ...task,
  })
}
