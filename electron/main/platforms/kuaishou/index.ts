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
    const page = this.mainPage
    if (!page) {
      return Result.fail(new PageNotFoundError())
    }
    const item = await getItemFromVirtualScroller(page, elementFinder, id)
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

    /**
     * 点击后可能出现两种确认层，都要关掉，否则状态不会推进：
     *  ① 「确定结束当前讲解?」——**快手专有**，点「结束讲解」必弹，含「覆盖当前讲解」勾选框，
     *     不点「确定」就一直是结束讲解状态（2026-11-04 用户确认：这点和抖音不一样）
     *  ② 点「开始讲解」偶尔弹的普通确认框（POPUP_CONFIRM_BUTTON）
     *
     * ⚠️ 原来只按 `.ant-modal-root button:last-child` 点一下，但 AntD 的 footer 里
     * 第一个匹配到的是「取消」——点错按钮等于什么也没做。
     * 现在改成按文字找「确定/确认」，并且限定在可见弹层内。
     */
    const confirmIfAny = async () => {
      // 先等弹层出现（最多 800ms），没出现就直接返回，避免每次都白等
      const appearDeadline = Date.now() + 800
      let hasModal = false
      while (Date.now() < appearDeadline) {
        hasModal = await page
          .evaluate(
            () =>
              !!Array.from(document.querySelectorAll('.ant-modal-root, [role="dialog"]')).find(
                el => {
                  const rect = el.getBoundingClientRect()
                  return rect.width > 0 && rect.height > 0
                },
              ),
          )
          .catch(() => false)
        if (hasModal) break
        await sleep(100)
      }
      if (!hasModal) return

      // 在可见弹层里按文字点「确定」/「确认」
      const clickDeadline = Date.now() + 1500
      while (Date.now() < clickDeadline) {
        const clicked = await page
          .evaluate(() => {
            const dialogs = Array.from(
              document.querySelectorAll<HTMLElement>('.ant-modal-root, [role="dialog"]'),
            ).filter(el => {
              const rect = el.getBoundingClientRect()
              return rect.width > 0 && rect.height > 0
            })
            const scope: ParentNode = dialogs[0] ?? document
            const buttons = Array.from(scope.querySelectorAll<HTMLElement>('button'))
            const ok = buttons.find(b => {
              const text = (b.textContent ?? '').trim()
              const rect = b.getBoundingClientRect()
              return (text === '确定' || text === '确认') && rect.width > 0 && rect.height > 0
            })
            if (!ok) return false
            ok.click()
            return true
          })
          .catch(() => false)
        if (clicked) {
          electronLog.scope('快手·自动弹窗').info('已点击确认弹层')
          await sleep(150)
          return
        }
        await sleep(150)
      }
      electronLog.scope('快手·自动弹窗').warn('弹层出现了但没找到「确定」按钮')
    }

    // 读当前按钮文案（每次都重新取商品行：点击后行会重渲染，旧句柄失效会一直读到旧文案）
    const readButtonText = async () => {
      const fresh = await getItemFromVirtualScroller(page, elementFinder, id)
      if (Result.isFailure(fresh)) return null
      const btn = await elementFinder.getPopUpButtonFromGoodsItem(fresh.value)
      if (Result.isFailure(btn)) return null
      return { btn: btn.value, text: (await btn.value.textContent())?.trim() ?? '' }
    }

    /**
     * 点「开始讲解」并**确认真的开始了**（文案变成「结束讲解」）。
     *
     * ⚠️ 2026-11-04：原来点完直接返回成功，但快手有时点击会落空（实测 06:49 报成功、
     * 07:01 页面上按钮仍是「开始讲解」），等于谎报成功，用户以为讲上了其实没讲。
     * 现在最多 3 轮：点击 → 轮询 2 秒等文案翻转；没翻转就重来。
     */
    const startAndVerify = async (): Promise<boolean> => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const current = await readButtonText()
        if (!current) {
          await sleep(200)
          continue
        }
        if (current.text === '结束讲解') return true // 已经在讲

        await current.btn.click({ force: true }).catch(() => current.btn.dispatchEvent('click'))
        await confirmIfAny()

        // 等文案翻转
        const deadline = Date.now() + 2000
        while (Date.now() < deadline) {
          await sleep(200)
          const after = await readButtonText()
          if (after?.text === '结束讲解') return true
        }
        electronLog
          .scope('快手·自动弹窗')
          .info(`商品 ${id} 第 ${attempt}/3 轮点开始讲解后文案未翻转，重试`)
      }
      return false
    }

    // 状态一：还没在讲解 → 点开始并验证
    if (buttonText === '开始讲解') {
      if (await startAndVerify()) return Result.succeed()
      const last = await readButtonText()
      return Result.fail(
        new ElementContentMismatchedError({
          current: last?.text || '未知',
          target: '结束讲解',
        }),
      )
    }

    // 状态二：本来就在讲解中（按钮显示「结束讲解」）
    // 期望：先取消，再点「开始讲解」重新弹出来（等于刷新卡片）。
    // 每轮只取消一次（clicked 标记），然后轮询等文案变成「开始讲解」再点它；最多 3 轮。
    let latestText = buttonText
    for (let attempt = 1; attempt <= 3; attempt++) {
      const deadline = Date.now() + 2000
      let cancelled = false
      while (Date.now() < deadline) {
        const current = await readButtonText()
        if (!current) {
          await sleep(150)
          continue
        }
        latestText = current.text
        if (latestText === '开始讲解') {
          // 已取消 → 交给 startAndVerify 点开始并确认
          if (await startAndVerify()) return Result.succeed()
          break
        }
        if (latestText === '结束讲解' && !cancelled) {
          await current.btn.click({ force: true }).catch(() => current.btn.dispatchEvent('click')) // 取消当前讲解
          await confirmIfAny()
          cancelled = true
        }
        await sleep(200)
      }
      electronLog
        .scope('快手·自动弹窗')
        .info(`商品 ${id} 第 ${attempt}/3 轮点击后文案仍为「${latestText || '未知'}」，重试`)
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
