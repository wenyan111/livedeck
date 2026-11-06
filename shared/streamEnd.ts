/**
 * 「已下播」信号定义。
 *
 * 各平台下播后都会给出明确提示（2026-11-05 用户逐个平台截图确认）：
 *   快手     「本场直播已结束」整块面板
 *   视频号   「生成直播回放视频」弹窗
 *   淘宝     「直播间状态无效」红色提示条（出现后会消失）
 *   小红书   「直播已结束」弹窗 + 本场数据
 *   抖音     「直播已结束」弹窗 + 成交金额
 *
 * `scope: 'modal'` 表示只在可见弹层里匹配（更准，避免页面历史记录误判）；
 * `scope: 'any'` 允许全页匹配（快手那种整块面板、淘宝那种一闪而过的提示条）。
 */
export interface StreamEndSignal {
  text: string
  scope: 'modal' | 'any'
}

export const STREAM_END_SIGNALS: Partial<Record<LiveControlPlatform, StreamEndSignal[]>> = {
  kuaishou: [{ text: '本场直播已结束', scope: 'any' }],
  wxchannel: [
    // 正常下播：会弹「生成直播回放视频」
    { text: '生成直播回放视频', scope: 'any' },
    // 被平台直接掐断（违规 / 断流）：整页变成「直播已结束 + 因违反《微信视频号直播…》」，
    // 既不会跳首页、也不会弹回放窗，只认上面那条的话会一直以为这场还在播（2026-11-06 用户反馈）
    { text: '本场直播已结束', scope: 'any' },
    { text: '因违反《微信视频号直播', scope: 'any' },
  ],
  taobao: [{ text: '直播间状态无效', scope: 'any' }],
  xiaohongshu: [{ text: '直播已结束', scope: 'modal' }],
  // 小红书蒲公英是独立平台 key（'pgy'），不写这条它关播后永远不会自动断开（2026-11-06 用户反馈）
  pgy: [
    { text: '直播已结束', scope: 'modal' },
    { text: '本场数据', scope: 'modal' },
  ],
  douyin: [{ text: '直播已结束', scope: 'modal' }],
  buyin: [{ text: '直播已结束', scope: 'modal' }],
}
