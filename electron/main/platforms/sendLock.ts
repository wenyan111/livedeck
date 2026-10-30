/**
 * 「发评论」串行锁（按平台实例 = 按账号）。
 *
 * 背景（2026-10-29 用户实测）：
 * 开价话术（任务类型 `send-open-price-messages`）和自动回复（`send-batch-messages`）
 * 是**两个不同的任务类型**，`AccountSession.startTask` 的「同类型互斥」管不到它们。
 * 于是当开价话术正在发（要连发 2 条、每条约 3~6 秒）时，如果有观众评论进来触发了
 * AI 自动回复，两边会**同时往同一个评论输入框里打字、抢同一个发送按钮**：
 *   - 后写的把先写的内容覆盖掉 → 其中一条直接消失；
 *   - 或者先点发送的把别人的内容当自己的发出去了。
 * 用户看到的现象就是「开价话术发送时，AI 回复被吞了、没发出去」。
 *
 * 这里把「打字 → 点发送 → 等输入框清空」这一整段串行化：
 * 同账号的第二次调用会**排队等**第一次做完，而不是插进去抢输入框。
 * 代价是回复可能晚几十毫秒到几秒，但不会丢。
 *
 * 用 WeakMap 以平台实例为键：每个账号有独立的平台实例，天然隔离，
 * 也不需要额外维护账号 id → 实例的映射（账号销毁后自动回收）。
 */
const chains = new WeakMap<object, Promise<unknown>>()

export function withCommentSendLock<T>(owner: object, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(owner) ?? Promise.resolve()
  // 无论上一个成功还是失败都继续执行下一个（失败不应把后面全卡死）
  const next = prev.then(fn, fn)
  chains.set(
    owner,
    next.catch(() => {}),
  )
  return next
}
