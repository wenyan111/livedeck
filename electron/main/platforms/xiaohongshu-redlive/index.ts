import type { BrowserSession } from '#/managers/BrowserSessionManager'
import { XiaohongshuPlatform } from '../xiaohongshu'
import { REGEXPS, URLS } from './constant'

/** 登录成功（用户点完账号）后会跳回这里 */
const LIVE_CONTROL_URL_RE = /redlive\.xiaohongshu\.com\/live_center_control/

/**
 * 小红书RedLive —— 小红书直播管理平台（redlive.xiaohongshu.com）。
 *
 * 和其它平台一样走父类 `helper.connect()` 的标准竞速
 * （waitForURL(登录页) / waitForSelector(已登录标志)），
 * 这里只把 URL、登录页正则、判定选择器配正确，不另造一套连接流程。
 * 千帆 / 蒲公英行为完全不变。
 */
export class RedlivePlatform extends XiaohongshuPlatform {
  protected readonly urls = URLS
  protected readonly loginRegex = REGEXPS.LOGIN_PAGE
  protected readonly platformLabel = '小红书RedLive'

  /**
   * DevTools 实测：中控台根节点是 `#single-spa-ark-app`，还有 `.live-detail-container`；
   * 登录页（live_login）和账号选择页（live_account_select，根节点是 omikuji-app）都没有。
   * 千帆的 `.app-root-topbar-wrapper` / `.user-info-wrapper` 在这里不存在，照搬会让
   * connect() 的 waitForSelector 永远不命中。
   */
  protected readonly loggedInSelector = '#single-spa-ark-app, .live-detail-container'
  protected readonly inLiveControlSelector = '#single-spa-ark-app, .live-detail-container'

  /**
   * 等用户扫码 + 在 live_account_select 点账号 + 跳回中控台，才算登录完成。
   * 登录页 / 选账号页都继续等，不会提前返回（用户 2026-11-12 明确要求：
   * 「要我点击一个账号后跳转到中控台才显示已连接才对」）。
   * timeout 0 是因为扫码可能要等几分钟——和其它平台的 login() 一致。
   */
  async login(session: BrowserSession): Promise<void> {
    const { page } = session
    if (
      LIVE_CONTROL_URL_RE.test(page.url()) &&
      (await page.$('#single-spa-ark-app').catch(() => null))
    ) {
      return
    }
    if (!this.loginRegex.test(page.url())) {
      await page.goto(this.urls.LOGIN_PAGE)
    }
    await page.waitForURL(LIVE_CONTROL_URL_RE, {
      timeout: 0,
      waitUntil: 'domcontentloaded',
    })
    // URL 到了不代表 DOM 渲染完，等中控台根节点出现（有限超时，不悬挂）
    await page
      .waitForSelector(this.inLiveControlSelector, { state: 'attached', timeout: 20000 })
      .catch(() => {})
  }
}
