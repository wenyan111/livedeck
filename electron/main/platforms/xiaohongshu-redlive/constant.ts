import type { XiaohongshuUrls } from '../xiaohongshu'

/**
 * RedLive（小红书直播管理平台）
 * https://redlive.xiaohongshu.com/live_center_control
 *
 * 用户 2026-11-12 提供的 DevTools 截图里能看到 `single-spa-ark-app`，
 * 说明它和千帆（ark.xiaohongshu.com）跑的是同一套 single-spa 应用，
 * 所以 SELECTORS / commentListener / elementFinder 全部复用 xiaohongshu/，
 * 这里只换域名与登录跳转地址。
 */
export const URLS: XiaohongshuUrls = {
  LOGIN_PAGE:
    'https://customer.xiaohongshu.com/login?service=https%3A%2F%2Fredlive.xiaohongshu.com%2Flive_center_control',
  LIVE_CONTROL_PAGE: 'https://redlive.xiaohongshu.com/live_center_control',
}

export const REGEXPS = {
  // 登录流程实测（用户 2026-11-12 截图）：
  //   ...xiaohongshu.com/live_login (短信/扫码)
  //   → redlive.xiaohongshu.com/live_account_select (选账号，用户手点)
  //   → redlive.xiaohongshu.com/live_center_control (中控台)
  // 🔴 不要限定子域：登录页可能落在 customer / redlive / www 下。
  // 之前限定 (customer|redlive)，helper.connect() 的 waitForURL(LOGIN_PAGE)
  // 永远不命中，两个 timeout:0 的 Promise 一起挂着 → 一直「连接中」。
  // live_center_control 不含 login / account_select，不会被误判成登录页。
  LOGIN_PAGE: /xiaohongshu\.com\/.*(login|passport|account_select)/,
} as const
