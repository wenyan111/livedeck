import { useMemoizedFn } from 'ahooks'
import { useMemo } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { AUTO_REPLY } from '@/constants'
import { EVENTS, eventEmitter } from '@/utils/events'
import { matchObject } from '@/utils/filter'
import { useAccounts } from './useAccounts'
import type { ChatMessage } from './useAIChat'
import { type AIProvider, useAIProvider } from './useAIProvider'
import {
  type AutoReplyConfig,
  type FilterKeywordItem,
  useAutoReplyConfig,
  useAutoReplyConfigStore,
  createDefaultConfig as createDefaultAutoReplyConfig,
} from './useAutoReplyConfig'
import { mergeWithoutArray } from '@/utils/misc'
import { useErrorHandler } from './useErrorHandler'
import { useLiveControlStore } from './useLiveControl'

interface ReplyPreview {
  id: string
  commentId: string
  replyContent: string
  replyFor: string
  time: string
}

export type Message = LiveMessage
export type MessageType = Message['msg_type']
export type EventMessageType = Extract<
  MessageType,
  | 'room_enter'
  | 'room_like'
  | 'live_order'
  | 'subscribe_merchant_brand_vip'
  | 'room_follow'
  | 'ecom_fansclub_participate'
>
export type MessageOf<T extends MessageType> = Extract<Message, { msg_type: T }>
type CommentMessage = MessageOf<Exclude<MessageType, EventMessageType>>

type ListeningStatus = 'waiting' | 'listening' | 'stopped' | 'error'

interface AutoReplyContext {
  isRunning: boolean
  isListening: ListeningStatus
  replies: ReplyPreview[]
  comments: Message[]
  hideHost: boolean
}

interface AutoReplyState {
  contexts: Record<string, AutoReplyContext>
}
interface AutoReplyAction {
  setIsRunning: (accountId: string, isRunning: boolean) => void
  setIsListening: (accountId: string, isListening: ListeningStatus) => void
  addComment: (accountId: string, comment: Message) => void
  addReply: (accountId: string, commentId: string, nickname: string, content: string) => void
  removeReply: (accountId: string, commentId: string) => void
  setHideHost: (accountId: string, hideHost: boolean) => void
}

const createDefaultContext = (): AutoReplyContext => ({
  isRunning: false,
  isListening: 'stopped',
  replies: [],
  comments: [],
  hideHost: false,
})

export const useAutoReplyStore = create<AutoReplyState & AutoReplyAction>()(
  immer(set => {
    eventEmitter.on(EVENTS.ACCOUNT_REMOVED, (accountId: string) => {
      set(state => {
        delete state.contexts[accountId]
      })
    })

    const ensureContext = (state: AutoReplyState, accountId: string) => {
      if (!state.contexts[accountId]) {
        state.contexts[accountId] = createDefaultContext()
      }
      return state.contexts[accountId]
    }

    return {
      contexts: {},
      setIsRunning: (accountId, isRunning) =>
        set(state => {
          const context = ensureContext(state, accountId)
          context.isRunning = isRunning
        }),
      setIsListening: (accountId, isListening) =>
        set(state => {
          const context = ensureContext(state, accountId)
          context.isListening = isListening
        }),

      addComment: (accountId, comment) =>
        set(state => {
          const context = ensureContext(state, accountId)
          // 同一条评论（msg_id 相同）重复投递时不再入库：
          // 否则评论列表会出现重复条目，更麻烦的是后续生成 AI 回复时
          // 同一个问题会被喂给模型两遍，模型就在一次输出里回答两遍。
          if (comment.msg_id && context.comments.some(c => c.msg_id === comment.msg_id)) {
            return
          }
          // 限制评论数量，防止内存无限增长
          context.comments = [{ ...comment }, ...context.comments].slice(0, AUTO_REPLY.MAX_COMMENTS)
        }),
      addReply: (accountId, commentId, nickname, content) =>
        set(state => {
          const context = ensureContext(state, accountId)
          context.replies = [
            {
              id: crypto.randomUUID(),
              commentId,
              replyContent: content,
              replyFor: nickname,
              time: new Date().toISOString(),
            },
            ...context.replies,
          ].slice(0, AUTO_REPLY.MAX_REPLIES)
        }),
      removeReply: (accountId, commentId) =>
        set(state => {
          const context = ensureContext(state, accountId)
          context.replies = context.replies.filter(reply => reply.commentId !== commentId)
        }),
      setHideHost: (accountId, value) =>
        set(state => {
          const context = ensureContext(state, accountId)
          context.hideHost = value
        }),
    }
  }),
)

function generateAIMessages(
  comments: CommentMessage[],
  replies: ReplyPreview[],
): Omit<ChatMessage, 'id' | 'timestamp'>[] {
  // 1. 按时间排序混合评论和回复
  const sortedItems = [
    ...comments.map(c => ({ type: 'comment' as const, time: c.time, data: c })),
    ...replies.map(r => ({ type: 'reply' as const, time: r.time, data: r })),
  ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

  // 2. 转换为 AI 消息格式
  const rawMessages: Omit<ChatMessage, 'id' | 'timestamp'>[] = sortedItems.map(item => {
    if (item.type === 'comment') {
      return {
        role: 'user',
        // 发送给 AI 的格式，包含昵称和内容
        content: JSON.stringify({
          nickname: item.data.nick_name,
          content: item.data.content ?? '', // 确保 content 是字符串
        }),
      }
    }
    // item.type === 'reply'
    return {
      role: 'assistant',
      content: item.data.replyContent,
    }
  })

  // 3. 合并连续的同角色消息
  if (rawMessages.length === 0) {
    return []
  }

  const mergedMessages: Omit<ChatMessage, 'id' | 'timestamp'>[] = []
  let currentMessage = { ...rawMessages[0], content: [rawMessages[0].content] } // 初始化第一个消息

  for (let i = 1; i < rawMessages.length; i++) {
    if (rawMessages[i].role === currentMessage.role) {
      currentMessage.content.push(rawMessages[i].content) // 追加内容
    } else {
      // 角色变化，保存之前的消息，开始新消息
      mergedMessages.push({
        role: currentMessage.role,
        content: currentMessage.content.join('\n'), // 用换行符合并内容
      })
      currentMessage = { ...rawMessages[i], content: [rawMessages[i].content] }
    }
  }

  // 添加最后一条消息
  mergedMessages.push({
    role: currentMessage.role,
    content: currentMessage.content.join('\n'),
  })

  return mergedMessages
}

function sendConfiguredReply(
  accountId: string,
  config: AutoReplyConfig,
  sourceMessage: Message,
  errorHandler: ReturnType<typeof useErrorHandler>['handleError'],
): void {
  const replyConfig = config[sourceMessage.msg_type as EventMessageType]
  if (replyConfig.enable && replyConfig.messages.length > 0) {
    const filterMessages = []
    const pureMessages = []
    for (const message of replyConfig.messages) {
      if (typeof message === 'string') {
        pureMessages.push(message)
      } else if (matchObject(sourceMessage, message.filter)) {
        filterMessages.push(message.content)
      }
    }
    const replyMessages = filterMessages.length ? filterMessages : pureMessages
    const content = getRandomElement(replyMessages)
    if (content) {
      const message = replaceUsername(content, sourceMessage.nick_name, config.hideUsername)
      sendMessage(accountId, message, errorHandler) // 注意：这里是异步的，但我们不等待它完成
    }
  }
}

/**
 * 兜底清理 AI 输出。模型抽风主要有两类，都在这里收口：
 *  1) 把「思考过程」也吐进正文 —— 例如
 *     「用户问全家能不能用拍的一套，首先看规则：…所以要回答：一套全家…」，
 *     冒号前那截是模型的自言自语，不该发给观众；
 *  2) 把同一条回复重复多遍（措辞可能略有不同），例如
 *     「一套全家只要符合年龄体重都能用哦～ 一套只要符合16-70岁、300斤以内都能用，全家合适呀～
 *       一套只要符合16-70岁、300斤以内都能用，全家合适哒～」
 * 只做确定性较高的裁剪，宁可漏修，也不把正常回复切坏。
 */
function normalizeReplyText(raw: string): string {
  let text = (raw ?? '').trim()
  if (!text) return ''

  // 1) 去掉思考前缀
  text = stripReasoningPreamble(text)

  // 2) 整段正好是同一句话重复两遍（中间无分隔符）
  if (text.length >= 8 && text.length % 2 === 0) {
    const half = text.length / 2
    if (text.slice(0, half) === text.slice(half)) {
      return text.slice(0, half).trim()
    }
  }

  // 3) 折叠重复的句子
  return collapseRepeatedSentences(text)
}

/**
 * 去掉模型的「思考前缀」：模型常以「…所以要回答：」「回复：」「答：」等引导词收尾思考、再接正文。
 * 这里按最后一个引导词分割，只保留引导词之后真正给观众看的正文。
 * 只有当冒号前的内容确实像思考（含「规则/用户/首先/所以/需要/应该/判断/分析/问题」等词）时才裁，
 * 避免把「回答：xxx」这种本就正常的开头误伤。
 */
function stripReasoningPreamble(text: string): string {
  const markerRe =
    /(?:所以要回答|所以回答|回答如下|回复如下|回复内容|最终回复|要回答|回复|回答|答)\s*[：:]\s*/g
  let cutEnd = -1
  for (const m of text.matchAll(markerRe)) {
    if (m.index !== undefined) cutEnd = m.index + m[0].length
  }
  if (cutEnd <= 0 || cutEnd >= text.length) return text
  const head = text.slice(0, cutEnd)
  const tail = text.slice(cutEnd).trim()
  if (tail.length < 4) return text
  if (!/规则|用户|首先|所以|需要|应该|判断|分析|问题/.test(head)) return text
  return tail
}

/** 去掉标点/空白，用于比较句子是否「实质相同」 */
function normalizeForCompare(s: string): string {
  return s.replace(/[\s，,。！？!?~～、；;：:"'“”‘’（）()【】[\]…~—-]/g, '')
}

/** 两段文本的公共前缀长度 */
function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i++
  return i
}

/**
 * 按句末标点切句，丢弃「与上一句完全相同或高度相似」的句子。
 * 只和紧邻的上一句比较：既能干掉重复，又不会误删正常的分点说明。
 * 「高度相似」= 去掉标点后共同前缀 ≥ 较短句的 80% 且较短句 ≥ 10 字，
 * 覆盖「…全家合适呀～ / …全家合适哒～」这类只差尾字的复读。
 */
function collapseRepeatedSentences(text: string): string {
  const parts = text.match(/[^。！？!?~～]+[。！？!?~～]*/g)
  if (!parts || parts.length <= 1) return text
  const kept: string[] = []
  const normKept: string[] = []
  for (const rawPart of parts) {
    const part = rawPart.trim()
    if (!part) continue
    const key = normalizeForCompare(part)
    if (!key) continue
    const prev = normKept[normKept.length - 1] ?? ''
    if (prev) {
      if (prev === key) continue
      const shorter = Math.min(prev.length, key.length)
      if (shorter >= 10 && commonPrefixLength(prev, key) >= Math.ceil(shorter * 0.8)) continue
    }
    kept.push(part)
    normKept.push(key)
  }
  return kept.join('')
}

function getRandomElement<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined
  const randomIndex = Math.floor(Math.random() * arr.length)
  return arr[randomIndex]
}

async function sendMessage(
  accountId: string,
  content: string,
  errorHandler: ReturnType<typeof useErrorHandler>['handleError'],
) {
  if (!content) return
  try {
    await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.autoReply.sendReply, accountId, content)
  } catch (err) {
    errorHandler(err, '自动发送回复失败')
  }
}

function replaceUsername(content: string, username: string, mask: boolean) {
  if (!content) return ''
  // 把 {用户名} 替换为 username
  const displayedUsername = mask
    ? `${String.fromCodePoint(username.codePointAt(0) ?? 42 /* 42 是星号 */)}***`
    : username
  return content.replace(new RegExp(AUTO_REPLY.USERNAME_PLACEHOLDER, 'g'), displayedUsername)
}

function checkFilterKeyword(content: string, kw: string | FilterKeywordItem): boolean {
  if (typeof kw === 'string') {
    return content.includes(kw)
  }
  const { text, matchType } = kw
  if (!text) return false

  if (matchType === 'exact') {
    return content === text
  }

  if (matchType === 'regex') {
    const regexMatch = text.match(/^\/(.+)\/([gimy]*)$/)
    const pattern = regexMatch ? regexMatch[1] : text
    const flags = regexMatch ? regexMatch[2] : ''
    try {
      const regex = new RegExp(pattern, flags)
      return regex.test(content)
    } catch {
      return content.includes(text)
    }
  }

  return content.includes(text)
}

/**
 * 处理关键字回复逻辑
 * @returns boolean - 是否成功匹配并发送了关键字回复
 */
const handleKeywordReply = (
  comment: CommentMessage,
  config: AutoReplyConfig,
  accountId: string,
  errorHandler: ReturnType<typeof useErrorHandler>['handleError'],
): boolean => {
  if (!config.comment.keywordReply.enable || !comment.content) {
    return false
  }

  const rule = config.comment.keywordReply.rules.find(({ keywords }) =>
    keywords.some(kw => comment.content?.includes(kw)),
  )

  if (rule && rule.contents.length > 0) {
    const content = getRandomElement(rule.contents)
    if (content) {
      const message = replaceUsername(content, comment.nick_name, config.hideUsername)
      sendMessage(accountId, message, errorHandler)
      // 注意：关键字回复不通过 addReply 添加到界面，直接发送
      return true // 匹配成功
    }
  }
  return false // 未匹配
}

/**
 * 处理 AI 回复逻辑
 */
const handleAIReply = async (
  accountId: string,
  comment: CommentMessage,
  allComments: Message[],
  allReplies: ReplyPreview[],
  config: AutoReplyConfig,
  {
    provider,
    model,
    apiKey,
    customBaseURL,
  }: {
    provider: AIProvider
    model: string
    apiKey: string
    customBaseURL: string
  },
  onReply: (content: string) => void,
  errorHandler: ReturnType<typeof useErrorHandler>['handleError'],
) => {
  if (!config.comment.aiReply.enable) return

  const { prompt, autoSend } = config.comment.aiReply

  // 只回复【当前这条】评论：不把该观众的历史评论/回复一并喂给模型。
  // 背景：历史里常堆着一墙被关键词/AI 过滤掉的闲聊弹幕，模型一旦看到就会试图
  // 「回应所有评论」，把回复写得又长又乱（历史事故见 CHANGELOG v1.7.3）。
  // 用户已明确：AI 回复只针对当前这一条评论。
  const plainMessages = generateAIMessages([comment], [])

  // 构造系统提示
  // 旧提示写「请分析所有评论，并根据以下要求生成一个回复」，「分析」+「根据以下要求」
  // 会诱导模型把思考过程/规则复述也写进正文（历史事故：…所以要回答：…）。
  // 现改成「直接针对这条评论写一条回复」，并硬性禁止思考/规则/重复。
  const systemPrompt =
    `你是直播间客服。下面是一位观众的评论，JSON 格式：{"nickname": "用户昵称", "content": "评论内容"}。请直接针对这条评论写一条回复。\n\n请按以下要求写这个回复：\n${prompt}\n\n【输出要求】只输出这条回复的正文，除此之外什么都不要写：\n- 不要输出你的思考过程、分析、判断依据或规则说明；\n- 不要以「用户问…」「首先看规则…」「所以要回答：」这类话开头；\n- 只输出一条：不要重复同一句话、不要给多条备选、不要编号或分多段；\n- 不要加引号，也不要加「回复：」之类的前缀。`

  const messages = [
    { role: 'system', content: systemPrompt }, // id 和 timestamp 对请求不重要
    ...plainMessages,
  ]

  try {
    const replyContent = await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.aiChat.normalChat, {
      messages,
      provider,
      model,
      apiKey,
      customBaseURL,
    })

    if (replyContent && typeof replyContent === 'string') {
      const replyText = normalizeReplyText(replyContent)
      onReply(replyText)
      // 自动发送
      if (autoSend) {
        sendMessage(accountId, replyText, errorHandler)
      }
    }
  } catch (err) {
    errorHandler(err, 'AI 生成回复失败')
  }
}

/**
 * 使用 AI 小模型判断该评论是否需要回复（AI 智能过滤）。
 * @returns boolean - true 表示需要回复，false 表示直接过滤
 */
const judgeShouldReply = async (
  nickname: string,
  content: string,
  config: AutoReplyConfig,
  aiConfig: {
    provider: AIProvider
    model: string
    apiKey: string
    customBaseURL: string
  },
  errorHandler: ReturnType<typeof useErrorHandler>['handleError'],
): Promise<boolean> => {
  const { provider, model, apiKey, customBaseURL } = aiConfig

  // 没有配置 API Key 时，保守放行，交给后续回复逻辑处理
  if (!apiKey) {
    window.ipcRenderer.invoke(IPC_CHANNELS.app.writeLog, {
      level: 'warn',
      scope: 'AI智能过滤',
      message: '未配置 AI 模型 API Key，AI 智能过滤跳过判定，评论照常进入回复流程。',
    })
    return true
  }

  const systemPrompt =
    '你是一个直播间的评论过滤器。你需要判断下面这条观众评论是否“值得主播/助手回复”。\n' +
    '值得回复的情况：提问、求链接、咨询商品、表达购买意向、需要互动或安抚、明显期待回复的评论。\n' +
    '不值得回复（应过滤）的情况：纯灌水/刷屏、无意义表情、广告引流（除非已命中关键词）、与直播间无关的内容、情绪宣泄等。\n' +
    '额外判定标准：\n' +
    config.comment.aiFilter.prompt +
    '\n只输出一个 JSON 对象，不要输出任何多余内容，格式严格为：{"reply": true} 或 {"reply": false}。'

  const userContent = JSON.stringify({
    nickname,
    content,
  })

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ]

  try {
    const raw = await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.aiChat.normalChat, {
      messages,
      provider,
      model,
      apiKey,
      customBaseURL,
    })
    return parseReplyDecision(raw)
  } catch (err) {
    errorHandler(err, 'AI 智能过滤判定失败')
    // 判定异常时保守放行，避免误杀正常评论
    return true
  }
}

/**
 * 解析 AI 判定结果。优先按 JSON 解析，失败时做宽松的关键词匹配。
 * 任何无法确认的情况都保守返回 true（放行）。
 */
function parseReplyDecision(raw: unknown): boolean {
  if (typeof raw !== 'string') return true
  let text = raw.trim()
  // 去掉可能的 markdown 代码块包裹
  text = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  // 1. 尝试严格 JSON 解析
  try {
    const obj = JSON.parse(text)
    if (obj && typeof obj.reply === 'boolean') {
      return obj.reply
    }
  } catch {
    // 解析失败，继续走宽松匹配
  }

  // 2. 宽松匹配：明确出现 false / 无需回复 则过滤
  const hasTrue = /"reply"\s*:\s*true/i.test(text) || /需要回复/.test(text)
  const hasFalse = /"reply"\s*:\s*false/i.test(text) || /无需回复|不回复/.test(text)
  if (hasTrue) return true
  if (hasFalse) return false

  // 3. 兜底：无法判定则放行
  return true
}

export function useAutoReply() {
  const store = useAutoReplyStore()
  const { currentAccountId } = useAccounts()
  const aiStore = useAIProvider('autoReply')
  const { config } = useAutoReplyConfig()
  const { handleError } = useErrorHandler()

  const context = useMemo(() => {
    return store.contexts[currentAccountId] || createDefaultContext()
  }, [store.contexts, currentAccountId])

  const { isRunning, isListening, comments, replies, hideHost } = context

  const handleComment = useMemoizedFn((comment: Message, accountId: string) => {
    // 取「该评论所属账号」的主播名，而不是当前 UI 选中账号的主播名，
    // 否则多平台同时运行时会把其他账号主播自己的评论误判为观众评论而回复。
    const accountName = useLiveControlStore.getState().contexts[accountId]?.accountName || ''
    const currentContext =
      useAutoReplyStore.getState().contexts[accountId] || createDefaultContext()
    const { isRunning, comments: allComments, replies: allReplies } = currentContext

    // 关键修复：取「评论所属账号」的配置，而非 UI 当前选中账号的配置，
    // 否则切到快手后，抖音等平台的评论会误用快手的配置（过滤关键词为空 → 直接滑到 AI 过滤）。
    const configStore = useAutoReplyConfigStore.getState()
    const accountConfig = mergeWithoutArray(
      createDefaultAutoReplyConfig(),
      configStore.contexts[accountId]?.config ?? {},
    )

    store.addComment(accountId, comment)
    if (!isRunning) {
      return
    }

    ;(async function handleReply() {
      if (
        // 如果是主播评论就跳过
        comment.nick_name === accountName
      ) {
        return
      }

      if (
        // 在黑名单也跳过
        accountConfig.blockList?.includes(comment.nick_name)
      ) {
        window.ipcRenderer.invoke(IPC_CHANNELS.app.writeLog, {
          level: 'info',
          scope: '自动回复',
          message: `观众 [${comment.nick_name}] 处于黑名单中，跳过不予回复。`,
        })
        return
      }

      // 如果评论内容包含过滤关键词，也跳过（弹幕过滤关键词 — 每个平台独立配置）
      const commentContent = 'content' in comment ? comment.content : undefined
      if (
        commentContent &&
        accountConfig.filterKeywords?.some(kw => checkFilterKeyword(commentContent, kw))
      ) {
        const matchedKw = accountConfig.filterKeywords?.find(kw => checkFilterKeyword(commentContent, kw))
        const matchedText = typeof matchedKw === 'string' ? matchedKw : matchedKw?.text
        const matchTypeStr =
          typeof matchedKw === 'string'
            ? '模糊'
            : matchedKw?.matchType === 'exact'
              ? '精准'
              : matchedKw?.matchType === 'regex'
                ? '正则'
                : '模糊'
        window.ipcRenderer.invoke(IPC_CHANNELS.app.writeLog, {
          level: 'info',
          scope: '自动回复',
          message: `观众 [${comment.nick_name}] 的弹幕 "${commentContent}" 匹配了过滤关键词 [${matchedText}]（${matchTypeStr}匹配），已被过滤不予回复。`,
        })
        return
      }

      switch (comment.msg_type) {
        case 'taobao_comment':
        case 'xiaohongshu_comment':
        case 'wechat_channel_live_msg':
        case 'comment': {
          // 1) 优先尝试关键字回复：走关键字回复的评论不再进入 AI 流程，
          //    避免被 AI 智能过滤误杀，确保「弹幕过滤关键词」与「关键字回复」都优先于 AI。
          const keywordReplied = handleKeywordReply(comment, accountConfig, currentAccountId, handleError)
          if (!keywordReplied) {
            // 2) 关键字未命中时，才用 AI 智能过滤判定是否需要回复
            if (accountConfig.comment.aiFilter?.enable && commentContent) {
              const filterConfig = accountConfig.comment.aiFilter
              // 解析判定使用的模型：默认复用 AI 回复模型，关闭复用则使用独立 provider/model
              const filterProvider = filterConfig.useReplyModel
                ? aiStore.config.provider
                : filterConfig.provider
              const filterModel = filterConfig.useReplyModel
                ? aiStore.config.model
                : filterConfig.model || aiStore.config.model
              const filterApiKey = aiStore.apiKeys[filterProvider]
              const filterBaseURL = aiStore.customBaseURL
              const shouldReply = await judgeShouldReply(
                comment.nick_name,
                commentContent,
                accountConfig,
                {
                  provider: filterProvider,
                  model: filterModel,
                  apiKey: filterApiKey,
                  customBaseURL: filterBaseURL,
                },
                handleError,
              )
              if (!shouldReply) {
                window.ipcRenderer.invoke(IPC_CHANNELS.app.writeLog, {
                  level: 'info',
                  scope: 'AI智能过滤',
                  message: `观众 [${comment.nick_name}] 的弹幕 "${commentContent}" 经 AI 智能过滤判定为无需回复，已被过滤。`,
                })
                return
              }
            }
            // 3) AI 智能过滤放行后，再尝试 AI 回复
            if (accountConfig.comment.aiReply.enable) {
              const { provider, model } = aiStore.config
              const apiKey = aiStore.apiKeys[provider]
              const customBaseURL = aiStore.customBaseURL
              handleAIReply(
                accountId,
                comment,
                allComments,
                allReplies,
                accountConfig,
                {
                  provider,
                  model,
                  apiKey,
                  customBaseURL,
                },
                (replyContent: string) => {
                  store.addReply(accountId, comment.msg_id, comment.nick_name, replyContent)
                },
                handleError,
              )
            }
          }
          break
        }
        case 'live_order': {
          /* 如果设置了仅已支付回复且当前非已支付时不回复 */
          if (!accountConfig.live_order.options?.onlyReplyPaid || comment.order_status === '已付款') {
            sendConfiguredReply(accountId, accountConfig, comment, handleError)
          }
          break
        }
        default:
          sendConfiguredReply(accountId, accountConfig, comment, handleError)
      }
    })()

    ;(function handlePinComment() {
      // 视频号上墙
      if (comment.msg_type === 'wechat_channel_live_msg' && accountConfig.pinComment.enable) {
        if (!accountConfig.pinComment.includeHost && comment.nick_name === accountName) {
          return
        }
        const { matchStr } = accountConfig.pinComment
        // 把平台表情去掉，表情为 [xx]
        const pureTextContent = comment.content.replace(/\[[^\]]{1,3}\]/g, '')
        if (matchStr.some(str => pureTextContent.includes(str))) {
          window.ipcRenderer.invoke(IPC_CHANNELS.tasks.pinComment, {
            accountId,
            content: pureTextContent,
          })
        }
      }
    })()
  })

  return {
    // 当前账户的状态
    isRunning,
    isListening,
    comments, // 当前账户的评论
    replies, // 当前账户的回复
    hideHost, // 仅用户评论（隐藏主播评论）开关状态，跨界面保持

    // Actions (绑定到当前账户)
    handleComment,
    setIsRunning: (running: boolean) => store.setIsRunning(currentAccountId, running),
    setIsListening: (listening: ListeningStatus) =>
      store.setIsListening(currentAccountId, listening),
    setHideHost: (value: boolean) => store.setHideHost(currentAccountId, value),
    removeReply: (commentId: string) => store.removeReply(currentAccountId, commentId),
  }
}
