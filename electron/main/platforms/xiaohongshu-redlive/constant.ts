import type { XiaohongshuUrls } from '../xiaohongshu'

/**
 * 小红书RedLive（直播管理平台）
 * https://redlive.xiaohongshu.com/live_center_control
 *
 * 用户 2026-11-12 的 DevTools 截图实测：整个站是 omikuji SPA，
 * 登录页 / 账号选择页 / 中控台是同一套壳的不同路由，
 * 所以连接流程照「蒲公英」那套写（见 index.ts），这里只放它专属的地址与选择器。
 */
export const URLS: XiaohongshuUrls = {
  LOGIN_PAGE:
    'https://customer.xiaohongshu.com/login?service=https%3A%2F%2Fredlive.xiaohongshu.com%2Flive_center_control',
  LIVE_CONTROL_PAGE: 'https://redlive.xiaohongshu.com/live_center_control',
}

export const REGEXPS = {
  // 登录流程：`live_login`(短信/扫码) → `live_account_select`(用户点账号)
  //          → `live_center_control`(中控台)
  // 不限子域；live_center_control 不含这几个关键词，不会被误判成登录页。
  LOGIN_PAGE: /xiaohongshu\.com\/.*(login|passport|account_select)/,
  // 登录完成、用户点完账号后回到这里
  LIVE_CONTROL_PAGE: /redlive\.xiaohongshu\.com\/live_center_control/,
} as const

/**
 * 渲染后 DOM（用户 2026-11-12 DevTools 截图，Elements 面板）：
 *   <div id="omikuji-app" data-v-app>
 *     <div class="page-container">
 *       <div class="container-layout app-container">
 *         <div class="container-nav"><div class="right">
 *           <div class="user-info"><div class="user-name">亲爱的黎子（瘦身版）
 *
 * 🔴 之前误用 `#single-spa-ark-app` / 千帆的 `.app-root-topbar-wrapper`，
 * RedLive 页面上根本没这些元素，waitForSelector 就永远不命中 → 一直「连接中」。
 */
export const SELECTORS = {
  /** 右上角昵称：判断「已登录」，对应蒲公英的 ACCOUNT_NAME / LOGGED_IN */
  ACCOUNT_NAME: '.container-nav .right .user-info .user-name, .user-name',
  /** 中控台根容器：重开页面后等它渲染完，对应蒲公英的 IN_LIVE_CONTROL */
  IN_LIVE_CONTROL: '#omikuji-app .page-container, #omikuji-app .container-layout',
} as const
