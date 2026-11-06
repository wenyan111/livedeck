/**
 * 直播日报（飞书多维表格）列定义。
 * 配置驱动：视觉识别与 Excel 导出都以 `label` 为准，不硬编码。
 */

export type ColumnUnit = 'none' | 'wan' | 'hour' | 'percent' | 'text'

export interface LiveReportColumn {
  /**
   * 归属平台。每个平台有自己独立的一套列（字段各不相同），
   * 数据行也按平台归属，页面上按平台分区展示、不用来回切换。
   */
  platform: LiveControlPlatform
  /** 稳定内部键（用于映射到飞书列 / 内部存储） */
  key: string
  /** 飞书表列头（视觉识别提示词与导出表头都使用此名） */
  label: string
  /** 单位换算提示，决定导出前如何把识别到的原文转成数值 */
  unit: ColumnUnit
  /** 来源：manual=需人工填写；vision=从截图识别；skip=留空不填；computed=由其它列计算得出 */
  /**
   * 字段怎么来：
   *  manual   人工填写
   *  vision   视觉识别（从截图直接抄）
   *  ai       AI 判断（不照抄，让模型根据截图内容自己下结论，如场次、区间）
   *  fixed    规则固定（值定死，识别和手改都不动它，如平台名、主播名）
   *  skip     留空
   *  computed 自动计算
   */
  source: 'manual' | 'vision' | 'ai' | 'fixed' | 'skip' | 'computed'
  /** UI 分组 */
  group: string
  /**
   * 保留几位小数（四舍五入）。不填 = 不做处理，保留原始值。
   * 每个字段可单独设置：ROI 要 2 位、观看人数要 0 位、UV 价值 2 位…
   * （用户 2026-11-05 要求「可以自定义字段四舍五入」）
   */
  decimals?: number
}

/**
 * 内置默认列。
 *
 * 这批字段来自抖音（罗盘大屏），所以整体标记为 `douyin`；
 * 其它平台（快手 / 视频号 / 小红书 / 淘宝）默认没有任何列，
 * 由用户在「管理列」里各自添加。
 */
const BUILTIN_COLUMNS: Array<Omit<LiveReportColumn, 'platform'>> = [
  // 基础信息（人工填写）
  { key: 'weekLabel', label: '周标签', unit: 'text', source: 'manual', group: '基础信息' },
  { key: 'anchorName', label: '主播名称', unit: 'text', source: 'manual', group: '基础信息' },
  { key: 'date', label: '日期', unit: 'text', source: 'manual', group: '基础信息' },
  { key: 'session', label: '场次', unit: 'none', source: 'manual', group: '基础信息' },
  { key: 'time', label: '时间', unit: 'text', source: 'manual', group: '基础信息' },

  // 流量
  { key: 'durationHour', label: '直播时长（h）', unit: 'hour', source: 'vision', group: '流量' },
  { key: 'viewersWan', label: '观看人数（w）', unit: 'wan', source: 'vision', group: '流量' },
  { key: 'roomViewsWan', label: '直播间浏览量（w）', unit: 'wan', source: 'skip', group: '流量' },
  { key: 'nonFollowWan', label: '非关注用户数（w）', unit: 'wan', source: 'skip', group: '流量' },
  { key: 'followWan', label: '关注用户数（w）', unit: 'wan', source: 'skip', group: '流量' },
  { key: 'exposeUsersWan', label: '曝光人数（w）', unit: 'wan', source: 'vision', group: '流量' },
  { key: 'exposeTimesWan', label: '曝光次数（w）', unit: 'wan', source: 'vision', group: '流量' },
  {
    key: 'exposeViewRate',
    label: '曝光观看率（次数）',
    unit: 'none',
    source: 'vision',
    group: '流量',
  },
  {
    key: 'viewInteractRate',
    label: '观看互动率（人数）',
    unit: 'none',
    source: 'vision',
    group: '流量',
  },
  { key: 'peakOnline', label: '最高在线人数', unit: 'none', source: 'vision', group: '流量' },
  { key: 'avgOnline', label: '平均在线人数', unit: 'none', source: 'vision', group: '流量' },
  { key: 'fansRatio', label: '粉丝占比', unit: 'percent', source: 'vision', group: '流量' },
  { key: 'newFans', label: '新增粉丝数', unit: 'none', source: 'vision', group: '流量' },
  { key: 'fanConvertRate', label: '转粉率', unit: 'percent', source: 'vision', group: '流量' },
  { key: 'fansGroupNew', label: '粉丝团新增人数', unit: 'none', source: 'vision', group: '流量' },
  {
    key: 'joinGroupRate',
    label: '加团率',
    unit: 'percent',
    source: 'computed',
    group: '流量',
    decimals: 2,
  },
  { key: 'comments', label: '评论数', unit: 'none', source: 'vision', group: '流量' },
  {
    key: 'avgCommentsPerMin',
    label: '平均评论次数(分)',
    unit: 'none',
    source: 'computed',
    group: '流量',
    decimals: 2,
  },
  { key: 'likesWan', label: '点赞量（w）', unit: 'wan', source: 'vision', group: '流量' },
  { key: 'avgStayDuration', label: '平均停留时长', unit: 'hour', source: 'vision', group: '流量' },

  // 成交
  { key: 'liveRecommend', label: '直播推荐', unit: 'none', source: 'vision', group: '成交' },
  { key: 'liveRecommendGpm', label: '直播推荐GPM', unit: 'none', source: 'vision', group: '成交' },
  { key: 'videoRecommend', label: '视频推荐', unit: 'none', source: 'vision', group: '成交' },
  { key: 'videoRecommendGpm', label: '视频推荐GPM', unit: 'none', source: 'vision', group: '成交' },
  { key: 'srcFollow', label: '关注', unit: 'none', source: 'vision', group: '成交' },
  { key: 'srcPay', label: '付费', unit: 'none', source: 'vision', group: '成交' },
  { key: 'srcOther', label: '其他', unit: 'none', source: 'vision', group: '成交' },
  { key: 'srcSearch', label: '搜索', unit: 'none', source: 'vision', group: '成交' },
  {
    key: 'peerMedianExposeTimes',
    label: '同层中位数曝光次数',
    unit: 'none',
    source: 'vision',
    group: '成交',
  },
  {
    key: 'peerMedianExposeViewRate',
    label: '同层中位数曝光观看率',
    unit: 'percent',
    source: 'vision',
    group: '成交',
  },
  {
    key: 'peerMedianThousand',
    label: '同层中位千次',
    unit: 'none',
    source: 'vision',
    group: '成交',
  },
  { key: 'payGmv', label: '支付GMV', unit: 'none', source: 'vision', group: '成交' },
  { key: 'gpm', label: 'GPM', unit: 'none', source: 'vision', group: '成交' },
  { key: 'payUsers', label: '成交人数', unit: 'none', source: 'vision', group: '成交' },
  { key: 'uvValue', label: 'UV价值', unit: 'none', source: 'computed', group: '成交', decimals: 2 },
  { key: 'investAmount', label: '投放金额', unit: 'none', source: 'vision', group: '成交' },
  { key: 'roi', label: '整场ROI', unit: 'none', source: 'computed', group: '成交', decimals: 2 },
  {
    key: 'videoDealRatio',
    label: '视频成交占比',
    unit: 'percent',
    source: 'vision',
    group: '成交',
  },
  { key: 'refundAmount', label: '下播退货金额', unit: 'none', source: 'vision', group: '成交' },
  {
    key: 'preShipRefundRate',
    label: '发货前退款率',
    unit: 'percent',
    source: 'vision',
    group: '成交',
  },

  // 商品 / 人群
  { key: 'mainProduct', label: '主品', unit: 'text', source: 'manual', group: '商品人群' },
  {
    key: 'productExposeClick',
    label: '商品曝光点击',
    unit: 'none',
    source: 'vision',
    group: '商品人群',
  },
  {
    key: 'productClickDeal',
    label: '商品点击成交',
    unit: 'none',
    source: 'vision',
    group: '商品人群',
  },
  { key: 'clothingColor', label: '服装颜色', unit: 'text', source: 'manual', group: '商品人群' },
  {
    key: 'age50PlusRatio',
    label: '50+占比（观看）',
    unit: 'percent',
    source: 'vision',
    group: '商品人群',
  },
  {
    key: 'maleFansRatio',
    label: '男粉占比（观看）',
    unit: 'percent',
    source: 'vision',
    group: '商品人群',
  },
  { key: 'viewCoreCity', label: '观看核心城市', unit: 'text', source: 'vision', group: '商品人群' },
  { key: 'dealCoreCity', label: '成交核心城市', unit: 'text', source: 'vision', group: '商品人群' },
]

export const LIVE_REPORT_COLUMNS: LiveReportColumn[] = BUILTIN_COLUMNS.map(c => ({
  ...c,
  platform: 'douyin' as const,
}))

/** 非抖音字段（需人工填写，视觉识别不应覆盖） */
export const MANUAL_COLUMN_KEYS = LIVE_REPORT_COLUMNS.filter(c => c.source === 'manual').map(
  c => c.key,
)

/** 按列配置四舍五入到指定小数位；没配置或不是数字就原样返回 */
export function roundByColumn(value: string, column: LiveReportColumn): string {
  const digits = column.decimals
  if (digits === undefined || digits === null) return value
  // 中文时长（「2小时05分」）、带文字的值不做数值四舍五入，
  // 否则「2小时28分」会被 parseFloat 读成 228，把纠正记忆写出来的格式冲掉
  if (/[\u4e00-\u9fa5]/.test(String(value))) return value
  const num = Number.parseFloat(String(value).replace(/[^\d.-]/g, ''))
  if (Number.isNaN(num)) return value
  // 百分号不能在四舍五入时丢掉（用户纠正规则：百分比必须带 %）
  const suffix = String(value).trim().endsWith('%') ? '%' : ''
  return String(+num.toFixed(digits)) + suffix
}

/**
 * 把「2小时05分」「2时5分」「2:28:00」「2.47」统一解析成小时数。
 *
 * 用户 2026-11-06 用「纠正记忆」规定直播时长要填「2小时05分」这种格式；
 * 之前 `toNumber()` 直接剥掉非数字会把「2小时28分」读成 228，
 * 派生列（平均评论次数/分）会跟着算错，这里统一按真实时长解析。
 */
export function parseDurationHours(raw: string): number | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  const hms = text.match(/(\d{1,2}):(\d{2}):(\d{2})/)
  if (hms) return Number(hms[1]) + Number(hms[2]) / 60 + Number(hms[3]) / 3600
  const hm = text.match(/(\d+)\s*小?时\s*(\d+)\s*分?/)
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60
  const onlyHour = text.match(/^(\d+)\s*小时?$/)
  if (onlyHour) return Number(onlyHour[1])
  const n = Number.parseFloat(text.replace(/[^\d.]/g, ''))
  return Number.isNaN(n) ? null : n
}

/** 把视觉识别到的原文按列单位转换成可写入的数值/文本 */
export function convertColumnValue(column: LiveReportColumn, raw: string): string {
  const text = (raw ?? '').trim()
  if (text === '') return ''

  if (column.unit === 'text') return text
  if (column.unit === 'wan') {
    const num = Number.parseFloat(text.replace(/[^\d.]/g, ''))
    if (Number.isNaN(num)) return text
    // 原文带"万"直接用该数；否则若数值很大（>=10000）视为原始人数，转成万
    if (text.includes('万')) return String(num)
    return num >= 10000 ? String(+(num / 10000).toFixed(4)) : String(num)
  }
  if (column.unit === 'hour') {
    const hours = parseDurationHours(text)
    return hours === null ? text : String(+hours.toFixed(4))
  }
  if (column.unit === 'percent') {
    const num = Number.parseFloat(text.replace(/[^\d.]/g, ''))
    return Number.isNaN(num) ? text : String(num) + (text.includes('%') ? '%' : '')
  }
  // none：保留原文（通常为数字），但按列配置四舍五入
  return roundByColumn(text, column)
}

/** 派生计算列所依赖的基础列 key（改这些列时触发重算） */
export const COMPUTED_DEPENDENCY_KEYS = [
  'payGmv', // 支付GMV
  'investAmount', // 投放金额
  'viewersWan', // 观看人数（w）
  'comments', // 评论数
  'durationHour', // 直播时长（h）
  'fansGroupNew', // 粉丝团新增人数
]

function toNumber(v: string): number | null {
  if (!v) return null
  const n = Number.parseFloat(String(v).replace(/[^\d.]/g, ''))
  return Number.isNaN(n) ? null : n
}

/** 取某列的实际数值（wan 列需 ×10000 还原成真实数量） */
function actualCount(
  raw: Record<string, string>,
  key: string,
  columns: LiveReportColumn[] = LIVE_REPORT_COLUMNS,
): number | null {
  const col = columns.find(c => c.key === key)
  const n = toNumber(raw[key] ?? '')
  if (n === null) return null
  return col?.unit === 'wan' ? n * 10000 : n
}

/**
 * 根据已识别/已填写的基础列，计算派生列。
 * - 整场ROI = 支付GMV / 投放金额
 * - 平均评论次数(分) = 评论数 / (直播时长小时 × 60)
 * - UV价值 = 支付GMV / 观看人数
 * - 加团率(%) = 粉丝团新增人数 / 观看人数 × 100
 * 返回计算成功的派生列 key -> 字符串数值；缺依赖则返回空。
 */
export function computeDerivedValues(
  raw: Record<string, string>,
  columns: LiveReportColumn[] = LIVE_REPORT_COLUMNS,
): Record<string, string> {
  const out: Record<string, string> = {}
  const gmv = actualCount(raw, 'payGmv', columns)
  const invest = actualCount(raw, 'investAmount', columns)
  const viewers = actualCount(raw, 'viewersWan', columns)
  const comments = actualCount(raw, 'comments', columns)
  const durationH = parseDurationHours(raw['durationHour'] ?? '')
  const fansGroup = actualCount(raw, 'fansGroupNew', columns)

  // 派生列按「该列配置的小数位」四舍五入（没配就默认 2 位）
  const digitsOf = (key: string) => columns.find(c => c.key === key)?.decimals ?? 2
  if (gmv !== null && invest !== null && invest !== 0) {
    out['roi'] = String(+(gmv / invest).toFixed(digitsOf('roi')))
  }
  if (comments !== null && durationH !== null && durationH > 0) {
    out['avgCommentsPerMin'] = String(
      +(comments / (durationH * 60)).toFixed(digitsOf('avgCommentsPerMin')),
    )
  }
  if (gmv !== null && viewers !== null && viewers !== 0) {
    out['uvValue'] = String(+(gmv / viewers).toFixed(digitsOf('uvValue')))
  }
  if (fansGroup !== null && viewers !== null && viewers !== 0) {
    out['joinGroupRate'] = String(+((fansGroup / viewers) * 100).toFixed(digitsOf('joinGroupRate')))
  }
  return out
}

/**
 * 「自动计算」字段的公式说明（纯展示用）。
 * 这些值是本地算的，跟 AI 无关：识别/手填完立刻用已有字段算出来。
 */
export const COMPUTED_RULES: Record<string, string> = {
  uvValue: '支付GMV ÷ 观看人数',
  joinGroupRate: '新加直播团人数 ÷ 观看人数 × 100%',
  avgCommentsPerMin: '评论次数 ÷ 直播时长（分钟）',
  roi: '支付GMV ÷ 投放金额',
}

/** 取某个自动计算字段的公式说明（不是计算列就返回 undefined） */
export const computedRuleOf = (key: string, source?: string) =>
  source === 'computed' ? COMPUTED_RULES[key] : undefined

/** 返回一份全新的默认列定义副本（用于「恢复默认」，避免改动常量本身） */
export function getDefaultColumns(): LiveReportColumn[] {
  return LIVE_REPORT_COLUMNS.map(c => ({ ...c }))
}

/** 为新增的自定义列生成一个不与现有列冲突的唯一 key */
export function generateColumnKey(existing: LiveReportColumn[]): string {
  let i = 1
  let key = `custom_${i}`
  while (existing.some(c => c.key === key)) {
    i++
    key = `custom_${i}`
  }
  return key
}
