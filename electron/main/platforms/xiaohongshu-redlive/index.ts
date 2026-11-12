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
   * 登录判定只看 URL：
   * - 已经在中控台 → 直接算登录完成，不再无谓跳一次登录页；
   * - 否则等扫码后跳回中控台（timeout 0 是因为扫码可能要等几分钟）。
   * 完全不依赖 DOM class，避免页面改版又把登录卡死。
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
