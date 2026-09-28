import { Result } from '@praha/byethrow'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { createLogger } from '#/logger'
import { accountManager } from '#/managers/AccountManager'
import { typedIpcMainHandle } from '#/utils'

const TASK_NAME = '自动发言'
const TASK_TYPE = 'auto-comment'

// IPC 处理程序
function setupIpcHandlers() {
  typedIpcMainHandle(IPC_CHANNELS.tasks.autoMessage.start, async (_, accountId, config) => {
    return Result.pipe(
      accountManager.getSession(accountId),
      Result.andThen(accountSession => accountSession.startTask({ type: TASK_TYPE, config })),
      Result.inspectError(error => {
        const logger = createLogger(`@${accountManager.getAccountName(accountId)}`).scope(TASK_NAME)
        logger.error('启动任务失败：', error)
      }),
      r => r.then(Result.isSuccess),
    )
  })

  typedIpcMainHandle(IPC_CHANNELS.tasks.autoMessage.stop, async (_, accountId) => {
    return Result.pipe(
      accountManager.getSession(accountId),
      Result.inspect(accountSession => accountSession.stopTask(TASK_TYPE)),
      Result.inspectError(error => {
        const logger = createLogger(`@${accountManager.getAccountName(accountId)}`).scope(TASK_NAME)
        logger.error('停止任务失败：', error)
      }),
      r => Result.isSuccess(r),
    )
  })

  typedIpcMainHandle(
    IPC_CHANNELS.tasks.autoMessage.sendBatchMessages,
    async (_, accountId, messages, count) => {
      return Result.pipe(
        accountManager.getSession(accountId),
        Result.andThen(accountSession =>
          accountSession.startTask({ type: 'send-batch-messages', config: { messages, count } }),
        ),
        Result.inspectError(error => {
          const logger = createLogger(`@${accountManager.getAccountName(accountId)}`).scope(
            '一键评论',
          )
          logger.error('启动任务失败：', error)
        }),
        r => r.then(Result.isSuccess),
      )
    },
  )

  typedIpcMainHandle(
    IPC_CHANNELS.tasks.autoMessage.updateConfig,
    async (_, accountId, newConfig) => {
      const logger = createLogger(`@${accountManager.getAccountName(accountId)}`).scope(TASK_NAME)
      Result.pipe(
        accountManager.getSession(accountId),
        Result.andThen(accountSession => accountSession.updateTaskConfig(TASK_TYPE, newConfig)),
        Result.inspect(_ => logger.info('更新配置成功')),
        Result.inspectError(error => logger.error('更新配置失败：', error)),
      )
    },
  )

  typedIpcMainHandle(
    IPC_CHANNELS.tasks.autoMessage.startOpenPriceWatcher,
    async (_, accountId, messages) => {
      return Result.pipe(
        accountManager.getSession(accountId),
        Result.andThen(accountSession => accountSession.startOpenPriceWatcher(messages)),
        Result.inspectError(error => {
          const logger = createLogger(`@${accountManager.getAccountName(accountId)}`).scope(
            '开价变预热',
          )
          logger.error('启动开价监听失败：', error)
        }),
        r => r.then(Result.isSuccess),
      )
    },
  )

  typedIpcMainHandle(IPC_CHANNELS.tasks.autoMessage.stopOpenPriceWatcher, async (_, accountId) => {
    Result.pipe(
      accountManager.getSession(accountId),
      Result.inspect(accountSession => accountSession.stopOpenPriceWatcher()),
      Result.inspectError(error => {
        const logger = createLogger(`@${accountManager.getAccountName(accountId)}`).scope(
          '开价变预热',
        )
        logger.error('停止开价监听失败：', error)
      }),
    )
  })

  // 跨平台开价联动：让指定账号直接把开价话术发出去，不启动任何监听。
  // 触发源（如巨量百应）检测到开价后，由渲染层并行通知各跟随平台调用此接口。
  typedIpcMainHandle(
    IPC_CHANNELS.tasks.autoMessage.sendOpenPriceMessages,
    async (_, accountId, messages) => {
      if (!messages || messages.length === 0) {
        return false
      }
      return Result.pipe(
        accountManager.getSession(accountId),
        Result.andThen(accountSession =>
          accountSession.startTask({
            type: 'send-open-price-messages',
            config: { messages },
          }),
        ),
        Result.inspect(() => {
          const logger = createLogger(`@${accountManager.getAccountName(accountId)}`).scope(
            '开价联动',
          )
          logger.success(`联动发送开价话术 ${messages.length} 条`)
        }),
        Result.inspectError(error => {
          const logger = createLogger(`@${accountManager.getAccountName(accountId)}`).scope(
            '开价联动',
          )
          logger.error('联动发送开价话术失败：', error)
        }),
        r => r.then(Result.isSuccess),
      )
    },
  )

  // 查询开价监听的真实运行状态。
  // 渲染层切换页面会导致组件重新挂载，本地的运行状态会丢失，
  // 因此必须以主进程为准来回查，否则界面会显示「未开启」但实际仍在监听。
  typedIpcMainHandle(
    IPC_CHANNELS.tasks.autoMessage.getOpenPriceWatcherStatus,
    async (_, accountId) => {
      return Result.pipe(
        accountManager.getSession(accountId),
        Result.map(accountSession => accountSession.isOpenPriceWatcherRunning()),
        r => Result.isSuccess(r) && r.value,
      )
    },
  )

  typedIpcMainHandle(
    IPC_CHANNELS.tasks.autoMessage.updateOpenPriceMessages,
    async (_, accountId, messages) => {
      Result.pipe(
        accountManager.getSession(accountId),
        Result.inspect(accountSession => accountSession.updateOpenPriceMessages(messages)),
        Result.inspectError(error => {
          const logger = createLogger(`@${accountManager.getAccountName(accountId)}`).scope(
            '开价变预热',
          )
          logger.error('更新开价话术失败：', error)
        }),
      )
    },
  )
}

export function setupAutoMessageIpcHandlers() {
  setupIpcHandlers()
}
