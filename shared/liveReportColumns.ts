/**
 * 直播日报（飞书多维表格）列定义。
 * 配置驱动：视觉识别与 Excel 导出都以 `label` 为准，不硬编码。
 */

export type ColumnUnit = 'none' | 'wan' | 'hour' | 'percent' | 'text'

export interface LiveReportColumn {
  /** 稳定内部键（用于映射到飞书列 / 内部存储） */
  key: string
  /** 飞书表列头（视觉识别提示词与导出表头都使用此名） */
  label: string
  /** 单位换算提示，决定导出前如何把识别到的原文转成数值 */
  unit: ColumnUnit
  /** 来源：manual=需人工填写；vision=从截图识别；skip=留空不填；computed=由其它列计算得出 */
  source: 'manual' | 'vision' | 'skip' | 'computed'
  /** UI 分组 */
  group: string
}

export const LIVE_REPORT_COLUMNS: LiveReportColumn[] = [
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
  { key: 'exposeViewRate', label: '曝光观看率（次数）', unit: 'none', source: 'vision', group: '流量' },
  { key: 'viewInteractRate', label: '观看互动率（人数）', unit: 'none', source: 'vision', group: '流量' },
  { key: 'peakOnline', label: '最高在线人数', unit: 'none', source: 'vision', group: '流量' },
  { key: 'avgOnline', label: '平均在线人数', unit: 'none', source: 'vision', group: '流量' },
  { key: 'fansRatio', label: '粉丝占比', unit: 'percent', source: 'vision', group: '流量' },
  { key: 'newFans', label: '新增粉丝数', unit: 'none', source: 'vision', group: '流量' },
  { key: 'fanConvertRate', label: '转粉率', unit: 'percent', source: 'vision', group: '流量' },
  { key: 'fansGroupNew', label: '粉丝团新增人数', unit: 'none', source: 'vision', group: '流量' },
  { key: 'joinGroupRate', label: '加团率', unit: 'percent', source: 'computed', group: '流量' },
  { key: 'comments', label: '评论数', unit: 'none', source: 'vision', group: '流量' },
  { key: 'avgCommentsPerMin', label: '平均评论次数(分)', unit: 'none', source: 'computed', group: '流量' },
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
  { key: 'peerMedianExposeTimes', label: '同层中位数曝光次数', unit: 'none', source: 'vision', group: '成交' },
  { key: 'peerMedianExposeViewRate', label: '同层中位数曝光观看率', unit: 'percent', source: 'vision', group: '成交' },
  { key: 'peerMedianThousand', label: '同层中位千次', unit: 'none', source: 'vision', group: '成交' },
  { key: 'payGmv', label: '支付GMV', unit: 'none', source: 'vision', group: '成交' },
  { key: 'gpm', label: 'GPM', unit: 'none', source: 'vision', group: '成交' },
  { key: 'payUsers', label: '成交人数', unit: 'none', source: 'vision', group: '成交' },
  { key: 'uvValue', label: 'UV价值', unit: 'none', source: 'computed', group: '成交' },
  { key: 'investAmount', label: '投放金额', unit: 'none', source: 'vision', group: '成交' },
  { key: 'roi', label: '整场ROI', unit: 'none', source: 'computed', group: '成交' },
  { key: 'videoDealRatio', label: '视频成交占比', unit: 'percent', source: 'vision', group: '成交' },
  { key: 'refundAmount', label: '下播退货金额', unit: 'none', source: 'vision', group: '成交' },
  { key: 'preShipRefundRate', label: '发货前退款率', unit: 'percent', source: 'vision', group: '成交' },

  // 商品 / 人群
  { key: 'mainProduct', label: '主品', unit: 'text', source: 'manual', group: '商品人群' },
  { key: 'productExposeClick', label: '商品曝光点击', unit: 'none', source: 'vision', group: '商品人群' },
  { key: 'productClickDeal', label: '商品点击成交', unit: 'none', source: 'vision', group: '商品人群' },
  { key: 'clothingColor', label: '服装颜色', unit: 'text', source: 'manual', group: '商品人群' },
  { key: 'age50PlusRatio', label: '50+占比（观看）', unit: 'percent', source: 'vision', group: '商品人群' },
  { key: 'maleFansRatio', label: '男粉占比（观看）', unit: 'percent', source: 'vision', group: '商品人群' },
  { key: 'viewCoreCity', label: '观看核心城市', unit: 'text', source: 'vision', group: '商品人群' },
  { key: 'dealCoreCity', label: '成交核心城市', unit: 'text', source: 'vision', group: '商品人群' },
]

/** 非抖音字段（需人工填写，视觉识别不应覆盖） */
export const MANUAL_COLUMN_KEYS = LIVE_REPORT_COLUMNS.filter(c => c.source === 'manual').map(
  c => c.key,
)

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
    // 支持 "H:MM:SS" / "X时X分X秒" / 纯数字
    const hms = text.match(/(\d+):(\d+):(\d+)/)
    if (hms) {
      const [, h, m, s] = hms
      return String(+(Number(h) + Number(m) / 60 + Number(s) / 3600).toFixed(4))
    }
    const hm = text.match(/(\d+)\s*时\s*(\d+)\s*分/)
    if (hm) {
      const [, h, m] = hm
      return String(+(Number(h) + Number(m) / 60).toFixed(4))
    }
    const num = Number.parseFloat(text.replace(/[^\d.]/g, ''))
    return Number.isNaN(num) ? text : String(num)
  }
  if (column.unit === 'percent') {
    const num = Number.parseFloat(text.replace(/[^\d.]/g, ''))
    return Number.isNaN(num) ? text : String(num)
  }
  // none：保留原文（通常为数字）
  return text
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
  const durationH = toNumber(raw['durationHour'] ?? '')
  const fansGroup = actualCount(raw, 'fansGroupNew', columns)

  if (gmv !== null && invest !== null && invest !== 0) {
    out['roi'] = String(+(gmv / invest).toFixed(4))
  }
  if (comments !== null && durationH !== null && durationH > 0) {
    out['avgCommentsPerMin'] = String(+(comments / (durationH * 60)).toFixed(4))
  }
  if (gmv !== null && viewers !== null && viewers !== 0) {
    out['uvValue'] = String(+(gmv / viewers).toFixed(4))
  }
  if (fansGroup !== null && viewers !== null && viewers !== 0) {
    out['joinGroupRate'] = String(+(fansGroup / viewers * 100).toFixed(2))
  }
  return out
}

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
