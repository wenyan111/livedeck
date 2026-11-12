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
  // 登录流程实测（用户 2026-11-12 四张截图）：
  //   customer 统一登录(扫码) → redlive.xiaohongshu.com/live_account_select(选账号)
  //   → redlive.xiaohongshu.com/live_center_control(中控台)
  // 账号选择页必须算「还没登录」，否则 connect() 会误判成功、
  // login() 也会把用户正在选账号的页面重新 goto 掉。
  LOGIN_PAGE: /.*(customer|redlive)\.xiaohongshu\.com\/.*(login|passport|live_account_select).*/,
} as const
