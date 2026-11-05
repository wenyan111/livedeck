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

    // 读当前按钮文案。每次都重新取商品行：点击后行会重渲染，旧句柄失效会一直读到旧文案
    const readButton = async () => {
      const fresh = await getItemFromVirtualScroller(page, elementFinder, id)
      if (Result.isFailure(fresh)) return null
      const btn = await elementFinder.getPopUpButtonFromGoodsItem(fresh.value)
      if (Result.isFailure(btn)) return null
      return { btn: btn.value, text: (await btn.value.textContent())?.trim() ?? '' }
    }

    /**
     * 点弹层里的「确定」。
     * 快手点「结束讲解」必弹「确定结束当前讲解?」（含「覆盖当前讲解」勾选框），
     * 不点确定就不会生效——这点和抖音不一样（2026-11-04 用户确认）。
     *
     * ⚠️ 两个坑：① 原来按 `.ant-modal-root button:last-child` 盲点，AntD footer 里先匹配到「取消」；
     * ② 商品列表和弹层都可能挂在 iframe 里，page.evaluate 只跑主 frame → 查不到，
     *   所以遍历 page.frames() 逐个尝试。
     */
    const clickConfirmInFrames = async () => {
      const grabConfirm = () => {
        const norm = (t: string) => t.replace(/\s+/g, '').trim() // AntD 会把「确定」渲染成「确 定」
        const dialogs = Array.from(
          document.querySelectorAll<HTMLElement>('.ant-modal-root, [role="dialog"]'),
        ).filter(el => {
          const rect = el.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        })
        if (dialogs.length === 0) return null
        const scope: ParentNode = dialogs[0] ?? document

        const visible = (b: HTMLElement) => {
          const r = b.getBoundingClientRect()
          return r.width > 0 && r.height > 0
        }
        const buttons = Array.from(scope.querySelectorAll<HTMLElement>('button')).filter(visible)

        // 优先按文字找「确定/确认」（去掉空格再比）
        const byText = buttons.find(b => {
          const text = norm(b.textContent ?? '')
          return text === '确定' || text === '确认'
        })
        // 兜底：AntD confirm 弹层的确定按钮永远是 footer 里最后一个
        const footerLast = scope.querySelector<HTMLElement>(
          '.ant-modal-confirm-btns button:last-child, .ant-modal-footer button:last-child',
        )
        const target = byText ?? (footerLast && visible(footerLast) ? footerLast : null)
        if (!target) {
          return buttons.map(b => norm(b.textContent ?? '')).join('|') || '无按钮'
        }
        target.click()
        return 'ok'
      }

      for (const frame of page.frames()) {
        const result = await frame.evaluate(grabConfirm).catch(() => null)
        if (result === 'ok') return true
        if (result && result !== 'ok') {
          electronLog.scope('快手·自动弹窗').info(`弹层里没找到确定按钮，现有：${result}`)
        }
      }
      return false
    }

    const confirmIfAny = async () => {
      const deadline = Date.now() + 1500
      while (Date.now() < deadline) {
        if (await clickConfirmInFrames()) {
          electronLog.scope('快手·自动弹窗').info('已点击「确定」确认弹层')
          await sleep(150)
          return
        }
        await sleep(150)
      }
    }

    // 等弹层彻底消失：遮罩还在时点商品行的按钮会被 mask 吃掉（表现为点了没反应）
    const waitNoModal = async (timeoutMs = 2500) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        let hasModal = false
        for (const frame of page.frames()) {
          hasModal = await frame
            .evaluate(() =>
              Array.from(
                document.querySelectorAll<HTMLElement>('.ant-modal-root, [role="dialog"]'),
              ).some(el => {
                const rect = el.getBoundingClientRect()
                return rect.width > 0 && rect.height > 0
              }),
            )
            .catch(() => false)
          if (hasModal) break
        }
        if (!hasModal) return true
        await sleep(150)
      }
      return false
    }

    // 点「开始讲解」并验证真的开始了（文案翻成「结束讲解」），最多 3 轮
    const startAndVerify = async (): Promise<boolean> => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const current = await readButton()
        if (!current) {
          await sleep(200)
          continue
        }
        if (current.text === '结束讲解') return true // 已经在讲

        await waitNoModal() // 确保没有遮罩挡着
        await current.btn.click({ force: true }).catch(() => current.btn.dispatchEvent('click'))
        await confirmIfAny()

        const deadline = Date.now() + 2000
        while (Date.now() < deadline) {
          await sleep(200)
          const after = await readButton()
          if (after?.text === '结束讲解') return true
        }
        electronLog
          .scope('快手·自动弹窗')
          .info(`商品 ${id} 第 ${attempt}/3 轮点开始讲解后文案未翻转，重试`)
      }
      return false
    }

    // 状态二：本来就在讲解中 → 先取消，再重新开始（用户要求：讲解中也要走这一步）
    //
    // 顺序很关键：点「结束讲解」→ 点「确定」→ **等遮罩消失** → 等文案变「开始讲解」
    // → 再点开始。之前漏了「等遮罩」，点完确定就去点开始，点击被 mask 吃掉，
    // 文案卡在「开始讲解」，于是报「当前内容为 开始讲解，目标内容为 结束讲解」。
    if (buttonText === '结束讲解') {
      const current = await readButton()
      if (current) {
        await current.btn.click({ force: true }).catch(() => current.btn.dispatchEvent('click')) // 取消当前讲解
        await confirmIfAny()
        await waitNoModal()
      }

      const cancelDeadline = Date.now() + 3000
      while (Date.now() < cancelDeadline) {
        const after = await readButton()
        if (after?.text === '开始讲解') break
        await sleep(200)
      }

      if (await startAndVerify()) return Result.succeed()
      const last = await readButton()
      return Result.fail(
        new ElementContentMismatchedError({
          current: last?.text || '未知',
          target: '结束讲解',
        }),
      )
    }

    // 状态一：还没在讲解 → 直接点开始并验证
    if (await startAndVerify()) return Result.succeed()
    const lastText = await readButton()
    return Result.fail(
      new ElementContentMismatchedError({
        current: lastText?.text || '未知',
        target: '结束讲解',
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
