import { Result } from '@praha/byethrow'
import type { ScopedLogger } from '#/logger'
import { type IPlatform, isPerformComment, isPinComment } from '#/platforms/IPlatform'
import { withCommentSendLock } from '#/platforms/sendLock'
import { replaceVariant, sleep } from '#/utils'
import { createTask } from './BaseTask'
import { TaskStopReason } from './ITask'

const TASK_NAME = '开价话术'

/**
 * 单条话术的最大尝试次数。
 * 之前任一条发送失败就直接 `stop(ERROR)`，导致**后面的话术一条都不发**（用户反馈的
 * 「从某条起后面全没有」就是这个原因）。改为失败重试，重试仍失败则跳过继续。
 */
const MAX_ATTEMPTS_PER_MESSAGE = 3
/** 同一条话术两次尝试之间的等待 */
const RETRY_INTERVAL_MS = 2000
/**
 * 连续失败多少条后放弃本次发送。
 * 偶尔一条失败可以跳过，但如果连续多条都失败，多半是中控台页面已失效 /
 * 浏览器掉线，继续重试只是无意义空转。
 */
const MAX_CONTINUOUS_FAILURES = 3
/**
 * 相邻两条话术之间的间隔。
 * 各平台公屏发言都有频率限制（普遍 3~5 秒），之前只等 1 秒，
 * 后续几条容易被平台静默吞掉（发送动作报成功、公屏却没有），
 * 表现为「第 1 条有、后面全没有」。
 */
const INTER_MESSAGE_INTERVAL_MS = 3000
/**
 * 各平台公屏发言频率限制不同。快手对连发最严格（1~2 条连发常被静默吞掉，
 * 表现为「第 1 条有、第 2 条没有」），给它更长的间隔以避开冷却。
 */
const INTER_MESSAGE_INTERVAL_BY_PLATFORM: Record<string, number> = {
  快手小店: 6000,
  小红书: 6000,
}
/** 上墙（置顶评论）的最大尝试次数与等待间隔 */
const PIN_MAX_ATTEMPTS = 3
const PIN_WAIT_MS = 2500

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
      const interMessageInterval =
        INTER_MESSAGE_INTERVAL_BY_PLATFORM[commentPlatform.platformName] ??
        INTER_MESSAGE_INTERVAL_MS
      /** 本次未成功发出的条号（1 起），结束时汇总提示 */
      const failedIndexes: number[] = []
      let continuousFailures = 0

      for (let i = 0; i < messages.length; i++) {
        if (!task.isRunning()) {
          break
        }
        const message = replaceVariant(messages[i].content)
        const pinTop = messages[i].pinTop

        // 单条失败不再中断整串：重试若干次，仍失败才跳过继续
        let sent = false
        let lastError: unknown
        for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MESSAGE; attempt++) {
          if (!task.isRunning()) {
            break
          }
          // 与「自动回复」串行：两者都会写同一个评论输入框，并发会互相覆盖
          // （用户实测：开价话术发送时观众评论刚好进来，AI 回复被吞）2026-10-29
          const result = await withCommentSendLock(commentPlatform, () =>
            commentPlatform.performComment(message, pinTop),
          )
          if (Result.isSuccess(result)) {
            sent = true
            break
          }
          lastError = result.error
          if (attempt < MAX_ATTEMPTS_PER_MESSAGE) {
            logger.warn(
              `第 ${i + 1}/${messages.length} 条话术第 ${attempt}/${MAX_ATTEMPTS_PER_MESSAGE} 次发送失败，${RETRY_INTERVAL_MS / 1000} 秒后重试：${lastError}`,
            )
            await sleep(RETRY_INTERVAL_MS)
          }
        }

        if (!task.isRunning()) {
          break
        }

        if (!sent) {
          failedIndexes.push(i + 1)
          continuousFailures += 1
          logger.error(
            `第 ${i + 1}/${messages.length} 条话术发送失败（已尝试 ${MAX_ATTEMPTS_PER_MESSAGE} 次），跳过并继续后续话术：${lastError}`,
          )
          if (continuousFailures >= MAX_CONTINUOUS_FAILURES) {
            logger.error(
              `已连续 ${continuousFailures} 条话术发送失败，判定中控台页面异常，停止本次开价话术发送`,
            )
            break
          }
        } else {
          continuousFailures = 0
          logger.success(
            `成功发送第 ${i + 1}/${messages.length} 条话术：${message}${pinTop ? '（请求置顶）' : ''}`,
          )
          // 抖音 / 快手等平台由 performComment 直接置顶；视频号等平台需额外「上墙」。
          if (pinTop && isPinComment(commentPlatform)) {
            let pinned = false
            for (let attempt = 1; attempt <= PIN_MAX_ATTEMPTS; attempt++) {
              // 等刚发送的评论渲染到公屏评论列表，再按内容匹配上墙
              await sleep(PIN_WAIT_MS)
              const pinResult = await commentPlatform.pinComment(message)
              if (Result.isSuccess(pinResult)) {
                pinned = true
                break
              }
              lastError = pinResult.error
            }
            if (pinned) {
              logger.success(`第 ${i + 1} 条话术已上墙`)
            } else {
              logger.warn(`第 ${i + 1} 条话术上墙失败：${lastError}`)
            }
          }
        }
        // 相邻两条之间留足间隔，避开平台公屏发言频率限制
        await sleep(interMessageInterval)
      }

      if (failedIndexes.length > 0 && task.isRunning()) {
        logger.warn(
          `本次开价话术共 ${messages.length} 条，其中第 ${failedIndexes.join('、')} 条未能发出，请留意公屏`,
        )
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
