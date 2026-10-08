import type { CDPSession, Page, Response } from 'playwright'

interface WebSocketFrameReceivedEvent {
  requestId: string
  timestamp: number
  response: {
    opcode: number
    mask: boolean
    payloadData: string // 就你要的
  }
}

interface XiaohongshuWebSocketMessage {
  /** 1 */
  v: number
  /** 4 是需要的; 0 没有任何东西 */
  t: number
  /** 0ac开头，不知道是什么玩意 */
  m: string
  b: {
    d: {
      /** 0 */
      a: 0
      b: Array<{
        /** 这就是需要的信息，base64 编码 */
        d: string
        // biome-ignore lint/complexity/noBannedTypes: 暂时不知道 e 里有什么，就是个 {}
        e: {}
        /** 一串数字开头不知道是什么，是递增的 */
        m: string
      }>
      /** 值都是 room */
      biz: 'room'
      /** 时间戳 */
      t: number
    }
  }
}

interface ParsedWebsocketMessage {
  /** 1 是有用的，3 不管他 */
  command: number
  /** JSON 字符串，能转成 XiaohongshuMessage */
  customData: string
  msgId: string
  /** 3 */
  priority: number
  roomId: string
  /** LIVE */
  roomType: string
  /** 时间戳 */
  ts: number
  uuid: string
}

interface XiaohongshuMessage {
  /** text | refresh | letter_refresh | goods_rank_entrance_im 等等，评论就是 text */
  type: string
  /** 时间戳 */
  current_time: number
  source: string
  translated: boolean
  at_users: []
  /** 'zh-cn' | 'num_sp_ch'（数字字符） */
  origin_language: string
  commentId: string
  profile: {
    /** url */
    avatar: string
    nickname: string
    /** 可能主播是 1 */
    role: number
    user_id: string
    follow_status: number
  }
  /** 评论内容 */
  desc: string
  /** 0 */
  comment_type: number
  aggregate: boolean
  /** 1 */
  ack_code: number
}

interface XiaohongshuSendCommentResponse {
  data: {
    comment: string
    common_response: {
      common_result: number
      toast: string
    }
    profile: {
      user_id: string
    }
  }
  code: number
  success: boolean
}

export class XiaohongshuCommentListener {
  private client: CDPSession | null = null
  private accountName = ''
  private handleComment: (comment: LiveMessage) => void = () => {}
  /**
   * 我们自己的 user_id：从「发送评论」响应里学到。
   * 小红书会把客服/主播自己发出去的消息也通过 WebSocket 回推一次，
   * 必须靠它把「自己发的」从评论流里剔除，否则机器人会把自己的回复
   * 当成观众评论，陷入「自问自答」死循环（历史上表现为几秒一轮刷屏）。
   */
  private selfUserId: string | null = null
  /**
   * 自己刚发出去的评论内容 + 时间。作为 user_id 之外的兜底：
   * 万一回推的消息没带 user_id（或 id 体系对不上），用「内容 + 时间窗」也能认出来自回声。
   */
  private recentlySent: { content: string; at: number }[] = []

  constructor(private page: Page) {
    this.handleWebSocketResponse = this.handleWebSocketResponse.bind(this)
    this.handleResponse = this.handleResponse.bind(this)
  }

  /** 判断一条消息是不是我们自己发出去、又被回推回来的 */
  private isSelfEcho(desc: string, userId: string | undefined): boolean {
    if (this.selfUserId && userId && userId === this.selfUserId) return true
    const now = Date.now()
    return this.recentlySent.some(m => m.content === desc && now - m.at < 120_000)
  }

  private async getCDPSession() {
    const context = this.page.context()
    return await context.newCDPSession(this.page)
  }

  async startCommentListener(onComment: (comment: LiveMessage) => void): Promise<void> {
    if (!this.client) {
      this.client = await this.getCDPSession()
    }
    this.handleComment = onComment
    this.client.send('Network.enable')
    this.client.on('Network.webSocketFrameReceived', this.handleWebSocketResponse)
    // 还有主动发送的消息，不会通过 WebSocket
    this.page.on('response', this.handleResponse)
  }

  /**
   * 「发送评论」接口的响应。
   * 注意：这里是我们**主动发出**的评论，不是观众评论，绝不能推给界面 / 自动回复
   * （否则会触发自我回复死循环）。只用来①记下自己的 user_id ②记下刚发出的内容，
   * 供后续把 WebSocket 回推的自己消息过滤掉。
   */
  private async handleResponse(response: Response) {
    const url = response.url()
    if (!url.includes('send_comment')) return
    let respJson: XiaohongshuSendCommentResponse
    try {
      respJson = (await response.json()) as XiaohongshuSendCommentResponse
    } catch {
      return
    }
    if (!respJson.success) return
    const data = respJson.data
    if (data?.profile?.user_id) {
      this.selfUserId = data.profile.user_id
    }
    const content = data?.comment ?? ''
    if (content) {
      const now = Date.now()
      this.recentlySent.push({ content, at: now })
      // 只保留最近 2 分钟的记录，避免无限增长
      this.recentlySent = this.recentlySent.filter(m => now - m.at < 120_000)
    }
  }

  private async handleWebSocketResponse({ response }: WebSocketFrameReceivedEvent) {
    const payload = response.payloadData
    const wsMessage: XiaohongshuWebSocketMessage = JSON.parse(payload)
    if (wsMessage.t !== 4) return
    const contentArray = wsMessage.b.d.b
    contentArray.forEach(content => {
      const commentMessage = this.parseWsContent(content)
      if (!commentMessage) return
      // 把「自己发出去、又被回推回来」的消息丢掉：
      // 它 nick_name 常为空 / 与店铺名不一致，光靠昵称判断兜不住，会导致自我回复死循环。
      if (this.isSelfEcho(commentMessage.desc, commentMessage.profile?.user_id)) return
      const liveMessage: LiveMessage = {
        msg_type: 'xiaohongshu_comment',
        msg_id: commentMessage.commentId,
        nick_name: commentMessage.profile.nickname,
        user_id: commentMessage.profile.user_id,
        content: commentMessage.desc,
        time: commentMessage.current_time,
      }
      this.handleComment(liveMessage)
    })
  }

  private parseWsContent(content: XiaohongshuWebSocketMessage['b']['d']['b'][number]) {
    const newData = JSON.parse(
      Buffer.from(content.d, 'base64').toString('utf-8'),
    ) as ParsedWebsocketMessage
    if (newData.command !== 1) return null
    const message = JSON.parse(newData.customData) as XiaohongshuMessage
    if (message.type !== 'text') return null
    return message
  }

  public setAccountName(accountName: string) {
    this.accountName = accountName
  }

  stopCommentListener(): void {
    this.client?.off('Network.webSocketFrameReceived', this.handleWebSocketResponse)
    this.client?.send('Network.disable')
    this.page.off('response', this.handleResponse)
    this.client = null
  }
  getCommentListenerPage(): Page {
    return this.page
  }
}
