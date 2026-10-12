export const URLS = {
  LOGIN_PAGE:
    'https://login.taobao.com/havanaone/login/login.htm?bizName=taobao&sub=true&redirectURL=https%3A%2F%2Fliveplatform.taobao.com%2Frestful%2Findex%2Flive%2Flist',
  /** 淘宝需要从直播计划进入中控台 */
  LIVE_LIST: 'https://liveplatform.taobao.com/restful/index/live/list', // 这是直播计划，并不是中控台，真正的中控台需要直播中才能访问
  LIVE_CONTROL_WITH_ID: 'https://liveplatform.taobao.com/restful/index/live/control?liveId=', // 后面的 liveId 需要动态获取
  HOME_PAGE: 'https://liveplatform.taobao.com/restful/index/home/dashboard-new',
} as const

export const REGEXPS = {
  LOGIN_PAGE: /.*login\.taobao\.com\/.*/,
}

export const SELECTORS = {
  ACCOUNT_NAME: 'div[class^=username]',
  IN_LIVE_LIST: 'div.tblalm-lm-content', // 这是直播计划
  /** `IN_LIVE_LIST` 的兜底：只认 class 片段，淘宝改版换了构建产物前缀也能认出「已进到直播计划页」 */
  IN_LIVE_LIST_FALLBACK: '[class*="lm-content"]',
  LIVE_ID:
    '#scrollableDiv .tblalm-lm-list-item-live.online .tblalm-lm-list-item-live-subTitle-id .tui-number-figure',
  /**
   * 直播间 ID 的候选定位方式，**从严格到宽松**依次尝试。
   * 淘宝的 class 是构建产物（tblalm-xxx / tui-xxx），改版后命名会变，
   * 只认一条完整 class 链（还要带 .online）极易永久失效，所以按「class 片段」逐级兜底。
   */
  LIVE_ID_CANDIDATES: [
    '#scrollableDiv .tblalm-lm-list-item-live.online .tblalm-lm-list-item-live-subTitle-id .tui-number-figure',
    '[class*="list-item-live"][class*="online"] [class*="subTitle-id"]',
    '[class*="list-item-live"] [class*="subTitle-id"]',
    '[class*="subTitle-id"]',
  ],
  GOODS_ITEM: '#livePushed-tcl-unique-scroll-list .list-item',
  GOODS_ITEMS_WRAPPER: '#tcl-unique-virtual-list',
  commentInput: {
    TEXTAREA: '#comment-page div.tc-comment-reply textarea',
    SUBMIT_BUTTON:
      '#comment-page div.tc-comment-reply div.tc-comment-reply-footer div.tc-comment-reply-publish-button button',
  },
  goodsItem: {
    ID: 'div.list-item-img-index',
    ID_ALTER: 'input[data-tblalog-id="sort_input"]',
    POPUP_BUTTON: 'button[data-tblalog-id="tanPin"]', // button[data-tblalog-id="jiangJie"]
  },
  overlays: {
    DRIVER: '#driver-highlighted-element-stage-overlay',
  },
} as const
