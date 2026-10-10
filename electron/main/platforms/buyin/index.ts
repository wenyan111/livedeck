import { Result } from '@praha/byethrow'
import type { Page } from 'playwright'
import { UnexpectedError } from '#/errors/AppError'
import { ElementNotFoundError, type PlatformError } from '#/errors/PlatformError'
import { createLogger } from '#/logger'
import type { BrowserSession } from '#/managers/BrowserSessionManager'
import { DouyinPlatform } from '../douyin'
import { CompassListener, ControlListener } from '../douyin/commentListener'
// 百应和抖店共用
import { connect, ensurePage, openUrlByElement } from '../helper'
import type {
  ICommentListener,
  IOpenPriceWatcher,
  IPerformComment,
  IPerformPopup,
  IPlatform,
  ISendRedPacket,
} from '../IPlatform'
import {
  isWatcherScriptAlive,
  OPEN_PRICE_WATCHER_SCRIPT,
  stopWatcherScript,
} from '../openPriceWatcher'
import { REGEXPS, SELECTORS, URLS } from './constant'

const PLATFORM_NAME = '巨量百应' as const

/**
 * 巨量百应
 */
export class BuyinPlatform
  implements
    IPlatform,
    IPerformPopup,
    IPerformComment,
    ICommentListener,
    ISendRedPacket,
    IOpenPriceWatcher
{
  readonly _isSendRedPacket = true
  readonly _isPerformComment = true
  readonly _isPerformPopup = true
  readonly _isCommentListener = true
  readonly _isOpenPriceWatcher = true

  private mainPage: Page | null = null
  private commentListener: ICommentListener | null = null
  private openPriceOnTrigger: (() => void) | null = null
  private readonly openPriceLogger = createLogger('开价变预热')
  /** 页面重载监听的注销函数 */
  private reloadOff: (() => void) | null = null

  get platformName() {
    return PLATFORM_NAME
  }

  async connect(browserSession: BrowserSession) {
    const { page } = browserSession
    const isConnected = await connect(page, {
      isInLiveControlSelector: SELECTORS.IN_LIVE_CONTROL,
      liveControlUrl: URLS.LIVE_CONTROL_PAGE,
      loginUrlRegex: REGEXPS.LOGIN_PAGE,
    })
    if (isConnected) {
      // 2025.11 巨量百应的中控台和登录时一样，样式会乱，同样的解决方法
      const newPage = await openUrlByElement(page, URLS.LIVE_CONTROL_PAGE)
      browserSession.page = newPage
      this.mainPage = newPage
      await page.close()
    }
    return isConnected
  }

  async login(browserSession: BrowserSession) {
    // 进入登录页面
    // 巨量百应（2025.8）也有和抖店同样的问题
    // 解决方法：通过控件主动打开登录页面
    const newPage = await openUrlByElement(browserSession.page, URLS.LOGIN_PAGE)
    await browserSession.page.close()
    browserSession.page = newPage

    await browserSession.page.waitForSelector(SELECTORS.LOGGED_IN, {
      timeout: 0,
    })
  }

  async getAccountName(session: BrowserSession) {
    await session.page.waitForSelector(SELECTORS.ACCOUNT_NAME)
    const accountName = await session.page.$(SELECTORS.ACCOUNT_NAME).then(el => el?.textContent())
    return accountName ?? ''
  }

  disconnect(): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async performPopup(...args: Parameters<IPerformPopup['performPopup']>) {
    return await DouyinPlatform.prototype.performPopup.call(this, ...args)
  }

  sendRedPacket(
    ...args: Parameters<ISendRedPacket['sendRedPacket']>
  ): Result.ResultAsync<void, PlatformError> {
    return DouyinPlatform.prototype.sendRedPacket.call(this, ...args)
  }

  getRedPacketPage(): Page | null {
    return this.mainPage
  }

  async performComment(message: string, pinTop: boolean) {
    return await DouyinPlatform.prototype.performComment.call(this, message, pinTop)
  }

  startCommentListener(onComment: (comment: LiveMessage) => void, source: 'control' | 'compass') {
    const pageResult = ensurePage(this.mainPage)
    if (Result.isFailure(pageResult)) {
      throw pageResult.error
    }
    const page = pageResult.value
    // 兜底：确保上一个监听器一定被卸掉，避免同一页面上挂两个监听器导致弹幕重复处理
    this.commentListener?.stopCommentListener()
    if (source === 'control') {
      this.commentListener = new ControlListener(page)
    } else {
      this.commentListener = new CompassListener('buyin', page)
    }
    return this.commentListener.startCommentListener(onComment, source)
  }

  stopCommentListener(): void {
    this.commentListener?.stopCommentListener()
  }

  getCommentListenerPage(): Page {
    if (!this.commentListener) {
      throw new Error('未找到评论监听页面')
    }
    return this.commentListener?.getCommentListenerPage() ?? this.mainPage
  }

  getPopupPage() {
    return this.mainPage
  }

  getCommentPage() {
    return this.mainPage
  }

  async startOpenPriceWatcher(onTrigger: () => void): Result.ResultAsync<void, PlatformError> {
    this.openPriceOnTrigger = onTrigger
    return Result.pipe(
      ensurePage(this.mainPage),
      Result.andThen(page =>
        Result.try({
          immediate: true,
          try: async () => {
            await this.exposeOpenPriceTrigger(page)
            await page.evaluate(OPEN_PRICE_WATCHER_SCRIPT)
            // 页面重载后脚本会丢失，这里兜底重新注入，避免监听静默失效
            this.armReloadReinject(page)
          },
          catch: (err: unknown) =>
            err instanceof ElementNotFoundError
              ? err
              : new UnexpectedError({ description: String(err) }),
        }),
      ),
    )
  }

  /** 重新把 __openPriceTrigger 暴露到页面（reload 后必须重新 expose） */
  private async exposeOpenPriceTrigger(page: Page): Promise<void> {
    try {
      await page.exposeFunction('__openPriceTrigger', () => this.openPriceOnTrigger?.())
    } catch (err) {
      // 同一 document 下重复 exposeFunction 会抛错，监听已存在则忽略
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('already')) throw err
    }
  }

  /** 页面发生重载（load）后自动重新注入监听脚本 */
  private armReloadReinject(page: Page) {
    if (this.reloadOff) {
      return
    }
    const handler = () => {
      if (!this.openPriceOnTrigger) {
        return
      }
      // 新 document 里 exposed 函数已随页面销毁，必须先重新 expose 再重注脚本，
      // 否则脚本里 window.__openPriceTrigger 不存在，开价跳变会静默失效。
      this.exposeOpenPriceTrigger(page)
        .then(() => page.evaluate(OPEN_PRICE_WATCHER_SCRIPT))
        .then(() => {
          this.openPriceLogger.success('页面已重载，开价监听已自动重新注入')
        })
        .catch(err => {
          this.openPriceLogger.warn('页面重载后重新注入开价监听失败：', err)
        })
    }
    page.on('load', handler)
    this.reloadOff = () => {
      page.off('load', handler)
    }
  }

  /** 监听脚本是否仍然存活（用于主进程健康检查） */
  async isOpenPriceWatcherAlive(): Promise<boolean> {
    return isWatcherScriptAlive(this.mainPage)
  }

  /** 重新注入监听脚本，用于脚本失效后的自愈 */
  async rearmOpenPriceWatcher(): Promise<boolean> {
    const page = this.mainPage
    if (!page || page.isClosed() || !this.openPriceOnTrigger) {
      return false
    }
    try {
      // 先卸载再注入：只 evaluate 脚本会被内部的幂等保护直接 return，
      // 心跳不会刷新，下一次检查又会判定失效。
      await stopWatcherScript(page)
      // 若页面已重载（exposed 函数随 document 销毁），需重新 expose，否则触发静默失效
      await this.exposeOpenPriceTrigger(page)
      await page.evaluate(OPEN_PRICE_WATCHER_SCRIPT)
      return true
    } catch {
      return false
    }
  }

  stopOpenPriceWatcher(): void {
    this.reloadOff?.()
    this.reloadOff = null
    void stopWatcherScript(this.mainPage)
    this.openPriceOnTrigger = null
  }
}
