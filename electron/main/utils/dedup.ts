/**
 * 消息去重器。
 *
 * 直播平台的评论接口返回的通常是「最近若干条的快照」，而不是「上次之后的新增」。
 * 页面（含 iframe）短时间内会并发请求多次，每次返回的快照里都带着同一批最新评论，
 * 如果不按 id 去重，一条观众弹幕就会被重复推送 N 次 ——
 * 表现为界面里同一条评论重复出现、AI 重复过滤、甚至重复回复。
 *
 * 采用「Set + 队列」维护一个固定大小的滑动窗口：超出上限时淘汰最旧的记录，
 * 既保证近期消息不重复，又不会让内存无限增长。
 */
export class MessageDeduplicator {
  private seen = new Set<string>()
  private queue: string[] = []

  constructor(private readonly max = 500) {}

  /**
   * 判断这条消息是否是新的。返回 true 表示可以往下推送。
   * 拿不到 id 时保守放行（宁可偶尔重复，也不能丢消息）。
   */
  isNew(id: string | undefined | null): boolean {
    if (!id) return true
    if (this.seen.has(id)) return false
    this.seen.add(id)
    this.queue.push(id)
    if (this.queue.length > this.max) {
      const oldest = this.queue.shift()
      if (oldest) this.seen.delete(oldest)
    }
    return true
  }

  clear() {
    this.seen.clear()
    this.queue = []
  }
}
