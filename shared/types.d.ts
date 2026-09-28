declare type Account = {
  readonly id: string
  name: string
}

declare interface ProviderInfo {
  name: string
  baseURL: string
  apiUrl: string
  models: string[]
}

declare type LiveControlPlatform =
  | 'douyin'
  | 'buyin'
  | 'eos'
  | 'xiaohongshu'
  | 'pgy'
  | 'wxchannel'
  | 'kuaishou'
  | 'taobao'
  | 'dev'

declare type GoodsItem = {
  id: number
  /** 单品循环弹窗次数，默认 1 */
  repeatCount?: number
  /** 单品弹窗间隔 [min, max] 毫秒，不设则用全局间隔 */
  itemInterval?: [number, number]
}

declare type AutoPopupConfig = {
  scheduler: {
    interval: [number, number]
  }
  goodsIds: number[]
  goodsItems?: GoodsItem[]
  random?: boolean
}

declare type AutoPopupTask = {
  type: 'auto-popup'
  config: AutoPopupConfig
}

declare type AutoCommentConfig = {
  scheduler: {
    interval: [number, number]
  }
  messages: {
    content: string
    pinTop: boolean
  }[]
  random?: boolean
  extraSpaces?: boolean
  unlimitedLength?: boolean
}

declare type AutoCommentTask = {
  type: 'auto-comment'
  config: AutoCommentConfig
}

declare type SendBatchMessagesConfig = {
  messages: string[]
  count: number
  noSpace?: boolean
}

declare type SendBatchMessagesTask = {
  type: 'send-batch-messages'
  config: SendBatchMessagesConfig
}

/** 开价变预热时按顺序发送的全部话术（首条置顶） */
declare type OpenPriceMessagesConfig = {
  messages: {
    content: string
    pinTop: boolean
  }[]
}

declare type OpenPriceMessagesTask = {
  type: 'send-open-price-messages'
  config: OpenPriceMessagesConfig
}

/** 跨平台开价联动：一个跟随账号的配置 */
declare type OpenPriceLinkageTarget = {
  accountId: string
  /** 是否跟随触发源一起发开价话术 */
  follow: boolean
  /**
   * 该平台自身也能检测开价时，参与联动期间是否停用自身检测。
   * 不停用会出现「自身检测发一次 + 联动又发一次」的重复发送。
   */
  disableSelfWatch: boolean
}

/** 跨平台开价联动配置 */
declare type OpenPriceLinkageConfig = {
  /** 总开关 */
  enabled: boolean
  /** 触发源账号，该账号必须支持开价监听（巨量百应 / 抖音小店 / 视频号） */
  sourceAccountId: string | null
  targets: OpenPriceLinkageTarget[]
  /** 同一账号开价话术的发送冷却（毫秒），兜底防止重复发送 */
  cooldownMs: number
}

declare interface CommentListenerConfig {
  source: 'compass' | 'control' | 'wechat-channel' | 'xiaohongshu' | 'taobao' | 'kuaishou'
  ws?: {
    port: number
  }
}

declare type CommentListenerTask = {
  type: 'comment-listener'
  config: CommentListenerConfig
}

declare type PinCommentTask = {
  type: 'pin-comment'
  config: {
    comment: string
  }
}

declare type LiveControlTask =
  | AutoPopupTask
  | AutoCommentTask
  | SendBatchMessagesTask
  | CommentListenerTask
  | PinCommentTask
  | OpenPriceMessagesTask

declare type DouyinLiveMessage = {
  time: number
} & (
  | CommentMessage
  | RoomEnterMessage
  | RoomLikeMessage
  | LiveOrderMessage
  | SubscribeMerchantBrandVipMessage
  | RoomFollowMessage
  | EcomFansclubParticipateMessage
)

interface CommentMessage {
  msg_type: 'comment'
  msg_id: string
  nick_name: string
  content: string
}

interface RoomEnterMessage {
  msg_type: 'room_enter'
  msg_id: string
  nick_name: string
  user_id: string
}

interface RoomLikeMessage {
  msg_type: 'room_like'
  msg_id: string
  nick_name: string
  user_id: string
}

interface SubscribeMerchantBrandVipMessage {
  msg_type: 'subscribe_merchant_brand_vip'
  msg_id: string
  nick_name: string
  user_id: string
  content: string
}

interface RoomFollowMessage {
  msg_type: 'room_follow'
  msg_id: string
  nick_name: string
  user_id: string
}

interface EcomFansclubParticipateMessage {
  msg_type: 'ecom_fansclub_participate'
  msg_id: string
  nick_name: string
  user_id: string
  content: string
}

interface LiveOrderMessage {
  msg_type: 'live_order'
  nick_name: string
  msg_id: string
  order_status: '已下单' | '已付款' | '未知状态'
  order_ts: number
  product_id: string
  product_title: string
}

declare type WechatChannelLiveMessage = {
  msg_type: 'wechat_channel_live_msg'
  msg_id: string
  nick_name: string
  user_id: string
  content: string
  time: number
}

declare type XiaohongshuCommentLiveMessage = {
  msg_type: 'xiaohongshu_comment'
  msg_id: string
  nick_name: string
  user_id: string
  content: string
  time: number
}

declare type TaobaoCommentLiveMessage = {
  msg_type: 'taobao_comment'
  msg_id: string
  nick_name: string
  user_id: string
  content: string
  time: number
}

declare type LiveMessage =
  | WechatChannelLiveMessage
  | DouyinLiveMessage
  | XiaohongshuCommentLiveMessage
  | TaobaoCommentLiveMessage
