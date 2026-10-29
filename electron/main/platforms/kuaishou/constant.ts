// 快手第一次登录会有莫名其妙的玩意，需要关闭：
// #driver-popover-item > div.driver-clearfix.driver-popover-footer > button

export const URLS = {
  LIVE_CONTROL: 'https://zs.kwaixiaodian.com/page/helper',
  LOGIN_PAGE:
    'https://login.kwaixiaodian.com/?biz=merchantLivePc&redirect_url=https%3A%2F%2Fzs.kwaixiaodian.com%2Fpage%2Fhelper',
} as const

export const REGEXPS = {
  LOGIN_PAGE: /login\.kwaixiaodian\.com\//,
}

export const SELECTORS = {
  ACCOUNT_NAME: '[class^=nickname] [class^=name]',
  LOGGED_IN: '[class^=nickname] [class^=name]',
  IN_LIVE_CONTROL: 'div[class^=live-panel]',
  DRIVER_POPOVER: '#driver-page-overlay',

  GOODS_ITEM: '[class^=list-container] [class^=list-item]',
  GOODS_ITEMS_WRAPPER: '[class^=list-container] [data-virtuoso-scroller]',
  goodsItem: {
    ID: 'input',
    POPUP_BUTTON: '[class^=cardBtn] > button:last-child',
    // 若有正在弹窗的商品，不管是结束弹窗还是开始弹窗都会弹出一个 modal
    // 需要点击 modal 上的确认按钮才能执行下一步操作
    POPUP_CONFIRM_BUTTON: '.ant-modal-root button:last-child',
  },
  CLOSE_VIDEO_BTN: '[class^=live-panel] [class^=btn] > div:first-child',
  VIDEO: '[class^=video-container]',
  commentList: {
    /**
     * 互动评论列表条目（快速路径，命中即用；找不到会退化到「按文本定位」）。
     *
     * ⚠️ 别再放宽它（2026-10-29 教训）：曾试图逐级放宽到 `div[class*=commentItem]`
     * 乃至任意 `[class*=commentItem]`，想覆盖「快手没有 #comment-list-wrapper 容器」
     * 的情况。但快速路径是**不经验证直接采用**的，放宽后可能命中错误元素，反而
     * 绕过下面那条已经验活的 hover 校验路径。实测快手根本不走这条快速路径
     * （命中的是输入区引用块 `replied-content--UayMH`），真正在起作用的是
     * element-finder 里的「按文本定位 + hover 验证」。要放宽必须**同时**给快速路径
     * 加上 hover 验证，否则宁可不改。
     */
    ITEM: '#comment-list-wrapper div[class^="commentItem"]',
    /**
     * 悬浮工具条的候选选择器（hover 评论后才渲染）。
     * 只用于诊断探测，不用于点击——猜错的选择器点了会点偏。
     * 拿到真实 DOM 后把确认过的选择器补到这里即可收敛。
     */
    HOVER_TOOLBAR: [
      'div[class*=operation]',
      'div[class*=Operation]',
      'div[class*=operate]',
      'div[class*=Operate]',
      'div[class*=action]',
      'div[class*=Action]',
      'div[class*=toolbar]',
      'div[class*=Toolbar]',
    ],
  },
  commentInput: {
    TEXTAREA: 'div[class^=reply-content] input[type=text]',
    // 回复框下方的「置顶评论」复选框（勾选后再发送即为置顶）。
    // 页面上它不一定渲染成 <label>，element-finder 里另有多级兜底（容器内按文本搜索）。
    PIN_TOP_LABEL: '[class*=reply-content] label:has-text("置顶")',
    SUBMIT_BUTTON: 'div[class^=reply-content] button',
  },
  overlays: {
    // 刚进中控台弹出的：团购模式全新上线，选择暂不切换（第一个按钮）
    SWITCH_TO_GROUP_BUYING: '.ant-modal-root button',
    // 开启直播后，中控台会弹出窗口：已开启直播，选择我知道了（唯一一个按钮（
    LIVE_ON: '.ant-modal-root button',
  },
} as const
