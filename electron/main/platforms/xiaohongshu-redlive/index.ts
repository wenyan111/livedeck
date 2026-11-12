import type { BrowserSession } from '#/managers/BrowserSessionManager'
import { XiaohongshuPlatform } from '../xiaohongshu'
import { REGEXPS, URLS } from './constant'

/** 登录成功后会跳回这个地址；用它判断登录完成，比等某个 DOM class 稳 */
const LIVE_CONTROL_URL_RE = /redlive\.xiaohongshu\.com\/live_center_control/

/**
 * 小红书RedLive —— 小红书直播管理平台（redlive.xiaohongshu.com）。
 *
 * 与千帆共用同一套 DOM 实现，只覆盖 URL / 登录判定 / 平台名 / 判定选择器。
 * 若以后发现某个选择器不一样，在这里单独覆盖对应方法即可，不影响千帆和蒲公英。
 */
export class RedlivePlatform extends XiaohongshuPlatform {
  protected readonly urls = URLS
  protected readonly loginRegex = REGEXPS.LOGIN_PAGE
  protected readonly platformLabel = '小红书RedLive'

  /**
   * 用户 2026-11-12 的 DevTools 截图实测：页面根节点是 `#single-spa-ark-app`，
   * 还有 `.live-detail-container`；千帆的 `.app-root-topbar-wrapper` / `.user-info-wrapper`
   * 在 RedLive 上并不存在，照搬会让 connect()/login() 无限等下去（表现：扫码成功却一直「连接中」）。
   */
  protected readonly loggedInSelector = '#single-spa-ark-app, .live-detail-container'
  protected readonly inLiveControlSelector = '#single-spa-ark-app, .live-detail-container'

  /**
   * 连接流程自己实现，不用 helper.connect() 的
   * `Promise.race([waitForURL(登录页), waitForSelector(中控台元素)])`：
   * RedLive 登录成功后页面还会连续导航（日志里 3 次 navigated to live_center_control），
   * 那两个 timeout:0 的 Promise 一直挂着，连接状态就迟迟不变（用户 2026-11-12 反馈
   * 「扫码进中控台了但软件一直连接中」；日志里的 Target page closed 是用户后来
   * 手动关窗口造成的，不是卡住的原因）。
   *
   * 这里**只看 goto 之后的 URL，一次判定、不等待、不悬挂**：
   * 已登录 → 返回 true；未登录 → 返回 false，让 AccountSession 走它原本的流程
   * （切有头浏览器给用户扫码 → login() 等回中控台 → 保存登录态 → 无头重连）。
   * 千万别在这里「一直等到登录成功并返回 true」，否则有头浏览器根本不会被创建，
   * 用户连扫码的窗口都看不到。
   */
  async connect(session: BrowserSession): Promise<boolean> {
    const { page } = session
    await page.goto(this.urls.LIVE_CONTROL_PAGE, { waitUntil: 'domcontentloaded' })
    const url = page.url()
    const isConnected = LIVE_CONTROL_URL_RE.test(url) && !this.loginRegex.test(url)
    if (isConnected) {
      this.mainPage = page
    }
    return isConnected
  }

  /**
   * login() 作为兜底（正常流程上面的 connect 已等到中控台，不会被调用）。
   * 只看 URL，完全不依赖 DOM class。
   */
  async login(session: BrowserSession): Promise<void> {
    const { page } = session
    if (LIVE_CONTROL_URL_RE.test(page.url())) return
    if (!this.loginRegex.test(page.url())) {
      await page.goto(this.urls.LOGIN_PAGE)
    }
    await page.waitForURL(LIVE_CONTROL_URL_RE, {
      timeout: 0,
      waitUntil: 'domcontentloaded',
    })
  }
}
