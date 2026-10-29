import { Result } from '@praha/byethrow'
import type { Page } from 'playwright'
import type { BrowserSession } from '#/managers/BrowserSessionManager'
import {
  clickOnceButton,
  comment,
  connect,
  ensurePage,
  getAccountName,
  getItemFromVirtualScroller,
  openUrlByElement,
} from '../helper'
import type { ICommentListener, IPerformComment, IPerformPopup, IPlatform } from '../IPlatform'
import { XiaohongshuCommentListener } from './commentListener'
import { REGEXPS, SELECTORS, TEXTS, URLS } from './constant'
import { xiaohongshuElementFinder as elementFinder } from './elment-finder'

const PLATFORM_NAME = '小红书' as const

/**
 * 小红书（千帆）
 */
export class XiaohongshuPlatform
  implements IPlatform, IPerformPopup, IPerformComment, ICommentListener
{
  readonly _isCommentListener = true
  readonly _isPerformComment = true
  readonly _isPerformPopup = true
  private mainPage: Page | null = null
  private commentListener: XiaohongshuCommentListener | null = null
  private accountName = ''

  async connect(browserSession: BrowserSession) {
    const { page } = browserSession
    const isConnected = await connect(page, {
      isInLiveControlSelector: SELECTORS.IN_LIVE_CONTROL,
      liveControlUrl: URLS.LIVE_CONTROL_PAGE,
      loginUrlRegex: REGEXPS.LOGIN_PAGE,
    })

    if (isConnected) {
      // 小红书反爬，直接用 goto 进入中控台加载不出元素
      const newPage = await openUrlByElement(page, URLS.LIVE_CONTROL_PAGE)
      await page.close()
      browserSession.page = newPage
      this.mainPage = newPage
    }
    return isConnected
  }

  async login(browserSession: BrowserSession): Promise<void> {
    const { page } = browserSession
    if (!REGEXPS.LOGIN_PAGE.test(page.url())) {
      await page.goto(URLS.LOGIN_PAGE)
    }
    await page.waitForSelector(SELECTORS.LOGGED_IN, {
      timeout: 0,
    })
  }

  async getAccountName(session: BrowserSession) {
    const accountName = await getAccountName(session.page, SELECTORS.ACCOUNT_NAME)
    // 店铺名常以「的店」结尾，展示时去掉后缀；但赋值必须放在 if 外——
    // 否则不以「的店」结尾的账号会一直拿到空名字，导致「主播评论」判定与
    // 「仅用户评论」过滤全部失效（表现为机器人回复到自己的评论上）。
    if (accountName) {
      this.accountName = accountName.endsWith('的店') ? accountName.slice(0, -2) : accountName
    }
    return this.accountName
  }

  disconnect(): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async performPopup(id: number, signal?: AbortSignal) {
    return Result.pipe(
      ensurePage(this.mainPage),
      Result.andThen(page => getItemFromVirtualScroller(page, elementFinder, id)),
      Result.andThen(item => elementFinder.getPopUpButtonFromGoodsItem(item)),
      Result.andThen(btn =>
        clickOnceButton(btn, TEXTS.POPUP_BUTTON, TEXTS.POPUP_BUTTON_PENDING, signal),
      ),
    )
  }

  async performComment(message: string, _pinTop?: boolean, replyTo?: ReplyTarget) {
    // replyTo：自动回复要「真 @ 观众」时传入的目标评论。
    // 小红书目前还没实现 findCommentItem（评论区在 iframe `#redlive-pgy-app` 内，
    // DOM 结构待确认），此时 helper 会直接返回 false → 走原来的纯文本路径，
    // 行为与改动前完全一致。等 element-finder 补齐后再打开 MENTION_PLATFORMS。
    return Result.pipe(
      ensurePage(this.mainPage),
      Result.andThen(page => comment(page, elementFinder, message, false, replyTo)),
    )
  }

  async startCommentListener(onComment: (comment: LiveMessage) => void): Promise<void> {
    const page = ensurePage(this.mainPage)
    if (Result.isFailure(page)) {
      throw page.error
    }
    this.commentListener = new XiaohongshuCommentListener(page.value)
    this.commentListener.setAccountName(this.accountName)
    await this.commentListener.startCommentListener(onComment)
  }

  stopCommentListener(): void {
    this.commentListener?.stopCommentListener()
  }

  getCommentListenerPage(): Page {
    if (!this.commentListener) {
      throw new Error('Comment listener not started')
    }
    return this.commentListener.getCommentListenerPage()
  }

  getPopupPage() {
    return this.mainPage
  }

  getCommentPage() {
    return this.mainPage
  }

  get platformName() {
    return PLATFORM_NAME
  }
}
