import { Result } from '@praha/byethrow'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { TaskNotSupportedError } from '#/errors/AppError'
import { emitter } from '#/event/eventBus'
import { createLogger } from '#/logger'
import {
  type BrowserSession,
  browserManager,
  type StorageState,
} from '#/managers/BrowserSessionManager'
import { platformFactory } from '#/platforms'
import {
  type IPlatform,
  isCommentListener,
  isOpenPriceWatcher,
  isPerformComment,
  isPerformPopup,
  isPinComment,
  isSendRedPacket,
} from '#/platforms/IPlatform'
import {
  supportsOpenPriceSelfHealing,
  WATCHER_HEALTH_CHECK_INTERVAL_MS,
} from '#/platforms/openPriceWatcher'
import { createAutoCommentTask } from '#/tasks/AutoCommentTask'
import { createAutoPopupTask } from '#/tasks/AutoPopupTask'
import { createCommentListenerTask } from '#/tasks/CommentListenerTask'
import type { ITask } from '#/tasks/ITask'
import { createOpenPriceMessageTask } from '#/tasks/OpenPriceMessageTask'
import { createPinCommentTask } from '#/tasks/PinCommentTask'
import { createSendBatchMessageTask } from '#/tasks/SendBatchMessageTask'
import windowManager from '#/windowManager'

/** 连续多少次检查到监听失效才判定为「真的失效」（避免偶发抖动误报） */
const OPEN_PRICE_MISS_THRESHOLD = 2

/**
 * 断线后值得自动恢复的任务类型。
 * 只包含「常驻型」任务：自动发言 / 自动弹窗 / 自动回复。
 * 一次性任务（一键评论、开价话术发送、置顶评论）恢复没有意义。
 */
const RESUMABLE_TASK_TYPES: LiveControlTask['type'][] = [
  'auto-comment',
  'auto-popup',
  'comment-listener',
]

/**
 * 发送锁的兜底超时。
 * 正常情况下 2 条话术几秒就发完；如果页面无响应导致任务卡住，
 * `openPriceSending` 会永远不释放 —— 那样之后点开价都不会有任何反应。
 * 超过这个时长就强制释放，宁可偶尔重复一次，也不能彻底失效。
 */
const OPEN_PRICE_SEND_TIMEOUT_MS = 120_000

export class AccountSession {
  private platform: IPlatform
  private browserSession: BrowserSession | null = null
  private activeTasks: Map<LiveControlTask['type'], ITask> = new Map()

  // 开价变预热监听状态
  private openPriceMessages: { content: string; pinTop: boolean }[] = []
  private openPriceRunning = false
  /** 开价话术是否正在发送中（防重入） */
  private openPriceSending = false
  /** 本次发送开始的时间戳，用于发送锁的卡死兜底 */
  private openPriceSendingSince = 0
  /** 监听健康检查定时器 */
  private openPriceHealthTimer: NodeJS.Timeout | null = null
  /** 连续检测到监听失效的次数 */
  private openPriceMissCount = 0

  constructor(
    platformName: LiveControlPlatform,
    private account: Account,
    private logger = createLogger(`@${account.name}`),
  ) {
    this.platform = new platformFactory[platformName]()
  }

  async connect(config: { headless?: boolean; storageState?: string }) {
    let storageState: StorageState
    if (config.storageState) {
      this.logger.info('检测到已保存登录状态')
      storageState = JSON.parse(config.storageState)
    }

    this.browserSession = await browserManager.createSession(config.headless, storageState)

    await this.ensureAuthenticated(this.browserSession, config.headless)

    const state = JSON.stringify(await this.browserSession.context.storageState())

    // 登录成功之后马上先保存一次登录状态，确保后续发生意外后不用重新登录
    windowManager.send(IPC_CHANNELS.chrome.saveState, this.account.id, state)

    // 此时可以确保正在中控台页面，获取用户名
    // 获取用户名不应该和连接中控台的行为冲突
    this.platform
      .getAccountName(this.browserSession)
      .then(accountName => {
        windowManager.send(IPC_CHANNELS.tasks.liveControl.notifyAccountName, {
          ok: true,
          accountId: this.account.id,
          accountName,
        })
      })
      .catch(error => {
        this.logger.error('获取用户名失败：', error)
        windowManager.send(IPC_CHANNELS.tasks.liveControl.notifyAccountName, {
          ok: false,
        })
      })

    // 浏览器被外部主动关闭时，程序自动断开所有操作
    // 不用 browserContext close 或 browser disconnected 的原因：
    // Windows 手动关闭浏览器时（点击右上角的x或标签页的x）无法触发相应事件
    // 只会触发 page close，所以没办法
    this.browserSession.page.on('close', () => {
      emitter.emit('page-closed', { accountId: this.account.id })
    })
    this.logger.success('成功与中控台建立连接')
  }

  disconnect() {
    this.logger.warn('与中控台断开连接')

    // 断线前先把「哪些功能还在跑」记下来一并带给渲染层。
    // 断线（浏览器被关 / 网络抖动）会把所有任务都停掉，如果界面状态不跟着复位，
    // 就会出现「以为自动回复还在监听，其实早就停了」——一条弹幕都进不来。
    // 渲染层拿到这份清单后：①复位界面状态 ②重连成功后自动恢复现场。
    const resumableTaskTypes = this.collectResumableTaskTypes()

    // 关闭开价变预热监听（浏览器即将关闭）
    this.stopOpenPriceWatcher()
    // 通过程序关闭浏览器（并非多余的操作，因为 MacOS 的 context 关闭时不会关闭浏览器进程）
    this.browserSession?.browser.close().catch(e => this.logger.error('无法关闭浏览器：', e))
    // 关闭所有正在进行的任务
    Array.from(this.activeTasks.values()).forEach(task => {
      task.stop()
    })
    this.activeTasks.clear()
    // 通知渲染层
    windowManager.send(
      IPC_CHANNELS.tasks.liveControl.disconnectedEvent,
      this.account.id,
      resumableTaskTypes,
    )
  }

  /**
   * 断线瞬间仍在运行的、值得重连后恢复的任务类型。
   * 一次性任务（一键评论 / 发送话术等）不在此列。
   */
  private collectResumableTaskTypes(): string[] {
    const types: string[] = []
    for (const type of RESUMABLE_TASK_TYPES) {
      if (this.activeTasks.get(type)?.isRunning()) {
        types.push(type)
      }
    }
    // 开价监听不是任务，而是常驻的页面内监听，单独判断
    if (this.openPriceRunning) {
      types.push('open-price')
    }
    return types
  }

  private async ensureAuthenticated(session: BrowserSession, headless = true) {
    this.browserSession = session
    const isConnected = await this.platform.connect(this.browserSession)
    // 未登录，需要等待登录
    if (!isConnected) {
      // 无头模式，需要先关闭原先的无头模式，启用有头模式给用户登录
      if (headless) {
        await this.browserSession.browser.close()
        this.logger.info('需要登录，请在打开的浏览器中登录')
        this.browserSession = await browserManager.createSession(false)
      }
      // 等待登录
      await this.platform.login(this.browserSession)
      // 保存登录状态
      const storageState = await this.browserSession.context.storageState()
      // 无头模式，需要先关闭当前的有头模式，重新打开无头模式
      if (headless) {
        await this.browserSession.browser.close()
        this.logger.info('登录成功，浏览器将继续以无头模式运行')
        this.browserSession = await browserManager.createSession(headless, storageState)
      }
      await this.ensureAuthenticated(this.browserSession, headless)
    }
  }

  public async startTask(task: LiveControlTask): Result.ResultAsync<void, Error> {
    // 同一类型只允许存在一个任务实例。
    // 之前这里是直接 `activeTasks.set(type, newTask)` 覆盖：旧任务并没有被停掉，
    // 只是从 map 里消失了 —— 它注册的页面监听器（如评论监听）仍然在跑，
    // 于是同一条弹幕会被处理两遍，而且再也没法通过 stopTask 停掉（幽灵任务）。
    const existingTask = this.activeTasks.get(task.type)
    if (existingTask?.isRunning()) {
      this.logger.warn(
        `任务 ${task.type} 已在运行中，先停止旧实例再启动新实例（避免出现重复的监听器）`,
      )
      existingTask.stop()
      // stop() 会通过 stopListener 把旧任务从 activeTasks 移除，这里再兜底删一次
      if (this.activeTasks.get(task.type) === existingTask) {
        this.activeTasks.delete(task.type)
      }
    }

    const newTask = makeTask(task, this.platform, this.account, this.logger)
    if (Result.isFailure(newTask)) {
      return newTask
    }
    // 任务停止时从任务列表中移除（只删自己，避免误删后来启动的新任务）
    newTask.value.addStopListener(() => {
      if (this.activeTasks.get(task.type) === newTask.value) {
        this.activeTasks.delete(task.type)
      }
    })
    await newTask.value.start()
    // 任务可能在 onStart 钩子内自行完成（例如 OpenPriceMessageTask 发送完话术后 self-stop），
    // 此时不应再把它塞回 activeTasks，否则外部会拿到一个已经停止的“死”任务。
    if (newTask.value.isRunning()) {
      this.activeTasks.set(task.type, newTask.value)
    }
    return Result.succeed()
  }

  public stopTask(taskType: LiveControlTask['type']) {
    const task = this.activeTasks.get(taskType)
    if (task) {
      task.stop()
    } else {
      this.logger.warn('无法停止任务：未找到正在运行中的任务')
    }
  }

  public async sendRedPacket(duration: string): Result.ResultAsync<void, Error> {
    if (!isSendRedPacket(this.platform)) {
      return Result.fail(
        new TaskNotSupportedError({
          taskName: '一键发红包',
          targetName: this.platform.platformName,
        }),
      )
    }
    return this.platform.sendRedPacket(duration)
  }

  public async startOpenPriceWatcher(
    messages: { content: string; pinTop: boolean }[],
  ): Result.ResultAsync<void, Error> {
    if (!isOpenPriceWatcher(this.platform)) {
      return Result.fail(
        new TaskNotSupportedError({
          taskName: '开价变预热发送',
          targetName: this.platform.platformName,
        }),
      )
    }
    this.openPriceMessages = messages
    this.openPriceRunning = true
    this.startOpenPriceHealthCheck()
    const result = await this.platform.startOpenPriceWatcher(() => this.handleOpenPriceTrigger())
    // 启动失败必须复位，否则主进程会一直报告「监听中」，渲染层回查后会把红点刷成绿点
    if (Result.isFailure(result)) {
      this.openPriceRunning = false
      this.stopOpenPriceHealthCheck()
    }
    return result
  }

  public stopOpenPriceWatcher(): void {
    this.openPriceRunning = false
    this.stopOpenPriceHealthCheck()
    if (isOpenPriceWatcher(this.platform)) {
      this.platform.stopOpenPriceWatcher()
    }
  }

  /**
   * 开价监听健康检查：页面里的监听脚本是一次性注入的 MutationObserver，
   * 页面重载 / 卡死后脚本会静默消失，而主进程完全无感知
   * ——历史上出现过「界面显示运行中、点开价却毫无反应」的事故。
   * 这里定期检查心跳，失效就自动重新注入（自愈），实在恢复不了就通知界面显示红点。
   */
  private startOpenPriceHealthCheck() {
    this.openPriceMissCount = 0
    if (this.openPriceHealthTimer) {
      return
    }
    this.openPriceHealthTimer = setInterval(() => {
      void this.checkOpenPriceWatcherHealth()
    }, WATCHER_HEALTH_CHECK_INTERVAL_MS)
  }

  private stopOpenPriceHealthCheck() {
    if (this.openPriceHealthTimer) {
      clearInterval(this.openPriceHealthTimer)
      this.openPriceHealthTimer = null
    }
    this.openPriceMissCount = 0
  }

  private async checkOpenPriceWatcherHealth(): Promise<void> {
    if (!this.openPriceRunning) {
      return
    }
    // 平台没有自愈能力时（如视频号，它自己有 iframe 重扫机制）不需要检查
    if (!supportsOpenPriceSelfHealing(this.platform)) {
      return
    }
    const alive = await this.platform.isOpenPriceWatcherAlive?.()
    // 平台不支持存活探测时无法判定，跳过，不要盲目自愈
    if (alive === undefined) {
      return
    }
    if (alive) {
      if (this.openPriceMissCount > 0) {
        this.openPriceMissCount = 0
        windowManager.send(IPC_CHANNELS.tasks.autoMessage.openPriceWatcherRestored, this.account.id)
      }
      return
    }

    // 尝试自愈：把脚本重新注入到页面
    const recovered = await this.platform.rearmOpenPriceWatcher?.()
    if (recovered) {
      this.openPriceMissCount = 0
      this.logger.success('开价监听已恢复（脚本失效后重新注入）')
      windowManager.send(IPC_CHANNELS.tasks.autoMessage.openPriceWatcherRestored, this.account.id)
      return
    }

    this.openPriceMissCount += 1
    if (this.openPriceMissCount === OPEN_PRICE_MISS_THRESHOLD) {
      this.logger.error('开价监听已失效：页面无响应或脚本丢失，请到「开价话术」页重新开启')
      windowManager.send(IPC_CHANNELS.tasks.autoMessage.openPriceWatcherLost, this.account.id)
    }
  }

  /** 开价监听是否正在运行（供渲染层回查真实状态，避免界面显示与实际不一致） */
  public isOpenPriceWatcherRunning(): boolean {
    return this.openPriceRunning
  }

  public updateOpenPriceMessages(messages: { content: string; pinTop: boolean }[]): void {
    if (this.openPriceRunning) {
      this.openPriceMessages = messages
    }
  }

  private async handleOpenPriceTrigger(): Promise<void> {
    // 发送锁兜底：上一次发送若因页面卡住没结束，超时后强制释放
    if (this.openPriceSending) {
      const hung =
        this.openPriceSendingSince > 0 &&
        Date.now() - this.openPriceSendingSince > OPEN_PRICE_SEND_TIMEOUT_MS
      if (!hung) {
        return
      }
      this.logger.warn(
        `上一次开价话术发送超过 ${OPEN_PRICE_SEND_TIMEOUT_MS / 1000} 秒未结束，强制释放发送锁`,
      )
      this.releaseSendingLock()
    }
    if (!this.openPriceRunning) {
      return
    }
    // 置顶决策已由渲染层在发送前算好（首条是否置顶取决于「置顶首条话术」开关，
    // 其余沿用各自置顶设置），主进程原样转发，保持原有相对顺序
    const toSend = this.openPriceMessages.map(m => ({
      content: m.content,
      pinTop: m.pinTop,
    }))
    if (toSend.length === 0) {
      this.logger.warn('检测到开价变预热，但当前没有可发送的话术')
      return
    }
    const pinCount = toSend.filter(m => m.pinTop).length
    this.logger.success(
      `检测到开价变预热，开始按顺序发送全部话术（共 ${toSend.length} 条，其中置顶 ${pinCount} 条）`,
    )
    windowManager.send(IPC_CHANNELS.tasks.autoMessage.openPriceWarmupTriggered, this.account.id)
    this.openPriceSending = true
    this.openPriceSendingSince = Date.now()
    const started = await this.startTask({
      type: 'send-open-price-messages',
      config: { messages: toSend },
    })
    if (Result.isFailure(started)) {
      this.logger.error('开价话术发送任务启动失败：', started.error)
      this.releaseSendingLock()
      return
    }
    const task = this.activeTasks.get('send-open-price-messages')
    if (task) {
      task.addStopListener(() => this.releaseSendingLock())
      // OpenPriceMessageTask 可能在 start() 内部就已经完成并 stop，
      // 此时 addStopListener 不会再次触发，需要立即释放发送锁。
      if (!task.isRunning()) {
        this.releaseSendingLock()
      }
    } else {
      this.releaseSendingLock()
    }
  }

  /** 释放开价话术发送锁 */
  private releaseSendingLock() {
    this.openPriceSending = false
    this.openPriceSendingSince = 0
  }

  public updateTaskConfig<T extends LiveControlTask>(
    type: T['type'],
    config: Partial<T['config']>,
  ): Result.Result<void, Error> {
    const task = this.activeTasks.get(type)
    if (task?.updateConfig) {
      return task.updateConfig(config)
    }
    return Result.fail(new TaskNotSupportedError({ taskName: `update-${type}` }))
  }
}

function makeTask<T extends LiveControlTask>(
  task: T,
  platform: IPlatform,
  account: Account,
  logger: ReturnType<typeof createLogger>,
): Result.Result<ITask, Error> {
  if (task.type === 'auto-popup' && isPerformPopup(platform)) {
    return createAutoPopupTask(platform, task.config, account, logger)
  }
  if (task.type === 'auto-comment' && isPerformComment(platform)) {
    return createAutoCommentTask(platform, task.config, account, logger)
  }
  if (task.type === 'send-batch-messages' && isPerformComment(platform)) {
    return createSendBatchMessageTask(platform, task.config, logger)
  }
  if (task.type === 'send-open-price-messages' && isPerformComment(platform)) {
    return createOpenPriceMessageTask(platform, task.config, logger)
  }
  if (task.type === 'comment-listener' && isCommentListener(platform)) {
    return createCommentListenerTask(platform, task.config, account, logger)
  }
  if (task.type === 'pin-comment' && isPinComment(platform)) {
    return createPinCommentTask(platform, task.config.comment, account.id, logger)
  }
  return Result.fail(
    new TaskNotSupportedError({
      taskName: task.type,
      targetName: platform.platformName,
    }),
  )
}
