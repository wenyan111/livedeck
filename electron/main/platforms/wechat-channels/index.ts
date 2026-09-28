import { Result } from '@praha/byethrow'
import type { Page } from 'playwright'
import { ElementContentMismatchedError, ElementNotFoundError, type PlatformError } from '#/errors/PlatformError'
import { UnexpectedError } from '#/errors/AppError'
import type { BrowserSession } from '#/managers/BrowserSessionManager'
import { createLogger } from '#/logger'
import {
  comment,
  ensurePage,
  getAccountName,
  getItemFromVirtualScroller,
  toggleButton,
} from '../helper'
import type {
  ICommentListener,
  IOpenPriceWatcher,
  IPerformComment,
  IPerformPopup,
  IPinComment,
  IPlatform,
} from '../IPlatform'
import { WeChatChannelCommentListener } from './commentListener'
import { REGEXPS, SELECTORS, TEXT, URLS } from './constant'
import { wechatChannelElementFinder as elementFinder } from './element-finder'

const PLATFORM_NAME = '微信视频号' as const

/**
 * 注入页面的监听脚本：检测「讲解」变为「结束讲解」时触发回调。
 * 视频号没有「开价」按钮，对应动作是点击「讲解」（按钮随即变为「结束讲解」）。
 *
 * 关键实现说明（都是踩过的坑）：
 * 1. 视频号是 Wujie 微前端（.wujie_iframe），商品列表在 **iframe / shadow root** 里。
 *    Playwright 的 CSS 选择器会自动穿透，所以弹窗等功能正常；
 *    但脚本里直接查 document 是完全看不到的 → 必须**逐个 frame 注入**，
 *    并且在本脚本内继续递归 shadow root。
 * 2. 讲解按钮不是 button（是 span / a），所以**按文本匹配**而不是按标签或 class 匹配，
 *    避免官方改 class 名后再次失效。
 * 3. 商品列表里每个商品行都有独立的讲解按钮，不能只看「有没有出现结束讲解」——
 *    A 正在讲解时点 B 的讲解会误判，点「结束讲解」也会误判。
 *    正确做法：统计「结束讲解」的**个数**，只有个数增加（= 新点了一次讲解）才触发。
 * 4. 用字符串注入，避免主进程编译期校验页面内 DOM 全局类型。
 */
const WECHAT_OPEN_PRICE_WATCHER_SCRIPT = `
(function () {
  // 防止多次启停（或重复注入）叠加多个 MutationObserver
  if (window.__wcOpenPriceWatcherSet) {
    return { already: true }
  }
  window.__wcOpenPriceWatcherSet = true

  var fire = function () {
    if (typeof window.__wcOpenPriceTrigger === 'function') {
      window.__wcOpenPriceTrigger()
    }
  }
  var norm = function (s) { return (s || '').replace(/\\s+/g, '') }
  // 只按文本判断，不依赖 button/span 标签与 class 名
  var isEnding = function (t) { return t.indexOf('结束讲解') !== -1 }

  // 收集当前 frame 内的所有根：document + 递归 shadow root
  var collectRoots = function () {
    var roots = [document]
    var i = 0
    while (i < roots.length) {
      var all
      try {
        all = roots[i].querySelectorAll('*')
      } catch (e) {
        i++
        continue
      }
      for (var j = 0; j < all.length; j++) {
        if (all[j].shadowRoot) {
          roots.push(all[j].shadowRoot)
        }
      }
      i++
    }
    return roots
  }

  var isVisible = function (el) {
    var r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return false
    var st = window.getComputedStyle(el)
    return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0'
  }

  // 统计当前处于「讲解中」的按钮数量（跨 shadow root）
  var countExplaining = function () {
    var roots = collectRoots()
    var n = 0
    for (var r = 0; r < roots.length; r++) {
      var all
      try {
        all = roots[r].querySelectorAll('*')
      } catch (e) {
        continue
      }
      for (var i = 0; i < all.length; i++) {
        var el = all[i]
        if (!isEnding(norm(el.textContent))) continue
        // 只取最内层节点：若某个子节点也含该文本，说明自己是外层容器，跳过，
        // 避免 <a><span>结束讲解</span></a> 这类结构被重复计数
        var nested = false
        for (var c = 0; c < el.children.length; c++) {
          if (isEnding(norm(el.children[c].textContent))) {
            nested = true
            break
          }
        }
        if (nested) continue
        if (!isVisible(el)) continue
        n++
      }
    }
    return n
  }

  // last = null 表示刚注入尚未初始化，此时不触发（避免启动瞬间误发）
  var last = null
  var scan = function () {
    var n
    try {
      n = countExplaining()
    } catch (e) {
      return
    }
    if (last !== null && n > last) {
      fire()
    }
    last = n
  }

  // DOM 变化很密集，合并到下一帧统一扫描
  var scheduled = false
  var schedule = function () {
    if (scheduled) return
    scheduled = true
    setTimeout(function () {
      scheduled = false
      scan()
    }, 60)
  }

  var observers = []
  var observeAll = function () {
    for (var i = 0; i < observers.length; i++) {
      observers[i].disconnect()
    }
    observers = []
    var roots = collectRoots()
    for (var r = 0; r < roots.length; r++) {
      try {
        var ob = new MutationObserver(schedule)
        ob.observe(roots[r], { subtree: true, childList: true, characterData: true })
        observers.push(ob)
      } catch (e) {}
    }
    return roots.length
  }

  window.__wcOpenPriceCleanup = function () {
    for (var i = 0; i < observers.length; i++) {
      observers[i].disconnect()
    }
    observers = []
    if (window.__wcOpenPriceRescanTimer) {
      clearInterval(window.__wcOpenPriceRescanTimer)
      window.__wcOpenPriceRescanTimer = null
    }
    window.__wcOpenPriceWatcherSet = false
  }

  observeAll()
  scan()
  // shadow root 可能是后挂载的，定期重建 observer 以覆盖新增的根
  window.__wcOpenPriceRescanTimer = setInterval(observeAll, 3000)

  return { ok: true, roots: collectRoots().length, explaining: last }
})()
`

/**
 * 诊断脚本：报告当前 frame 里「讲解 / 结束讲解」文本的分布。
 * 注入后立即执行一次并写进运行日志，方便定位「明明点了讲解却没触发」的问题。
 */
const WECHAT_OPEN_PRICE_PROBE_SCRIPT = `
(function () {
  var norm = function (s) { return (s || '').replace(/\\s+/g, '') }
  var roots = [document]
  var i = 0
  while (i < roots.length) {
    var all
    try {
      all = roots[i].querySelectorAll('*')
    } catch (e) {
      i++
      continue
    }
    for (var j = 0; j < all.length; j++) {
      if (all[j].shadowRoot) roots.push(all[j].shadowRoot)
    }
    i++
  }
  var hasNested = function (el, key) {
    for (var c = 0; c < el.children.length; c++) {
      if (norm(el.children[c].textContent).indexOf(key) !== -1) return true
    }
    return false
  }
  var ending = 0
  var idle = 0
  var sample = ''
  for (var r = 0; r < roots.length; r++) {
    var nodes
    try {
      nodes = roots[r].querySelectorAll('*')
    } catch (e) {
      continue
    }
    for (var k = 0; k < nodes.length; k++) {
      var el = nodes[k]
      var t = norm(el.textContent)
      if (t === '结束讲解') {
        // 只统计最内层，避免行容器 / a / span 层层重复计数
        if (hasNested(el, '结束')) continue
        ending++
        if (!sample) sample = (el.outerHTML || '').slice(0, 160)
      } else if (t === '讲解') {
        if (hasNested(el, '讲解')) continue
        idle++
      }
    }
  }
  return {
    url: location.href,
    roots: roots.length,
    ending: ending,
    idle: idle,
    sample: sample,
  }
})()
`

/**
 * 微信视频号
 */
export class WechatChannelPlatform
  implements
    IPlatform,
    IPerformPopup,
    IPerformComment,
    ICommentListener,
    IPinComment,
    IOpenPriceWatcher
{
  readonly _isPinComment = true
  readonly _isCommentListener = true
  readonly _isPerformComment = true
  readonly _isPerformPopup = true
  readonly _isOpenPriceWatcher = true
  private mainPage: Page | null = null
  /** 商品列表页面 */
  private productsPage: Page | null = null
  private commentListener: WeChatChannelCommentListener | null = null
  private openPriceOnTrigger: (() => void) | null = null
  /** 已经注入过 trigger 函数的页面（exposeFunction 不能重复注册，需按页记录） */
  private openPriceExposedPages = new Set<Page>()
  /** 定期补注入 iframe 的定时器 */
  private openPriceRescanTimer: ReturnType<typeof setInterval> | null = null
  private readonly logger = createLogger('开价变预热')
  async connect(session: BrowserSession) {
    const { page } = session
    await page.goto(URLS.LIVE_CONTROL_PAGE, {
      waitUntil: 'domcontentloaded',
    })

    // 微信视频号有三种可能
    // 1. 未登录 -> 跳转登录页面
    // 2. 已登录但未开播 -> 跳转到首页
    // 3. 已登录且开播 -> 正常访问中控台
    await Promise.race([
      page.waitForURL(REGEXPS.LOGIN_PAGE, {
        timeout: 0,
      }),
      page.waitForSelector(SELECTORS.LOGIN.IN_LIVE_CONTROL, {
        timeout: 0,
      }),
      page.waitForURL(REGEXPS.INDEX_PAGE, { timeout: 0 }),
    ])

    // 未开播，跳转到首页了
    if (REGEXPS.INDEX_PAGE.test(page.url())) {
      // TODO: 此时其实是登录成功的，最好能先保存好登录状态
      throw new Error('视频号未开播的情况下无法连接到中控台，请先开播')
    }

    const isConnected = !REGEXPS.LOGIN_PAGE.test(session.page.url())

    // 视频号的商品列表不在中控台，需要额外打开新的页面
    if (isConnected) {
      this.mainPage = page
      this.productsPage = await session.context.newPage()
      await this.productsPage.goto(URLS.PRODUCTS_PAGE)
    }
    return isConnected
  }

  async login(browserSession: BrowserSession) {
    const { page } = browserSession
    if (!REGEXPS.LOGIN_PAGE.test(page.url())) {
      await page.goto(URLS.LOGIN_PAGE)
    }
    await browserSession.page.waitForSelector(SELECTORS.LOGIN.LOGGED_IN, {
      timeout: 0,
    })
  }

  async getAccountName(session: BrowserSession): Promise<string> {
    // 视频号如果窗口过小的话无法正常获取账号名
    // 直接访问视频号首页就能搞到用户名了
    const tempPage = await session.context.newPage()
    await tempPage.goto(URLS.INDEX_PAGE)
    const accountName = await getAccountName(tempPage, SELECTORS.ACCOUNT_NAME)
    await tempPage.close()
    return accountName ?? ''
  }

  async disconnect(): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async performPopup(id: number, signal?: AbortSignal) {
    return Result.pipe(
      ensurePage(this.productsPage),
      Result.andThen(page => getItemFromVirtualScroller(page, elementFinder, id)),
      Result.andThen(item => elementFinder.getPopUpButtonFromGoodsItem(item)),
      Result.andThen(btn => toggleButton(btn, TEXT.POPUP_BUTTON, TEXT.POPUP_BUTTON_CANCLE, signal)),
    )
  }

  async performComment(message: string) {
    return Result.pipe(
      ensurePage(this.mainPage),
      Result.andThen(page => comment(page, elementFinder, message, false)),
    )
  }

  /**
   * 需要注入监听的页面。
   * 视频号的「讲解 / 结束讲解」按钮在商品列表页（productsPage），不在中控台（mainPage），
   * 所以必须以商品列表页为主；中控台页面作为兜底一起监听，避免官方调整入口位置后失效。
   */
  private getOpenPriceWatchPages(): Page[] {
    const pages: Page[] = []
    for (const page of [this.productsPage, this.mainPage]) {
      if (page && !pages.includes(page)) {
        pages.push(page)
      }
    }
    return pages
  }

  /**
   * 把监听脚本注入到页面的**每一个 frame**。
   * exposeFunction 会自动注册到该页所有 frame，但 evaluate 只作用于主 frame，
   * 而视频号商品列表在 Wujie 的 iframe 里，所以必须逐个 frame 注入。
   */
  private async injectWatcherIntoPage(page: Page): Promise<number> {
    if (!this.openPriceExposedPages.has(page)) {
      await page.exposeFunction('__wcOpenPriceTrigger', () => this.openPriceOnTrigger?.())
      this.openPriceExposedPages.add(page)
    }
    let injected = 0
    for (const frame of page.frames()) {
      try {
        await frame.evaluate(WECHAT_OPEN_PRICE_WATCHER_SCRIPT)
        injected++
      } catch {
        // 跨域 frame 无法注入脚本，跳过
      }
    }
    return injected
  }

  /** 注入后探测一次页面文本分布，写进运行日志，便于排查"点了讲解却没触发" */
  private async probeWatcherPages(pages: Page[]): Promise<void> {
    for (const page of pages) {
      for (const frame of page.frames()) {
        try {
          const info = (await frame.evaluate(WECHAT_OPEN_PRICE_PROBE_SCRIPT)) as {
            url: string
            roots: number
            ending: number
            idle: number
            sample: string
          }
          this.logger.info(
            `开价话术监听已就绪 [${info.url || 'about:blank'}] 根节点=${info.roots} 讲解中=${info.ending} 可讲解=${info.idle}`,
          )
          if (info.ending > 0 && info.sample) {
            this.logger.info(`讲解中元素示例：${info.sample}`)
          }
        } catch {
          // frame 不可访问，忽略
        }
      }
    }
  }

  async startOpenPriceWatcher(onTrigger: () => void): Result.ResultAsync<void, PlatformError> {
    this.openPriceOnTrigger = onTrigger
    const pages = this.getOpenPriceWatchPages()
    if (pages.length === 0) {
      return Result.fail(
        new ElementNotFoundError({ elementName: '视频号商品列表页 / 中控台页面' }),
      )
    }
    return Result.try({
      immediate: true,
      try: async () => {
        const errors: unknown[] = []
        let injected = 0
        for (const page of pages) {
          try {
            injected += await this.injectWatcherIntoPage(page)
          } catch (err) {
            // 单个页面注入失败（例如页面已关闭）不应导致整体启动失败
            errors.push(err)
          }
        }
        if (injected === 0) {
          throw errors[0] ?? new Error('无法注入开价监听脚本：所有候选页面都失败')
        }
        this.logger.success(`开价话术监听已注入 ${injected} 个 frame`)
        await this.probeWatcherPages(pages)
        // iframe 可能是稍后才挂载的，定期补注入一次（脚本内有幂等保护，不会重复挂 observer）
        this.startRescanTimer(pages)
      },
      catch: (err: unknown) =>
        err instanceof ElementNotFoundError
          ? err
          : new UnexpectedError({ description: String(err) }),
    })
  }

  private startRescanTimer(pages: Page[]): void {
    this.stopRescanTimer()
    this.openPriceRescanTimer = setInterval(() => {
      for (const page of pages) {
        if (page.isClosed()) continue
        this.injectWatcherIntoPage(page).catch(() => {})
      }
    }, 10_000)
  }

  private stopRescanTimer(): void {
    if (this.openPriceRescanTimer) {
      clearInterval(this.openPriceRescanTimer)
      this.openPriceRescanTimer = null
    }
  }

  stopOpenPriceWatcher(): void {
    this.stopRescanTimer()
    for (const page of this.openPriceExposedPages) {
      for (const frame of page.frames()) {
        frame
          .evaluate(() => {
            const w = globalThis as unknown as { __wcOpenPriceCleanup?: () => void }
            if (typeof w.__wcOpenPriceCleanup === 'function') {
              w.__wcOpenPriceCleanup()
            }
          })
          .catch(() => {})
      }
    }
    // 注意：不能清空 openPriceExposedPages，exposeFunction 的绑定无法撤销，
    // 清空会导致下次启动时重复注册而报错。
    this.openPriceOnTrigger = null
  }

  startCommentListener(onComment: (comment: LiveMessage) => void) {
    Result.pipe(
      ensurePage(this.mainPage),
      Result.inspect(page => {
        this.commentListener = new WeChatChannelCommentListener(page)
        this.commentListener.startCommentListener(onComment)
      }),
    )
  }

  stopCommentListener(): void {
    this.commentListener?.stopCommentListener()
  }

  async pinComment(comment: string): Result.ResultAsync<void, PlatformError> {
    const page = ensurePage(this.mainPage)
    if (Result.isFailure(page)) {
      return page
    }
    // 要先点击“新消息”按钮加载评论！
    const newCommentButton = await elementFinder.getNewCommentButton(page.value)
    if (Result.isSuccess(newCommentButton)) {
      await newCommentButton.value.click()
    }
    const els = await elementFinder.getComments(page.value)
    if (Result.isFailure(els)) {
      return els
    }
    for (const el of els.value.reverse()) {
      const text = ((await el.textContent()) ?? '').trim()
      if (comment === text) {
        // 找到匹配的评论，点击上墙按钮
        await el.click()
        const pinCommentActionItem = elementFinder.getPinCommentActionItem(page.value)
        await pinCommentActionItem.click()
        return Result.succeed()
      }
    }
    return Result.fail(
      new ElementContentMismatchedError({
        current: '未匹配任何评论',
        target: comment,
      }),
    )
  }

  getPinCommentPage(): Page | null {
    return this.mainPage
  }

  getCommentListenerPage(): Page {
    return Result.unwrap(ensurePage(this.commentListener?.getCommentListenerPage()))
  }

  getPopupPage() {
    return this.productsPage
  }

  getCommentPage() {
    return this.mainPage
  }

  get platformName() {
    return PLATFORM_NAME
  }
}
