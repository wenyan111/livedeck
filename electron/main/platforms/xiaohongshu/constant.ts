// export const login: LoginConstants = {
//   liveControlUrl: 'https://ark.xiaohongshu.com/live_center_control',
//   loginUrl:
//     'https://customer.xiaohongshu.com/login?service=https%3A%2F%2Fark.xiaohongshu.com%2Flive_center_control',
//   loginUrlRegex: /.*customer\.xiaohongshu\.com\/login.*/,

//   isLoggedInSelector: '.user-info-wrapper',
//   // isInLiveControlSelector: '.comment-container',
//   isInLiveControlSelector: '.app-root-topbar-wrapper',
//   hoverSelector: '.user-info-wrapper',
//   accountNameSelector: '.sellerId-name',
// }

export const URLS = {
  LOGIN_PAGE:
    'https://customer.xiaohongshu.com/login?service=https%3A%2F%2Fark.xiaohongshu.com%2Flive_center_control',
  LIVE_CONTROL_PAGE: 'https://ark.xiaohongshu.com/live_center_control',
} as const

export const REGEXPS = {
  LOGIN_PAGE: /.*customer\.xiaohongshu\.com\/login.*/,
}

export const SELECTORS = {
  LOGGED_IN: '.user-info-wrapper',
  IN_LIVE_CONTROL: '.app-root-topbar-wrapper',

  ACCOUNT_NAME_HOVER: '.user-info-wrapper',
  // ACCOUNT_NAME: '.sellerId-name',
  ACCOUNT_NAME: '.user-info-wrapper .store-name',

  // 商品列表行候选选择器（按优先级）。
  // 2026-09 实测蒲公英（pgy.xiaohongshu.com）中控台结构：
  //   .goods-list > .goods-card-list > .goods-card            ← 商品行
  //     .goods-card__index input                              ← 商品序号（value / placeholder）
  //     .goods-card__title-block .d-text                      ← 商品名 + 「商品ID：xxx」
  //     .goods-card__action-row > .goods-card__action-btn      ← 下架 / 置顶 / 弹卡 / 讲解
  // 旧结构（千帆 ark.xiaohongshu.com 仍在用）保留在候选里兜底。
  GOODS_ITEM: '.goods-list .goods-card',
  GOODS_ITEM_CANDIDATES: [
    '.goods-list .goods-card',
    '.goods-card-list .goods-card',
    '.goods-list .table-wrap > div > div > table tbody tr',
    '.goods-list table tbody tr',
    '.goods-list tbody tr',
    '.goods-list [class*="table"] tbody tr',
    '[class*="goods-list"] tbody tr',
    '[class*="goodsList"] tbody tr',
  ],
  GOODS_ITEMS_WRAPPER: '.goods-list .goods-card-list',
  GOODS_ITEMS_WRAPPER_CANDIDATES: [
    '.goods-list .goods-card-list',
    '.goods-card-list',
    '.goods-list .table-wrap > div > div',
    '.goods-list [class*="table"]',
    '.goods-list',
  ],

  COMMENT_INPUT: {
    // 多个候选选择器，按优先级尝试。
    // 评论区常嵌于 iframe，故同时覆盖「iframe 内 #redlive-pgy-app 根」与「通用后代」写法，
    // 小红书改版导致某一层 class 变化时仍可命中。
    TEXTAREA_CANDIDATES: [
      '#redlive-pgy-app .comment-input textarea',
      '.comment-input textarea',
      '.comment-input .d-textarea-wrapper textarea',
      'textarea[class*="d-textarea"]',
    ],
    SUBMIT_BUTTON_CANDIDATES: [
      '.comment-input button',
      '[aria-label*="发送"]',
      '[class*="submit"]',
      '[class*="send"]',
    ],
    SUBMIT_BUTTON_DISABLED: 'disabled',
  },

  GOODS_ITEM_INNER: {
    OPERATION_PANNEL: '.more-operation',
    OPERATION_ITEM: '.operation-item',
    POPUP_BUTTON_DISABLED: 'disabled-btn',
    // 旧版（表格结构）：第一列的序号 input
    ID: 'td:first-child input',
    // 商品序号读取候选（按优先级）。
    // 新版序号是 `.goods-card__index` 里的文本输入框，值在 value / placeholder 上，
    // 且「直播渠道置顶行」没有序号框——所以按行逐一尝试，读不到就认为该行不可用序号定位。
    INDEX_CANDIDATES: [
      '.goods-card__index input',
      '[class*="index"] input',
      'td:first-child input',
      'input[type="text"]',
      'input:not([type])',
    ],
    // 新版操作按钮区与按钮（「弹卡」是 div，其余是 button，故不带 tag 限定）
    ACTION_ROW: '.goods-card__action-row',
    ACTION_BUTTON: '.goods-card__action-btn',
  },
} as const

export const TEXTS = {
  POPUP_BUTTON: '讲解',
  POPUP_BUTTON_CANCLE: '结束讲解',
} as const
