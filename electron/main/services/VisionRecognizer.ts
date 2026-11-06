import fs from 'node:fs/promises'
import path from 'node:path'
import OpenAI from 'openai'
import {
  computeDerivedValues,
  LIVE_REPORT_COLUMNS,
  type LiveReportColumn,
} from 'shared/liveReportColumns'
import { createLogger } from '#/logger'
import { providerService } from '#/services/ProviderService'

export interface VisionImage {
  /** 本地图片路径（优先） */
  path?: string
  /** 或直接传 base64 / dataURL */
  base64?: string
}

export interface VisionConfig {
  provider: string
  model: string
  apiKey: string
  customBaseURL?: string
}

export interface VisionResult {
  /** 列 key -> 识别到的原文 */
  values: Record<string, string>
  /** 低置信列 key（非文本列却不是数字，疑似识别错误） */
  lowConfidence: string[]
  /**
   * 本次是否被「暂停识别」提前结束。
   * 为 true 时 values 是已经跑完的那些调用的结果，仍然有效。
   */
  paused?: boolean
  /**
   * 已经**完整**识别过的图片在入参 images 里的下标。
   * 渲染进程据此把这些图标记为「已识别」，下次不再重复送模型。
   */
  processedImageIndexes?: number[]
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp',
  gif: 'image/gif',
}

async function toDataUrl(img: VisionImage): Promise<string | null> {
  if (img.base64) {
    return img.base64.startsWith('data:') ? img.base64 : `data:image/png;base64,${img.base64}`
  }
  if (img.path) {
    try {
      const buf = await fs.readFile(img.path)
      const ext = path.extname(img.path).slice(1).toLowerCase()
      const mime = MIME_BY_EXT[ext] ?? 'image/png'
      return `data:${mime};base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  }
  return null
}

function buildSystemPrompt(): string {
  return (
    '你是一个严谨的抖音直播数据提取助手。用户会提供若干张直播数据截图（可能包含实时大屏、' +
    '直播复盘、流量来源、商品、人群画像等区块），你需要从中提取指定的直播指标。' +
    '你必须严格按用户给定的 JSON 结构返回，不要编造不存在的数据，看不清的指标返回空字符串。' +
    '\n\n【格式要求】输出必须是纯 JSON 对象，禁止使用 markdown 代码块（```），禁止任何解释文字。'
  )
}

/**
 * 构建用户提示词：
 * - 用 col.key 作为 JSON 键名（简单英文标识符）
 * - 关键：值必须是「从截图读到的真实数据」，绝不能把字段名/含义当值回显
 */
function buildUserPrompt(columns: LiveReportColumn[] = LIVE_REPORT_COLUMNS): string {
  const targetCols = columns.filter(
    c => c.source !== 'skip' && c.source !== 'computed' && c.source !== 'fixed',
  )
  // AI 判断类字段：不给「照抄」的模板，要求模型结合截图自己下结论
  const aiCols = targetCols.filter(c => c.source === 'ai')
  // 用「键名（含义）→ 例：数值」格式，避免模型把含义当成值
  const unitText = (unit?: string) =>
    unit === 'wan'
      ? '万'
      : unit === 'percent'
        ? '%'
        : unit === 'hour'
          ? '小时'
          : unit === 'text'
            ? '文本'
            : '原始数值'
  const items = targetCols
    .map(c => `- "${c.key}"（含义：${c.label}；单位：${unitText(c.unit)}）→ 从截图读到的真实值`)
    .join('\n')
  return (
    '请从这些直播数据截图中，逐个读取下面每个指标的真实数值。\n\n' +
    `【要提取的字段（共 ${targetCols.length} 项）】\n${items}\n\n` +
    '【重要规则】\n' +
    `1. 只返回一个纯 JSON 对象，键名严格用上面的英文键名（如 "viewersWan"）。\n` +
    '2. 【最关键】每个值必须是你从截图中**真正读到的数据**：数字、日期、时间、百分比或文本。\n' +
    `   - 例："viewersWan" 的值应返回 5.32 这样的数字，绝对不能返回 "观看人数（w）" 或 "viewersWan" 这种文字。\n` +
    `   - 例："payGmv" 的值应返回 5234.5 这样的数字，绝对不能返回 "GMV" 或 "支付GMV"。\n` +
    `3. 截图中能看到的指标一律填写，近似也可；完全看不到/图上没有的才用 ""。\n` +
    '4. 单位处理（**以下面标注的「单位」为准，不要看键名猜**）：\n' +
    `   - 单位「万」：带上「万」字返回 —— 截图写「12.3万」返回 "12.3万"；截图写「9700」就写 "0.97万"。\n` +
    '   - 单位「原始数值」：**按截图原样返回数字，绝对不要换算成万、也不要加「万」字**（368 就返回 368）。\n' +
    '   - 单位「%」：返回带百分号的数（35%→35）。\n' +
    '   - 单位「小时」：返回小时数（2:30:00→2.5）。\n' +
    '   - 单位「文本」：原样抄文字。\n' +
    (aiCols.length > 0
      ? `\n【需要你判断的字段（共 ${aiCols.length} 项）】\n${aiCols
          .map(c => `- "${c.key}"（${c.label}）`)
          .join(
            '\n',
          )}\n这些字段截图里可能没有现成数字，要你根据截图里的时间/内容自己判断后给出结论；判断不出来就返回 ""。\n`
      : '') +
    '5. 【绝对禁止】不要用 ``` 包裹、不要加任何说明文字，直接输出 { 开头的 JSON。'
  )
}

/** 归一化用于比较 */
function normalize(s: string): string {
  return s.replace(/[（(]/g, '(').replace(/[）)]/g, ')').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** 从标签去掉单位后缀 */
function coreName(label: string): string {
  return normalize(label)
    .replace(/[（(][^）)]*[）)]/g, '')
    .trim()
}

/**
 * 智能查找值：多策略匹配
 */
function findValue(parsed: Record<string, unknown>, col: LiveReportColumn): unknown {
  // 策略 1：key 精确匹配
  if (col.key in parsed) return parsed[col.key]

  // 策略 2：label 精确匹配
  if (col.label in parsed) return parsed[col.label]

  // 策略 3：归一化 label 匹配
  const normLabel = normalize(col.label)
  for (const [k, v] of Object.entries(parsed)) {
    if (normalize(k) === normLabel) return v
  }

  // 策略 4：归一化 key 匹配（模型可能用了变体 key）
  const normKey = normalize(col.key)
  for (const [k, v] of Object.entries(parsed)) {
    if (normalize(k) === normKey) return v
  }

  // 策略 5：核心名称子串匹配
  const cn = coreName(col.label)
  if (cn.length >= 2) {
    for (const [k, v] of Object.entries(parsed)) {
      const ck = coreName(String(k))
      if (ck.includes(cn) || cn.includes(ck)) return v
    }
  }

  return undefined
}

// ──────────────────────────────────────────────
// JSON 清洗：修复视觉模型常见输出问题
// ──────────────────────────────────────────────

/** 清洗模型原始文本中常见问题 */
function cleanRawText(text: string): string {
  let t = text
  // 去除 BOM
  t = t.replace(/^\uFEFF/, '')
  // 统一换行符
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // 去除首尾空白行
  t = t.replace(/^\n+|\n+$/g, '')
  return t
}

/**
 * 激进清洗 JSON 字符串——在 parse 前修复各种模型输出问题
 */
function aggressiveJsonClean(jsonStr: string): string[] {
  const variants: string[] = []

  // 0. 原始
  variants.push(jsonStr)

  // 1. 移除字符串值内的未转义换行符（最常见问题！）
  //    把 "value\nwith\nnewlines" 变成 "value with newlines"
  const s1 = jsonStr.replace(/"(?:[^"\\]|\\.)*"/g, match => {
    return match
      .replace(/(?<!\\)\n/g, ' ')
      .replace(/(?<!\\)\t/g, ' ')
      .replace(/(?<!\\)\r/g, ' ')
  })
  variants.push(s1)

  // 2. 中文标点替换
  const s2 = s1
    .replace(/，/g, ',')
    .replace(/：/g, ':')
    .replace(/"/g, '"') // 中文引号
    .replace(/"/g, '"')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
  variants.push(s2)

  // 3. 移除 markdown 加粗/斜体
  const s3 = s2.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
  variants.push(s3)

  // 4. 移除字符串内的控制字符（保留普通空格和换行）
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 这里就是要匹配控制字符，把它们从模型返回里清掉
  const s4 = s3.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  variants.push(s4)

  // 5. 修复尾逗号
  const s5 = s4.replace(/,\s*([}\]])/g, '$1')
  variants.push(s5)

  // 6. 单引号 → 双引号
  const s6 = s5.replace(/'([^']+)'\s*:/g, '"$1":').replace(/:\s*'([^']*)'/g, ':"$1"')
  variants.push(s6)

  // 7. 去掉注释（// 或 /* */）
  const s7 = s6.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  variants.push(s7)

  // 8. 修复无引号的键名（key: value → "key": value）——仅当键是合法标识符时
  const s8 = s7.replace(/(?:^|\n)\s*([a-zA-Z_]\w*)\s*:/g, '"$1":')
  variants.push(s8)

  return variants
}

/**
 * 超强健 JSON 提取：多层策略
 */
function extractJson(text: string): {
  result: Record<string, unknown> | null
  method: string
  rawSnippet?: string
} {
  const t = cleanRawText(text)

  // 保存原始片段用于日志
  const rawSnippet = t.slice(0, 1500)

  // ---- 方法组 A：markdown 代码块提取 ----
  const fencePatterns = [
    // 标准：```json\n{...}\n```
    /```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*/gi,
    // 紧凑：```json {...} ```
    /```(?:json)?\s*([\s\S]*?)```\s*/gi,
    // 最宽松：``` 到最近的 ```
    /```[\s\S]*?```/gi,
  ]

  for (const pat of fencePatterns) {
    const matches = [...t.matchAll(pat)]
    for (const m of matches) {
      if (!m[1]) continue
      const inner = m[1].trim()
      if (!inner.includes('{')) continue
      // 用激进清洗的每个变体尝试解析
      const variants = aggressiveJsonClean(inner)
      for (let vi = 0; vi < variants.length; vi++) {
        const r = tryParseJson(variants[vi])
        if (r) return { result: r, method: `fence-v${vi}`, rawSnippet }
      }
    }
  }

  // ---- 方法组 B：{ } 直接截取 ----
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start !== -1 && end > start) {
    const jsonStr = t.slice(start, end + 1)

    // 用激进清洗的所有变体依次尝试
    const variants = aggressiveJsonClean(jsonStr)
    for (let vi = 0; vi < variants.length; vi++) {
      const r = tryParseJson(variants[vi])
      if (r) return { result: r, method: `direct-v${vi}`, rawSnippet }
    }

    // 最后兜底：正则暴力提取 key:value 对
    const r = extractKeyValuePairs(jsonStr)
    if (r) return { result: r, method: 'regex-pairs', rawSnippet }
  }

  // ---- 方法组 C：全文本搜索 key:value（即使没有外层 {}）----
  const r = extractKeyValuePairs(t)
  if (r) return { result: r, method: 'fulltext-pairs', rawSnippet }

  return { result: null, method: 'none', rawSnippet }
}

/** 尝试 JSON.parse，失败返回 null */
function tryParseJson(str: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(str)
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return obj as Record<string, unknown>
    }
  } catch {
    // ignore
  }
  return null
}

/** 正则暴力提取所有 "key": value 对 —— 兼容多种 value 格式 */
function extractKeyValuePairs(text: string): Record<string, unknown> | null {
  const result: Record<string, unknown> = {}

  // 模式 1: "key": "value" （标准双引号字符串）
  // 模式 2: "key": number
  // 模式 3: "key": true/false/null
  // 模式 4: key: value （无引号键名）
  const combinedPattern =
    /(?:"([a-zA-Z_]\w*)"|([a-zA-Z_]\w*))\s*[:]\s*(?:"((?:[^"\\]|\\.)*)"|(-?\d+\.?\d*(?:[eE][+-]?\d+)?|(true|false|null)))/g

  let match: RegExpExecArray | null = combinedPattern.exec(text)
  while (match !== null) {
    const key = match[1] || match[2]
    if (!key || key === 'null' || key === 'true' || key === 'false') continue

    let val: unknown
    if (match[3] !== undefined) {
      val = match[3].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim()
    } else if (match[4] !== undefined) {
      val = Number.parseFloat(match[4])
    } else if (match[5] === 'true') val = true
    else if (match[5] === 'false') val = false
    else val = null

    result[key] = val
    match = combinedPattern.exec(text)
  }

  return Object.keys(result).length > 0 ? result : null
}

/** 单批最大图片数（视觉模型限制） */
const MAX_IMAGES_PER_BATCH = 4

/**
 * 每块请求的字段数。
 *
 * 字段越少模型越专注，但**同一批图片会被每个字段块重复送一遍**，
 * 所以块数直接乘在输入 token 上：45 个字段按 10 切 = 5 块 = 一张图送 5 次。
 * 实测 10 个字段一块时，模型解析出来的键数就是 10（没漏），说明 15 个也扛得住，
 * 于是折中到 15：45 字段从 5 块降到 3 块，输入 token 省约 40%，速度也更快。
 */
const FIELDS_PER_CHUNK = 15

/** 把数组按 size 切块 */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * 同时最多发几次模型调用。
 *
 * 之前是一个字段块跑完再跑下一个，10 个字段 × 好几个图片批全排成一条线，
 * 用户实测十几分钟才出结果。字段块之间读的字段不重叠，并发不影响正确性，
 * 只把等待时间叠在一起。4 是稳妥值：方舟默认限流够用，也不至于把账单节奏打乱。
 */
const CALL_CONCURRENCY = 4

/** 限制并发地跑一批任务，返回结果顺序与入参一致 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i] as T, i)
    }
  })
  await Promise.all(workers)
  return results
}

export class VisionRecognizer {
  private logger = createLogger('视觉识别')

  /**
   * 已被请求暂停的识别任务（按 runId）。
   * 一次识别会发出很多次模型调用，没法中途掐断单次 HTTP 请求，
   * 所以暂停点放在「两次调用之间」：跑完当前这次就停，结果照常返回。
   */
  private pausedRuns = new Set<string>()

  /** 请求暂停某个识别任务（runId 由渲染进程生成） */
  requestPause(runId?: string) {
    if (!runId) return
    this.pausedRuns.add(runId)
    this.logger.info(`收到暂停请求（runId=${runId}），当前调用结束后停止`)
  }

  async recognize(
    images: VisionImage[],
    config: VisionConfig,
    columns: LiveReportColumn[] = LIVE_REPORT_COLUMNS,
    runId?: string,
    /** 用户在页面「纠正记忆」里写下的规则，逐条追加到提示词里 */
    extraInstructions?: string[],
  ): Promise<VisionResult> {
    const baseURL =
      config.provider === 'custom'
        ? config.customBaseURL || ''
        : (providerService.providers[config.provider]?.baseURL ?? '')

    if (!baseURL) {
      throw new Error('缺少 baseURL（自定义 provider 请在设置中填写 API 地址）')
    }
    if (!config.apiKey) {
      throw new Error('缺少 API Key，请在页面视觉识别配置中填写')
    }

    // 保留「下标 → dataURL」的对应关系，方便回传「哪几张图已经识别完」
    const urlPairs = (
      await Promise.all(images.map(async (img, idx) => ({ idx, url: await toDataUrl(img) })))
    ).filter((p): p is { idx: number; url: string } => !!p.url)
    if (urlPairs.length === 0) {
      throw new Error('没有可用的图片')
    }

    // ---- 图片分批（视觉模型图片数限制）----
    const imageBatches: { idx: number; url: string }[][] = chunk(urlPairs, MAX_IMAGES_PER_BATCH)

    // ---- 字段分块（每块少量字段，让模型更专注、准确率更高）----
    const targetCols = columns.filter(
      c => c.source !== 'skip' && c.source !== 'computed' && c.source !== 'fixed',
    )
    const fieldChunks: LiveReportColumn[][] = chunk(targetCols, FIELDS_PER_CHUNK)

    const totalCalls = imageBatches.length * fieldChunks.length
    // 用户在页面上「调教」出来的规则：拼进 system 提示词，每一次调用都带上
    // 一条规则里允许换行（用户习惯把所有规则塞进同一条），续行缩进两格，避免和序号错位
    const extraRules = (extraInstructions ?? []).map(s => s.trim()).filter(Boolean)
    const systemPrompt =
      extraRules.length > 0
        ? `${buildSystemPrompt()}\n\n【用户指定的纠正规则（优先级最高，与上面规则冲突时以这里为准）】\n${extraRules
            .map((r, i) => `${i + 1}. ${r.replace(/\n+/g, '\n   ')}`)
            .join('\n')}`
        : buildSystemPrompt()
    this.logger.info(
      `共 ${urlPairs.length} 张图 → ${imageBatches.length} 个图片批；${targetCols.length} 个目标字段 → ${fieldChunks.length} 个字段块；计划 ${totalCalls} 次模型调用${
        extraRules.length > 0 ? `；附 ${extraRules.length} 条用户纠正规则` : ''
      }`,
    )
    if (extraRules.length > 0) {
      this.logger.info(
        `本次生效的纠正规则：\n${extraRules.map((r, i) => `  ${i + 1}. ${r}`).join('\n')}`,
      )
    }

    const openai = new OpenAI({ apiKey: config.apiKey, baseURL })
    const mergedValues: Record<string, string> = {}
    const allLowConfidence: string[] = []
    /** 已经完整跑完所有字段块的图片下标 */
    const processedImageIndexes: number[] = []
    let paused = false

    let callIdx = 0

    /**
     * 火山方舟的豆包是「思考型」模型，默认会先在内部写一大段推理再给答案。
     * 识别这种「照抄数字」的活完全不需要推理：实测输出动辄 1700+ tokens 全是思考链，
     * 既慢又费钱。所以方舟的请求一律先关掉思考；万一该模型不认这个参数，
     * 会在下面自动去掉再重试一次（不会因为参数问题直接失败）。
     */
    const supportsThinkingOff = config.provider === 'volcengine' || baseURL.includes('volces.com')

    /** 跑一个字段块（= 一次模型调用） */
    const runChunk = async (
      imgBatch: { idx: number; url: string }[],
      fChunk: LiveReportColumn[],
      bi: number,
      ci: number,
    ): Promise<{
      ci: number
      callNo: number
      parsed: Record<string, unknown> | null
      skipped: boolean
    }> => {
      // 暂停点：每个任务开始前检查一次（并发时仍在排队的不再发出）
      if (runId && this.pausedRuns.has(runId)) {
        return { ci, callNo: 0, parsed: null, skipped: true }
      }
      const callNo = ++callIdx
      const startedAt = Date.now()
      this.logger.info(
        `▶ 调用 ${callNo}/${totalCalls}：图片批 ${bi + 1}/${imageBatches.length}（${imgBatch.length} 张）+ 字段块 ${ci + 1}/${fieldChunks.length}（${fChunk.length} 个字段）`,
      )

      const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
        {
          type: 'text',
          text: buildUserPrompt(fChunk),
        },
        ...imgBatch.map(
          (p): OpenAI.Chat.Completions.ChatCompletionContentPart => ({
            type: 'image_url',
            image_url: { url: p.url, detail: 'high' },
          }),
        ),
      ]

      type Body = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
        thinking?: { type: 'disabled' | 'enabled' }
      }
      const body: Body = {
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content },
        ],
        stream: false,
        temperature: 0,
      }
      if (supportsThinkingOff) body.thinking = { type: 'disabled' }

      let resp: OpenAI.Chat.Completions.ChatCompletion
      try {
        resp = await openai.chat.completions.create(body)
      } catch (err) {
        // 关思考的参数有些模型/版本不认 → 去掉再试一次，别让识别直接挂掉
        if (supportsThinkingOff) {
          delete body.thinking
          try {
            resp = await openai.chat.completions.create(body)
          } catch (err2) {
            const msg = err2 instanceof Error ? err2.message : String(err2)
            this.logger.error(`调用 ${callNo}/${totalCalls} 失败: ${msg}`)
            throw new Error(`视觉识别第 ${callNo}/${totalCalls} 次调用失败: ${msg}`)
          }
        } else {
          const msg = err instanceof Error ? err.message : String(err)
          this.logger.error(`调用 ${callNo}/${totalCalls} 失败: ${msg}`)
          throw new Error(`视觉识别第 ${callNo}/${totalCalls} 次调用失败: ${msg}`)
        }
      }

      const cost = Date.now() - startedAt
      const usage = resp.usage
      this.logger.info(
        `✔ 调用 ${callNo} 耗时 ${(cost / 1000).toFixed(1)}s${
          usage
            ? `（输入 ${usage.prompt_tokens ?? '?'} / 输出 ${usage.completion_tokens ?? '?'} tokens）`
            : ''
        }`,
      )

      const raw = resp.choices[0]?.message?.content ?? ''
      this.logger.info(`调用 ${callNo} 模型返回（前2000字）:\n${raw.slice(0, 2000)}`)

      const { result: parsed, method } = extractJson(raw)
      if (!parsed) {
        this.logger.warn(`调用 ${callNo} 未返回可解析的 JSON（方法: ${method}）`)
        return { ci, callNo, parsed: null, skipped: false }
      }
      const parsedKeys = Object.keys(parsed)
      this.logger.info(
        `调用 ${callNo} 解析到 ${parsedKeys.length} 个键: [${parsedKeys.join(', ')}]`,
      )
      return { ci, callNo, parsed: parsed as Record<string, unknown>, skipped: false }
    }

    try {
      for (let bi = 0; bi < imageBatches.length; bi++) {
        const imgBatch = imageBatches[bi]
        const batchStartedAt = Date.now()

        // 同一批图片的多个字段块**并发**发出去：彼此读的字段完全不重叠，
        // 并发不影响结果，只把等待时间从「相加」变成「重叠」。
        // 图片批之间保持串行，保证「先出现的截图里的值优先」这个规则不变。
        const results = await mapWithConcurrency(fieldChunks, CALL_CONCURRENCY, (fChunk, ci) =>
          runChunk(imgBatch, fChunk, bi, ci),
        )

        if (results.some(r => r.skipped)) paused = true

        // 按字段块顺序合并（与并发完成先后无关，结果稳定可复现）
        for (const r of [...results].sort((a, b) => a.ci - b.ci)) {
          if (!r.parsed) continue
          const fChunk = fieldChunks[r.ci]
          let matched = 0
          for (const col of fChunk) {
            const v = findValue(r.parsed, col)
            if (v === undefined || v === null) continue
            const s = String(v).trim()
            if (s === '' || s === '""') continue
            // 只过滤「值正好等于该字段名/含义」这种最明确的回显；其余一律保留，交给用户核对
            if (s === col.label || s === col.key) continue
            if (!mergedValues[col.key]) {
              mergedValues[col.key] = s
              matched++
              if (col.unit !== 'text') {
                const num = Number.parseFloat(s.replace(/[^\d.-]/g, ''))
                if (Number.isNaN(num)) allLowConfidence.push(col.key)
              }
            }
          }
          this.logger.info(
            `调用 ${r.callNo} 匹配到 ${matched} 个字段（累计 ${Object.keys(mergedValues).length}）`,
          )
        }
        this.logger.info(
          `图片批 ${bi + 1}/${imageBatches.length} 完成，用时 ${(
            (Date.now() - batchStartedAt) / 1000
          ).toFixed(1)}s，累计 ${Object.keys(mergedValues).length} 个字段`,
        )

        // 只有这一批的**所有**字段块都跑完了，才把这些图算「已识别」。
        // 暂停发生在批中间时不能标记，否则剩下的字段块再也不会被读，数据就悄悄缺了。
        if (!paused) {
          for (const p of imgBatch) processedImageIndexes.push(p.idx)
        }
        if (paused) break
      }
    } finally {
      // 无论正常结束、暂停还是报错，都要清掉暂停标记，避免影响下一次识别
      if (runId) this.pausedRuns.delete(runId)
    }

    if (paused) {
      this.logger.info(
        `已暂停：完成 ${processedImageIndexes.length}/${urlPairs.length} 张图、${Object.keys(mergedValues).length} 个字段；剩余图片下次继续`,
      )
    } else {
      this.logger.info(`识别完成：共写入 ${Object.keys(mergedValues).length} 个字段`)
    }

    // 派生计算
    const derived = computeDerivedValues(mergedValues, columns)
    for (const [k, v] of Object.entries(derived)) mergedValues[k] = v

    return { values: mergedValues, lowConfidence: allLowConfidence, paused, processedImageIndexes }
  }
}
