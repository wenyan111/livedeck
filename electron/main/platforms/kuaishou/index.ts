import { Result } from '@praha/byethrow'
import type { Page } from 'playwright'
import { ElementContentMismatchedError, PageNotFoundError } from '#/errors/PlatformError'
import electronLog from '#/logger'
import type { BrowserSession } from '#/managers/BrowserSessionManager'
import { sleep } from '#/utils'
import { comment, connect, ensurePage, getAccountName, getItemFromVirtualScroller } from '../helper'
import type { ICommentListener, IPerformComment, IPerformPopup, IPlatform } from '../IPlatform'
import { KuaishouCommentListener } from './commentListener'
import { REGEXPS, SELECTORS, URLS } from './constant'
import { kuaishouElementFinder as elementFinder } from './element-finder'

const PLATFORM_NAME = '快手小店' as const

export class KuaishouPlatform
  implements IPlatform, IPerformPopup, IPerformComment, ICommentListener
{
  readonly _isPerformPopup = true
  readonly _isPerformComment = true
  readonly _isCommentListener = true
  private mainPage: Page | null = null
  private commentListener: KuaishouCommentListener | null = null

  async connect(browserSession: BrowserSession): Promise<boolean> {
    const { page } = browserSession
    await KuaishouCommentListener.hook(page)
    const isConnected = await connect(page, {
      isInLiveControlSelector: SELECTORS.IN_LIVE_CONTROL,
      liveControlUrl: URLS.LIVE_CONTROL,
      loginUrlRegex: REGEXPS.LOGIN_PAGE,
    })

    if (isConnected) {
      // 快手小店会弹出莫名其妙的窗口，按 ESC 关闭
      let popover = await page
        .waitForSelector(SELECTORS.DRIVER_POPOVER, { timeout: 3000 })
        .catch(_ => null)
      while (popover) {
        await page.press('body', 'Escape')
        await sleep(1000)
        popover = await page.$(SELECTORS.DRIVER_POPOVER)
      }
      this.mainPage = page
    }

    return isConnected
  }

  async login(browserSession: BrowserSession): Promise<void> {
    if (!REGEXPS.LOGIN_PAGE.test(browserSession.page.url())) {
      await browserSession.page.goto(URLS.LOGIN_PAGE)
    }
    await browserSession.page.waitForSelector(SELECTORS.LOGGED_IN, {
      timeout: 0,
    })
  }

  async getAccountName(session: BrowserSession): Promise<string> {
    const accountName = await getAccountName(session.page, SELECTORS.ACCOUNT_NAME)
    return accountName ?? ''
  }

  disconnect(): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async performComment(message: string, _pinTop?: boolean, replyTo?: ReplyTarget) {
    // 快手置顶暂时下线：忽略 pinTop，一律按「不置顶」发送。
    // 原因：快手回复框下方「置顶评论」复选框定位不稳定，置顶成功率低、还可能干扰发送，
    // 先去掉置顶。参数保留以兼容 IPerformComment 接口，后续要恢复把这里改回 pinTop 即可。
    //
    // replyTo：自动回复要「真 @ 观众」时传入的目标评论。
    // 传了才会走「点评论 → 点悬浮工具条第 3 个『回复』图标 → 平台插 @昵称」的路径；
    // 不传行为与改动前完全一致。
    return Result.pipe(
      ensurePage(this.mainPage),
      Result.andThen(page => comment(page, elementFinder, message, false, replyTo)),
    )
  }

  getCommentPage() {
    return this.mainPage
  }

  async performPopup(id: number) {
    if (!this.mainPage) {
      return Result.fail(new PageNotFoundError())
    }
    const item = await getItemFromVirtualScroller(this.mainPage, elementFinder, id)
    if (Result.isFailure(item)) {
      return item
    }
    const button = await elementFinder.getPopUpButtonFromGoodsItem(item.value)
    if (Result.isFailure(button)) {
      return button
    }
    const buttonText = (await button.value.textContent())?.trim() ?? ''
    if (buttonText !== '结束讲解' && buttonText !== '开始讲解') {
      return Result.fail(
        new ElementContentMismatchedError({
          current: buttonText,
          target: '结束讲解或开始讲解',
        }),
      )
    }

    // 弹出确认框（有时点讲解会弹「确定」）
    const closeModalIfAny = async () => {
      const modalNextButton = await this.mainPage
        ?.waitForSelector(SELECTORS.goodsItem.POPUP_CONFIRM_BUTTON, { timeout: 500 })
        .catch(() => null)
      if (modalNextButton) {
        await modalNextButton.dispatchEvent('click')
      }
    }

    // 状态一：还没在讲解 → 直接点「开始讲解」即可
    if (buttonText === '开始讲解') {
      await button.value.dispatchEvent('click')
      await closeModalIfAny()
      return Result.succeed()
    }

    // 状态二：本来就在讲解中（按钮显示「结束讲解」）
    // 期望：先取消，再点「开始讲解」重新弹出来（等于刷新卡片）。
    //
    // ⚠️ 2026-11-02 修正：原实现只 sleep(100) 就断言「文案必须变成开始讲解」，
    // 但快手文案切换有延迟，几乎每轮都读到还是「结束讲解」→ 报「元素内容不匹配」，
    // 而业务上这时商品本来就在讲解中，不该算失败。
    // 现在：每轮只取消一次（cancelled 标记），然后轮询等文案变成「开始讲解」再点它；
    // 一轮没成就再试，最多 3 轮。注意外层**不再预先点击**，避免来回切换。
    let latestText = buttonText
    for (let attempt = 1; attempt <= 3; attempt++) {
      const deadline = Date.now() + 2000
      let cancelled = false
      while (Date.now() < deadline) {
        // 每次重新查：文案切换后旧句柄会失效
        const btn = await elementFinder.getPopUpButtonFromGoodsItem(item.value)
        if (Result.isFailure(btn)) {
          await sleep(150)
          continue
        }
        latestText = (await btn.value.textContent())?.trim() ?? ''
        if (latestText === '开始讲解') {
          await btn.value.dispatchEvent('click')
          await closeModalIfAny()
          return Result.succeed()
        }
        if (latestText === '结束讲解' && !cancelled) {
          await btn.value.dispatchEvent('click') // 取消当前讲解
          await closeModalIfAny()
          cancelled = true
        }
        await sleep(150)
      }
      electronLog
        .scope('快手·自动弹窗')
        .info(`商品 ${id} 第 ${attempt}/3 轮取消后文案仍为「${latestText || '未知'}」，重试`)
    }
    return Result.fail(
      new ElementContentMismatchedError({
        current: latestText || '未知',
        target: '开始讲解',
      }),
    )
  }

  startCommentListener(onComment: (comment: LiveMessage) => void): void | Promise<void> {
    const page = ensurePage(this.mainPage)
    if (Result.isFailure(page)) {
      throw page.error
    }
    if (!this.commentListener) {
      this.commentListener = new KuaishouCommentListener(page.value)
    }
    this.commentListener.startCommentListener(onComment)
  }

  stopCommentListener(): void {
    this.commentListener?.stopCommentListener()
  }
  getCommentListenerPage(): Page {
    if (!this.commentListener) {
      throw new Error('Comment listener not started')
    }
    return this.commentListener.getPage()
  }

  getPopupPage() {
    return this.mainPage
  }

  get platformName() {
    return PLATFORM_NAME
  }
}
