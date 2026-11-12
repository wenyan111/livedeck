import type { BrowserSession } from '#/managers/BrowserSessionManager'
import { openUrlByElement } from '../helper'
import { XiaohongshuPlatform } from '../xiaohongshu'
import { REGEXPS, SELECTORS, URLS } from './constant'

/**
 * 小红书RedLive —— 直播管理平台（redlive.xiaohongshu.com）。
 *
 * 连接/登录流程**照蒲公英 `XiaohongshuPgyPlatform` 的骨架**实现，只把地址与
 * 选择器换成 RedLive 实测值（用户 2026-11-12 的 DevTools 截图）：
 *   1. goto 中控台
 *   2. Promise.race([等跳登录页, 等右上角昵称出现])  —— 判定是否已登录
 *   3. 已登录 → openUrlByElement 重开一页进中控台（绕开小红书反爬）
 *   4. 未登录 → 返回 false，由 AccountSession 切有头浏览器给用户扫码 + 选账号
 *
 * 之前所有「一直连接中」的根因都是选择器不对：`#single-spa-ark-app`、
 * 千帆的 `.app-root-topbar-wrapper` / `.user-info-wrapper` 在 RedLive 上都不存在，
 * 于是 timeout:0 的 waitForSelector 永远不命中。现在用真实存在的 `.user-name`。
 * 千帆 / 蒲公英行为完全不变。
 */
export class RedlivePlatform extends XiaohongshuPlatform {
  protected readonly urls = URLS
  protected readonly loginRegex = REGEXPS.LOGIN_PAGE
  protected readonly platformLabel = '小红书RedLive'
  protected readonly loggedInSelector = SELECTORS.ACCOUNT_NAME
  protected readonly inLiveControlSelector = SELECTORS.IN_LIVE_CONTROL

  async connect(session: BrowserSession): Promise<boolean> {
    const { page } = session
    await page.goto(this.urls.LIVE_CONTROL_PAGE, { waitUntil: 'domcontentloaded' })
    await Promise.race([
      page.waitForURL(this.loginRegex, { timeout: 0, waitUntil: 'domcontentloaded' }),
      page.waitForSelector(SELECTORS.ACCOUNT_NAME, {
        timeout: 0,
        state: 'attached',
      }),
    ])
    const isConnected = !this.loginRegex.test(page.url())

    if (isConnected) {
      // 和蒲公英一样：小红书反爬，用 <a target=_blank> 重开一页进中控台
      const newPage = await openUrlByElement(page, this.urls.LIVE_CONTROL_PAGE)
      await page.close()
      session.page = newPage
      this.mainPage = newPage
      // 等中控台容器渲染完（有限超时，别再卡成「连接中」）
      await newPage
        .waitForSelector(SELECTORS.IN_LIVE_CONTROL, { state: 'attached', timeout: 15000 })
        .catch(() => {})
    }
    return isConnected
  }

  /**
   * 等用户扫码 + 在 live_account_select 点账号 + 跳进中控台，才算登录完成。
   * 登录页 / 选账号页都继续等（用户 2026-11-12 明确要求）。
   */
  async login(session: BrowserSession): Promise<void> {
    const { page } = session
    if (!this.loginRegex.test(page.url())) {
      await page.goto(this.urls.LOGIN_PAGE)
    }
    await page.waitForURL(REGEXPS.LIVE_CONTROL_PAGE, {
      timeout: 0,
      waitUntil: 'domcontentloaded',
    })
    await page
      .waitForSelector(SELECTORS.ACCOUNT_NAME, { state: 'attached', timeout: 20000 })
      .catch(() => {})
  }

  /** 右上角昵称；取不到就留空，绝不 waitForSelector 卡 30 秒 */
  async getAccountName(session: BrowserSession): Promise<string> {
    const el = await session.page.$(SELECTORS.ACCOUNT_NAME).catch(() => null)
    const text = el ? (await el.textContent().catch(() => ''))?.trim() : ''
    if (text) {
      this.accountName = text.endsWith('的店') ? text.slice(0, -2) : text
    }
    return this.accountName
  }
}
