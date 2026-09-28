import fs from 'node:fs/promises'
import path from 'node:path'
import OpenAI from 'openai'
import { LIVE_REPORT_COLUMNS, computeDerivedValues, type LiveReportColumn } from 'shared/liveReportColumns'
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
}

// ──────────────────────────────────────────────
// 视觉模板：字段位置校准 & 复用
// ──────────────────────────────────────────────

/** 单个字段在标准截图中的位置（归一化坐标 0~1） */
export interface FieldLocation {
  key: string       // 字段 key，如 "viewersWan"
  label: string     // 字段中文标签
  x: number         // 左上角 x (0~1)
  y: number         // 左上角 y (0~1)
  w: number         // 宽度 (0~1)
  h: number         // 高度 (0~1)
}

/** 一套完整的视觉模板 */
export interface VisionTemplate {
  id: string                    // 唯一 ID
  name: string                  // 如 "抖音大屏-晚场"
  imageBase64: string           // 标准截图 dataURL
  fields: FieldLocation[]       // 所有字段的位置
  sampleValues?: Record<string, string> // 校准时用的已知数据（用于验证）
  createdAt: number             // 创建时间戳
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
  const targetCols = columns.filter(c => c.source !== 'skip' && c.source !== 'computed')
  // 用「键名（含义）→ 例：数值」格式，避免模型把含义当成值
  const items = targetCols
    .map(c => `- "${c.key}"（含义：${c.label}）→ 例：从截图读到的真实数值`)
    .join('\n')
  return (
    `请从这些直播数据截图中，逐个读取下面每个指标的真实数值。\n\n` +
    `【要提取的字段（共 ${targetCols.length} 项）】\n${items}\n\n` +
    `【重要规则】\n` +
    `1. 只返回一个纯 JSON 对象，键名严格用上面的英文键名（如 "viewersWan"）。\n` +
    `2. 【最关键】每个值必须是你从截图中**真正读到的数据**：数字、日期、时间、百分比或文本。\n` +
    `   - 例："viewersWan" 的值应返回 5.32 这样的数字，绝对不能返回 "观看人数（w）" 或 "viewersWan" 这种文字。\n` +
    `   - 例："payGmv" 的值应返回 5234.5 这样的数字，绝对不能返回 "GMV" 或 "支付GMV"。\n` +
    `3. 截图中能看到的指标一律填写，近似也可；完全看不到/图上没有的才用 ""。\n` +
    `4. 单位处理：\n` +
    `   - 键名含 Wan（如 viewersWan）："X万"返回 X（12.3万→12.3）；大数直接返回（123000→123000）。\n` +
    `   - 键名含 Hour（如 durationHour）：返回小时数（2:30:00→2.5）。\n` +
    `   - 键名含 Rate/Ratio：返回百分数数字（35%→35）。\n` +
    `   - 其余数值按原样返回。\n` +
    `5. 【绝对禁止】不要用 \`\`\` 包裹、不要加任何说明文字，直接输出 { 开头的 JSON。`
  )
}

/**
 * 构建校准 prompt：让 AI 从标准截图 + 已知数据中定位每个字段的位置
 */
function buildCalibrationPrompt(
  columns: LiveReportColumn[],
  knownValues: Record<string, string>,
): string {
  const targetCols = columns.filter(c => c.source !== 'skip' && c.source !== 'computed')
  // 只列出有已知值的字段
  const items = targetCols
    .filter(c => knownValues[c.key] !== undefined && knownValues[c.key] !== '')
    .map(c => `- "${c.key}"（${c.label}）：值 = ${knownValues[c.key]}`)
    .join('\n')

  // 构建示例：取前3个有已知值的字段做示例
  const sampleCols = targetCols.filter(c => knownValues[c.key]).slice(0, 3)
  const sampleJson = sampleCols.map(c => `  "${c.key}": {"x": 0.1, "y": 0.2, "w": 0.08, "h": 0.03}`).join(',\n')

  return (
    `这是一张标准的抖音直播数据截图（如实时大屏或复盘页）。\n` +
    `我已知道其中部分字段的真实数值。请帮我找出每个字段在截图中的位置。\n\n` +
    `【已知数值的字段】（共 ${items.split('\n').length} 个）\n${items}\n\n` +
    `【你的任务】\n` +
    `对上面列出的**每一个**已知字段，返回它在截图中的归一化坐标。\n\n` +
    `【返回格式要求】\n` +
    `- 输出纯 JSON 对象，键名必须使用上面的英文 key（如 "viewersWan"），不要用中文\n` +
    `- 每个值是 {x, y, w, h} 对象，x/y/w/h 全部是数字类型（不是字符串！）\n` +
    `- x,y 是字段数值区域左上角的归一化坐标（0=最左/最上，1=最右/最下）\n` +
    `- w,h 是区域的宽高（通常 0.03~0.15 之间）\n` +
    `- 坐标不需要非常精确，误差 ±0.05 以内即可\n\n` +
    `【必须返回的格式示例】\n` +
    `{\n${sampleJson}\n}\n\n` +
    `【重要】\n` +
    `1. 必须为上面列出的每一个已知字段都返回坐标，不能遗漏\n` +
    `2. 键名严格使用英文 key（双引号包裹），绝对不能用中文标签做键名\n` +
    `3. x/y/w/h 必须是数字（如 0.12），不能用字符串（如 "0.12"）\n` +
    `4. 不要用 \`\`\` 包裹，直接输出 { 开头的 JSON`
  )
}

/**
 * 构建带模板位置指引的识别 prompt
 * 核心改进：告诉 AI 每个字段大概在图的哪个位置，让它按位置去读
 */
function buildTemplateGuidedPrompt(
  chunkCols: LiveReportColumn[],
  template: VisionTemplate,
): string {
  // 为当前块中的每个字段查找模板中的位置信息
  const locationMap = new Map<string, FieldLocation>()
  for (const f of template.fields) {
    locationMap.set(f.key, f)
  }

  const items = chunkCols.map(col => {
    const loc = locationMap.get(col.key)
    if (loc) {
      // 把归一化坐标转成人类可读的位置描述
      const posDesc = describePosition(loc)
      return `- "${col.key}"（${col.label}）→ 位于 ${posDesc}，请读取该位置的数值`
    }
    return `- "${col.key}"（${col.label}）→ 请在截图中找到并读取`
  }).join('\n')

  return (
    `这是一张与标准模板布局相同的直播数据截图。请根据每个字段的大概位置来精准读取数值。\n\n` +
    `【要提取的字段（共 ${chunkCols.length} 项）+ 位置指引】\n${items}\n\n` +
    `【重要规则】\n` +
    `1. 只返回一个纯 JSON 对象，键名用上面的英文键名。\n` +
    `2. 每个值必须是你从截图中**真正读到的数据**：数字、日期、时间等。\n` +
    `3. 绝对不能把字段名/标签当值回显（如 viewersWan 的值不能是"观看人数"）。如果某个位置确实找不到对应数据，用 ""。\n` +
    `4. 截图中能看到的指标一律填写近似值也可；完全看不到才用 ""。\n` +
    `5. 不要用 \`\`\` 包裹，直接输出 JSON。`
  )
}

/**
 * 把归一化坐标转成人类可读的位置描述
 */
function describePosition(loc: FieldLocation): string {
  const cx = loc.x + loc.w / 2   // 中心 x
  const cy = loc.y + loc.h / 2   // 中心 y

  // 水平方向
  let hPos: string
  if (cx < 0.33) hPos = '左侧'
  else if (cx < 0.67) hPos = '中间'
  else hPos = '右侧'

  // 垂直方向
  let vPos: string
  if (cy < 0.25) vPos = '上方'
  else if (cy < 0.5) vPos = '中上部'
  else if (cy < 0.75) vPos = '中下部'
  else vPos = '下方'

  return `${vPos}${hPos}（约 ${Math.round(cx * 100)}%, ${Math.round(cy * 100)}% 处）`
}

/** 归一化用于比较 */
function normalize(s: string): string {
  return s.replace(/[（(]/g, '(').replace(/[）)]/g, ')').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** 从标签去掉单位后缀 */
function coreName(label: string): string {
  return normalize(label).replace(/[（(][^）)]*[）)]/g, '').trim()
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
  let s1 = jsonStr.replace(/"(?:[^"\\]|\\.)*"/g, (match) => {
    return match.replace(/(?<!\\)\n/g, ' ').replace(/(?<!\\)\t/g, ' ').replace(/(?<!\\)\r/g, ' ')
  })
  variants.push(s1)

  // 2. 中文标点替换
  let s2 = s1
    .replace(/，/g, ',')
    .replace(/：/g, ':')
    .replace(/"/g, '"')  // 中文引号
    .replace(/"/g, '"')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
  variants.push(s2)

  // 3. 移除 markdown 加粗/斜体
  let s3 = s2.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
  variants.push(s3)

  // 4. 移除字符串内的控制字符（保留普通空格和换行）
  let s4 = s3.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  variants.push(s4)

  // 5. 修复尾逗号
  let s5 = s4.replace(/,\s*([}\]])/g, '$1')
  variants.push(s5)

  // 6. 单引号 → 双引号
  let s6 = s5
    .replace(/'([^']+)'\s*:/g, '"$1":')
    .replace(/:\s*'([^']*)'/g, ':"$1"')
  variants.push(s6)

  // 7. 去掉注释（// 或 /* */）
  let s7 = s6.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  variants.push(s7)

  // 8. 修复无引号的键名（key: value → "key": value）——仅当键是合法标识符时
  let s8 = s7.replace(/(?:^|\n)\s*([a-zA-Z_]\w*)\s*:/g, '"$1":')
  variants.push(s8)

  return variants
}

/**
 * 超强健 JSON 提取：多层策略
 */
function extractJson(text: string): { result: Record<string, unknown> | null; method: string; rawSnippet?: string } {
  let t = cleanRawText(text)

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
    let jsonStr = t.slice(start, end + 1)

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
  const combinedPattern = /(?:"([a-zA-Z_]\w*)"|([a-zA-Z_]\w*))\s*[:]\s*(?:"((?:[^"\\]|\\.)*)"|(-?\d+\.?\d*(?:[eE][+-]?\d+)?|(true|false|null)))/g

  let match: RegExpExecArray | null
  while ((match = combinedPattern.exec(text)) !== null) {
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
  }

  return Object.keys(result).length > 0 ? result : null
}

/** 单批最大图片数（视觉模型限制） */
const MAX_IMAGES_PER_BATCH = 4

/** 每块请求的字段数——字段越少模型越专注，准确率越高 */
const FIELDS_PER_CHUNK = 10

/** 把数组按 size 切块 */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export class VisionRecognizer {
  private logger = createLogger('视觉识别')

  async recognize(
    images: VisionImage[],
    config: VisionConfig,
    columns: LiveReportColumn[] = LIVE_REPORT_COLUMNS,
    template?: VisionTemplate | null,
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

    const dataUrls = await Promise.all(images.map(toDataUrl))
    const valid = dataUrls.filter((u): u is string => !!u)
    if (valid.length === 0) {
      throw new Error('没有可用的图片')
    }

    // ---- 图片分批（视觉模型图片数限制）----
    const imageBatches: string[][] = chunk(valid, MAX_IMAGES_PER_BATCH)

    // ---- 字段分块（每块少量字段，让模型更专注、准确率更高）----
    const targetCols = columns.filter(c => c.source !== 'skip' && c.source !== 'computed')
    const fieldChunks: LiveReportColumn[][] = chunk(targetCols, FIELDS_PER_CHUNK)

    const totalCalls = imageBatches.length * fieldChunks.length
    const useTemplate = template && template.fields.length > 0
    this.logger.info(
      `共 ${valid.length} 张图 → ${imageBatches.length} 个图片批；${targetCols.length} 个目标字段 → ${fieldChunks.length} 个字段块；计划 ${totalCalls} 次模型调用${useTemplate ? '（使用模板位置引导）' : ''}`,
    )

    const openai = new OpenAI({ apiKey: config.apiKey, baseURL })
    const mergedValues: Record<string, string> = {}
    const allLowConfidence: string[] = []

    let callIdx = 0

    for (let bi = 0; bi < imageBatches.length; bi++) {
      const imgBatch = imageBatches[bi]

      for (let ci = 0; ci < fieldChunks.length; ci++) {
        const fChunk = fieldChunks[ci]
        callIdx++
        this.logger.info(
          `▶ 调用 ${callIdx}/${totalCalls}：图片批 ${bi + 1}/${imageBatches.length}（${imgBatch.length} 张）+ 字段块 ${ci + 1}/${fieldChunks.length}（${fChunk.length} 个字段）`,
        )

        const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
          { type: 'text', text: useTemplate ? buildTemplateGuidedPrompt(fChunk, template) : buildUserPrompt(fChunk) },
          ...imgBatch.map(
            (url): OpenAI.Chat.Completions.ChatCompletionContentPart => ({
              type: 'image_url',
              image_url: { url, detail: 'high' },
            }),
          ),
        ]

        let resp
        try {
          resp = await openai.chat.completions.create({
            model: config.model,
            messages: [
              { role: 'system', content: buildSystemPrompt() },
              { role: 'user', content },
            ],
            stream: false,
            temperature: 0,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          this.logger.error(`调用 ${callIdx}/${totalCalls} 失败: ${msg}`)
          throw new Error(`视觉识别第 ${callIdx}/${totalCalls} 次调用失败: ${msg}`)
        }

        const raw = resp.choices[0]?.message?.content ?? ''
        this.logger.info(`调用 ${callIdx} 模型返回（前2000字）:\n${raw.slice(0, 2000)}`)

        const { result: parsed, method } = extractJson(raw)

        if (!parsed) {
          this.logger.warn(`调用 ${callIdx} 未返回可解析的 JSON（方法: ${method}）`)
          continue
        }

        const parsedKeys = Object.keys(parsed)
        this.logger.info(`调用 ${callIdx} 解析到 ${parsedKeys.length} 个键: [${parsedKeys.join(', ')}]`)

        // 合并（只处理本块的字段）
        let matched = 0
        for (const col of fChunk) {
          const v = findValue(parsed, col)
          if (v === undefined || v === null) continue
          const s = String(v).trim()
          if (s === '' || s === '""') continue
          // 只过滤「值正好等于该字段名/含义」这种最明确的回显；其余一律保留，交给用户核对
          if (s === col.label || s === col.key) continue
          if (!mergedValues[col.key]) {
            mergedValues[col.key] = s
            matched++
            if (col.unit !== 'text') {
              const num = Number.parseFloat(s.replace(/[^\d.\-]/g, ''))
              if (Number.isNaN(num)) allLowConfidence.push(col.key)
            }
          }
        }
        this.logger.info(`调用 ${callIdx} 匹配到 ${matched} 个字段（累计 ${Object.keys(mergedValues).length}）`)
      }
    }

    this.logger.info(`识别完成：共写入 ${Object.keys(mergedValues).length} 个字段`)

    // 派生计算
    const derived = computeDerivedValues(mergedValues, columns)
    for (const [k, v] of Object.entries(derived)) mergedValues[k] = v

    return { values: mergedValues, lowConfidence: allLowConfidence }
  }

  /**
   * 校准模板：从标准截图 + 已知数据中，让 AI 定位每个字段在图中的位置
   *
   * @param templateImage 标准截图（一张）
   * @param config 视觉模型配置
   * @param columns 字段定义
   * @param knownValues 已知的字段值（至少 5~10 个，越多越准）
   * @returns 校准好的模板（含字段坐标）
   */
  async calibrateTemplate(
    templateImage: VisionImage,
    config: VisionConfig,
    columns: LiveReportColumn[] = LIVE_REPORT_COLUMNS,
    knownValues: Record<string, string> = {},
  ): Promise<VisionTemplate> {
    const baseURL =
      config.provider === 'custom'
        ? config.customBaseURL || ''
        : (providerService.providers[config.provider]?.baseURL ?? '')

    if (!baseURL) throw new Error('缺少 baseURL')
    if (!config.apiKey) throw new Error('缺少 API Key')

    const dataUrl = await toDataUrl(templateImage)
    if (!dataUrl) throw new Error('模板图片无效')

    this.logger.info(`开始校准模板：${Object.keys(knownValues).length} 个已知字段`)

    const openai = new OpenAI({ apiKey: config.apiKey, baseURL })

    const resp = await openai.chat.completions.create({
      model: config.model,
      messages: [
        { role: 'system', content: '你是一个精确的 UI 元素定位助手。从截图中找出指定字段数值所在的区域，返回归一化坐标。' },
        { role: 'user', content: [
          { type: 'text', text: buildCalibrationPrompt(columns, knownValues) },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
        ] },
      ],
      stream: false,
      temperature: 0,
    })

    const raw = resp.choices[0]?.message?.content ?? ''
    this.logger.info(`校准模型返回（前2000字）:\n${raw.slice(0, 2000)}`)
    this.logger.info(`校准模型返回总长度: ${raw.length} 字符`)

    const { result: parsed } = extractJson(raw)
    if (!parsed) {
      throw new Error('校准失败：模型未返回有效的坐标 JSON。原始内容：' + raw.slice(0, 800))
    }

    // 诊断：输出解析到的所有顶层键名和值类型
    const parsedKeys = Object.keys(parsed)
    this.logger.info(`校准 JSON 解析到 ${parsedKeys.length} 个顶层键: [${parsedKeys.join(', ')}]`)
    for (const k of parsedKeys.slice(0, 10)) {
      const v = parsed[k]
      const type = Array.isArray(v) ? `array[${v.length}]` : typeof v
      this.logger.info(`  键 "${k}" → 类型=${type}, 值预览=${JSON.stringify(v).slice(0, 120)}`)
    }

    /**
     * 从解析到的值中提取坐标 {x, y, w, h}
     * 兼容多种格式：
     * - 对象 {x: 0.1, y: 0.2, w: 0.05, h: 0.03}
     * - 数组 [0.1, 0.2, 0.05, 0.03] → 映射为 x,y,w,h
     * - 字符串数值 "0.1" → parseFloat
     */
    function extractCoord(val: unknown): { x: number; y: number; w?: number; h?: number } | null {
      if (!val) return null
      if (typeof val === 'string') {
        // 尝试解析 JSON 字符串
        try {
          val = JSON.parse(val)
        } catch { /* 不是JSON */ }
      }
      if (typeof val !== 'object' || !val) return null
      const o = val as Record<string, unknown>

      // 格式1: 对象 {x, y, w, h}
      if ('x' in o && 'y' in o) {
        const x = Number(o.x), y = Number(o.y)
        if (!Number.isNaN(x) && !Number.isNaN(y)) {
          return {
            x,
            y,
            w: 'w' in o ? Number(o.w) : undefined,
            h: 'h' in o ? Number(o.h) : undefined,
          }
        }
      }

      // 格式2: 数组 [x, y] 或 [x, y, w, h]
      if (Array.isArray(o) && o.length >= 2) {
        const x = Number(o[0]), y = Number(o[1])
        if (!Number.isNaN(x) && !Number.isNaN(y)) {
          return { x, y, w: o.length >= 3 ? Number(o[2]) : undefined, h: o.length >= 4 ? Number(o[3]) : undefined }
        }
      }

      return null
    }

    // 解析坐标 → FieldLocation[]
    const fields: FieldLocation[] = []
    const matchedByLabel: string[] = []  // 通过标签名匹配的

    for (const col of columns) {
      if (col.source === 'skip' || col.source === 'computed') continue

      // 策略1: 用 col.key 精确匹配
      let coord = extractCoord(parsed[col.key])

      // 策略2: 用 col.label 匹配（AI 可能用了中文标签做键）
      if (!coord) coord = extractCoord(parsed[col.label])

      // 策略3: 归一化 label 后匹配
      if (!coord) {
        const normLabel = normalize(col.label)
        for (const [pk, pv] of Object.entries(parsed)) {
          if (normalize(pk) === normLabel) {
            coord = extractCoord(pv)
            if (coord) { matchedByLabel.push(col.key); break }
          }
        }
      }

      if (!coord || Number.isNaN(coord.x) || Number.isNaN(coord.y)) continue

      fields.push({
        key: col.key,
        label: col.label,
        x: Math.max(0, Math.min(1, coord.x)),
        y: Math.max(0, Math.min(1, coord.y)),
        w: Math.max(0.01, Math.min(0.5, coord.w ?? 0.08)),
        h: Math.max(0.01, Math.min(0.2, coord.h ?? 0.04)),
      })
    }

    this.logger.info(`校准完成：定位了 ${fields.length} 个字段位置（其中 ${matchedByLabel.length} 个通过标签名匹配）`)

    // 构建已知值中不在 fields 里的条目日志
    const missingKeys = Object.keys(knownValues).filter(k => !fields.some(f => f.key === k))
    if (missingKeys.length > 0) {
      this.logger.warn(`${missingKeys.length} 个已知字段未能定位: [${missingKeys.join(', ')}]`)
    }

    const template: VisionTemplate = {
      id: `tmpl_${Date.now()}`,
      name: `直播数据模板 ${new Date().toLocaleDateString('zh-CN')}`,
      imageBase64: dataUrl,
      fields,
      sampleValues: knownValues,
      createdAt: Date.now(),
    }

    return template
  }
}
