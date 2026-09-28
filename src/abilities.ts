import type { AutoReplyConfig } from './hooks/useAutoReplyConfig'

type ListeningSource = AutoReplyConfig['entry']

/** 平台中文名（各处统一引用，避免各自维护一份） */
export const platformLabels: Record<LiveControlPlatform, string> = {
  douyin: '抖音小店',
  buyin: '巨量百应',
  eos: '抖音团购',
  xiaohongshu: '小红书千帆',
  pgy: '小红书蒲公英',
  wxchannel: '视频号',
  kuaishou: '快手小店',
  taobao: '淘宝',
  dev: '测试平台',
}

export const listeningSources: Record<ListeningSource, { name: string; tips: string }> = {
  compass: {
    name: '电商罗盘大屏',
    tips: '电商罗盘大屏监听可以获取评论、点赞、进入直播间等全部消息类型',
  },
  control: {
    name: '中控台',
    tips: '中控台监听只能获取评论消息',
  },
  'wechat-channel': {
    name: '视频号',
    tips: '视频号监听目前暂时只支持用户评论消息',
  },
  xiaohongshu: {
    name: '小红书',
    tips: '小红书监听目前暂时只支持用户评论消息',
  },
  taobao: {
    name: '淘宝',
    tips: '淘宝监听目前暂时只支持用户评论消息',
  },
  kuaishou: {
    name: '快手',
    tips: '快手监听目前暂时只支持用户评论消息',
  },
} as const

type Ability = {
  autoReply?: {
    source: ListeningSource[]
  }
  /**
   * 开价话术相关能力。
   * - `send`：能否发送开价话术（实现 IPerformComment）—— 决定「开价话术」页面是否可用。
   * - `selfDetect`：能否自己检测「开价变预热」（实现 IOpenPriceWatcher）—— 决定能否点「开始任务」。
   *   检测不了的平台（快手 / 小红书 / 淘宝等）只能靠「跨平台开价联动」被触发发送。
   */
  openPrice?: {
    send: boolean
    selfDetect: boolean
  }
}

export const abilities: Record<LiveControlPlatform, Ability> = {
  douyin: {
    autoReply: {
      source: ['compass', 'control'],
    },
    openPrice: { send: true, selfDetect: true },
  },
  buyin: {
    autoReply: {
      source: ['compass', 'control'],
    },
    openPrice: { send: true, selfDetect: true },
  },
  eos: {},
  kuaishou: {
    autoReply: {
      source: ['kuaishou'],
    },
    openPrice: { send: true, selfDetect: false },
  },
  wxchannel: {
    autoReply: {
      source: ['wechat-channel'],
    },
    openPrice: { send: true, selfDetect: true },
  },
  xiaohongshu: {
    autoReply: {
      source: ['xiaohongshu'],
    },
    openPrice: { send: true, selfDetect: false },
  },
  pgy: {
    autoReply: {
      source: ['xiaohongshu'],
    },
    openPrice: { send: true, selfDetect: false },
  },
  taobao: {
    autoReply: {
      source: ['taobao'],
    },
    openPrice: { send: true, selfDetect: false },
  },
  dev: {
    autoReply: {
      source: ['compass', 'control', 'wechat-channel', 'xiaohongshu', 'taobao'],
    },
    openPrice: { send: true, selfDetect: false },
  },
}

export const autoReplyPlatforms = Object.entries(abilities)
  .filter(([_, s]) => s.autoReply && s.autoReply.source.length > 0)
  .map(([p, _]) => p) as LiveControlPlatform[]

/** 能用「开价话术」页面的平台（都能发送话术） */
export const openPricePlatforms = Object.entries(abilities)
  .filter(([_, s]) => s.openPrice?.send)
  .map(([p, _]) => p) as LiveControlPlatform[]

/** 能自己检测开价的平台，只有这些能开「开始任务」监听 */
export const openPriceSelfDetectPlatforms = Object.entries(abilities)
  .filter(([_, s]) => s.openPrice?.selfDetect)
  .map(([p, _]) => p) as LiveControlPlatform[]
