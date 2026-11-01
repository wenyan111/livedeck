/**
 * 评论正文匹配用的规范化。
 *
 * 背景（2026-11-01）：小红书自动回复连报三次「未在评论列表找到目标评论」，
 * 三条内容分别是「我157 78kg [笑哭R]」「只有我一個[笑哭R]」「[捂脸R][捂脸R][捂脸R]」——
 * 平台把 `[笑哭R]` 这类**表情短码渲染成图片**，DOM 的 textContent 里没有这串字，
 * 而找评论是 `text.includes(target)` 纯文本匹配，于是带表情的评论永远匹配不上。
 *
 * 办法：两边都先去掉表情短码和空白，再比。纯表情评论规范化后为空，
 * 调用方必须**先判空再匹配**（否则 `''.includes('')` 恒真，会 @ 到列表第一条，@ 错人）。
 *
 * ⚠️ 只用于「找哪一条评论」，不要拿去改发送的正文。
 */
export function normalizeCommentText(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/\[[^[\]]{1,10}\]/g, '') // [笑哭R] / [捂脸R] / [赞] 这类表情短码
    .replace(/\s+/g, '')
}

/**
 * 目标里是否含 `[笑哭R]` 这类表情短码。
 *
 * 调用方**只在返回 true 时**才启用规范化匹配——这样普通评论完全走原来的精确匹配，
 * 一次正则都不多跑；只有"必然失败"的带表情评论才付这点成本。
 */
export function hasEmojiShortcode(s: string | null | undefined): boolean {
  return /\[[^[\]]{1,10}\]/.test(s ?? '')
}
