/**
 * 直播日报（罗盘导出 → 飞书）列模型 + 解析映射。
 *
 * 本文件是「罗盘导出 xlsx → 飞书多维表格」这条数据链路的**唯一口径真源**，
 * 移植自 live-data-autofill 分享包（2026-10-16 v2），但重写为纯 TS、去掉 Python/lark-cli/Chrome 依赖。
 *
 * 设计原则（对应分享包的红线 / 铁律）：
 * - 列模型配置驱动，不硬编码。飞书列头差异（下午「直播推荐」/ 晚场「直播推荐流量占比」）用 aliases 兜底。
 * - 口径定案写死在注释里：GPM 分母=观看**次数**、UV价值 分母=观看**人数**、商品率=指标卡值（红线7，已推翻主品口径）。
 * - source 三态：xlsx=可由导出直接得到；computed=由其他列算得；manual=中控人工填 / AI 永不自动填（老粉数量、人群画像、同层对标等）。
 *
 * 本文件不依赖 Electron，可被主进程与单元测试直接引用。
 */

export type ReportUnit = 'none' | 'wan' | 'hour' | 'percent' | 'text'

export type ReportSource = 'xlsx' | 'computed' | 'manual'

export interface ReportColumn {
  /** 稳定内部键 */
  key: string
  /** 飞书表列头（默认匹配名） */
  label: string
  /** 别名：用于匹配飞书真实列名（下午/晚场差异、用户自定义命名） */
  aliases?: string[]
  /** 单位 / 数值类型提示 */
  unit: ReportUnit
  /** 来源：xlsx=导出可得；computed=派生；manual=人工 */
  source: ReportSource
  /** UI 分组 */
  group: string
}

export const REPORT_COLUMNS: ReportColumn[] = [
  // ===== 基础信息 =====
  { key: 'weekLabel', label: '周标签', unit: 'text', source: 'computed', group: '基础信息' },
  { key: 'anchorName', label: '主播名称', unit: 'text', source: 'xlsx', group: '基础信息' },
  { key: 'date', label: '日期', unit: 'text', source: 'xlsx', group: '基础信息' },
  { key: 'session', label: '场次', unit: 'text', source: 'xlsx', group: '基础信息' },
  { key: 'time', label: '时间', unit: 'text', source: 'xlsx', group: '基础信息' },
  { key: 'mainProduct', label: '主品', unit: 'text', source: 'xlsx', group: '基础信息' },
  { key: 'durationHour', label: '直播时长（h）', unit: 'text', source: 'xlsx', group: '基础信息' },

  // ===== 规模与流量 =====
  { key: 'viewersWan', label: '观看人数（万）', unit: 'wan', source: 'xlsx', group: '规模流量' },
  {
    key: 'roomViewsWan',
    label: '直播间浏览量（w）',
    unit: 'wan',
    source: 'manual',
    group: '规模流量',
  },
  {
    key: 'exposeUsersWan',
    label: '曝光人数（万）',
    unit: 'wan',
    source: 'xlsx',
    group: '规模流量',
  },
  {
    key: 'exposeTimesWan',
    label: '曝光次数（万）',
    unit: 'wan',
    source: 'xlsx',
    group: '规模流量',
  },
  {
    key: 'exposeViewRate',
    label: '曝光观看率（次数）',
    unit: 'percent',
    source: 'computed',
    group: '规模流量',
  },
  { key: 'avgOnline', label: '平均在线人数', unit: 'none', source: 'xlsx', group: '规模流量' },
  { key: 'peakOnline', label: '最高在线人数', unit: 'none', source: 'xlsx', group: '规模流量' },
  {
    key: 'avgStayDuration',
    label: '平均停留时长',
    unit: 'text',
    source: 'xlsx',
    group: '规模流量',
  },
  { key: 'fansRatio', label: '粉丝占比', unit: 'percent', source: 'manual', group: '规模流量' },
  { key: 'newFans', label: '新增粉丝数', unit: 'none', source: 'xlsx', group: '规模流量' },
  {
    key: 'fanConvertRate',
    label: '转粉率',
    unit: 'percent',
    source: 'computed',
    group: '规模流量',
  },
  {
    key: 'fansGroupNew',
    label: '粉丝团新增人数',
    unit: 'none',
    source: 'manual',
    group: '规模流量',
  },
  { key: 'joinGroupRate', label: '加团率', unit: 'percent', source: 'computed', group: '规模流量' },
  { key: 'comments', label: '评论数', unit: 'none', source: 'manual', group: '规模流量' },
  {
    key: 'avgCommentsPerMin',
    label: '平均评论次数(分)',
    unit: 'none',
    source: 'computed',
    group: '规模流量',
  },
  { key: 'likesWan', label: '点赞量（万）', unit: 'wan', source: 'manual', group: '规模流量' },

  // ===== 成交与 GPM =====
  { key: 'payGmv', label: '支付GMV', unit: 'none', source: 'xlsx', group: '成交GPM' },
  { key: 'payUsers', label: '成交人数', unit: 'none', source: 'xlsx', group: '成交GPM' },
  {
    key: 'viewDealRate',
    label: '观看-成交率(人数)',
    unit: 'text',
    source: 'xlsx',
    group: '成交GPM',
  },
  { key: 'gpm', label: 'GPM', unit: 'none', source: 'xlsx', group: '成交GPM' },
  { key: 'uvValue', label: 'UV价值', unit: 'none', source: 'computed', group: '成交GPM' },
  {
    key: 'liveRecommendGpm',
    label: '直播GPM',
    aliases: ['直播推荐GPM', '直播推荐千次观看成交'],
    unit: 'none',
    source: 'computed',
    group: '成交GPM',
  },
  {
    key: 'videoRecommendGpm',
    label: '视频端GPM',
    aliases: ['视频推荐GPM', '短视频引流转化GPM'],
    unit: 'none',
    source: 'computed',
    group: '成交GPM',
  },
  {
    key: 'productExposeClickRate',
    label: '商品曝光点击率',
    unit: 'percent',
    source: 'xlsx',
    group: '成交GPM',
  },
  {
    key: 'productClickDealRate',
    label: '商品点击成交率',
    unit: 'percent',
    source: 'xlsx',
    group: '成交GPM',
  },

  // ===== 投放与 ROI =====
  { key: 'investAmount', label: '投放金额', unit: 'none', source: 'xlsx', group: '投放ROI' },
  { key: 'roi', label: '整场ROI', unit: 'none', source: 'computed', group: '投放ROI' },
  {
    key: 'payChannelRatio',
    label: '付费流量占比',
    unit: 'percent',
    source: 'computed',
    group: '投放ROI',
  },
  { key: 'targetRoi', label: '开播目标ROI', unit: 'none', source: 'manual', group: '投放ROI' },

  // ===== 视频与渠道占比 =====
  {
    key: 'videoDealRatio',
    label: '视频成交占比',
    unit: 'percent',
    source: 'computed',
    group: '渠道占比',
  },
  {
    key: 'liveRecommend',
    label: '直播推荐',
    aliases: ['直播推荐流量占比'],
    unit: 'percent',
    source: 'computed',
    group: '渠道占比',
  },
  {
    key: 'videoRecommend',
    label: '视频推荐',
    aliases: ['视频推荐流量占比'],
    unit: 'percent',
    source: 'computed',
    group: '渠道占比',
  },
  {
    key: 'searchRatio',
    label: '搜索流量占比',
    aliases: ['搜索'],
    unit: 'percent',
    source: 'computed',
    group: '渠道占比',
  },
  {
    key: 'followRatio',
    label: '关注流量占比',
    aliases: ['关注'],
    unit: 'percent',
    source: 'computed',
    group: '渠道占比',
  },
  {
    key: 'otherRatio',
    label: '其他流量占比',
    unit: 'percent',
    source: 'manual',
    group: '渠道占比',
  },

  // ===== 互动与粉丝 =====
  {
    key: 'viewInteractRate',
    label: '观看互动率（人数）',
    unit: 'percent',
    source: 'xlsx',
    group: '互动粉丝',
  },
  {
    key: 'refundAmount',
    label: '下播退货金额',
    aliases: ['退款金额'],
    unit: 'none',
    source: 'xlsx',
    group: '互动粉丝',
  },
  {
    key: 'preShipRefundRate',
    label: '发货前退款率',
    aliases: ['退款金额占比'],
    unit: 'percent',
    source: 'manual',
    group: '互动粉丝',
  },

  // ===== 同层对标（人工） =====
  {
    key: 'peerMedianThousand',
    label: '同层中位千次',
    unit: 'none',
    source: 'manual',
    group: '同层对标',
  },
  {
    key: 'peerMedianExposeTimes',
    label: '同层中位数曝光次数（万）',
    aliases: ['同层中位数曝光次数'],
    unit: 'wan',
    source: 'manual',
    group: '同层对标',
  },
  {
    key: 'peerMedianExposeViewRate',
    label: '同层中位数曝光观看率',
    unit: 'percent',
    source: 'manual',
    group: '同层对标',
  },

  // ===== 商品人群（人工） =====
  {
    key: 'productExposeCount',
    label: '商品曝光人数',
    unit: 'none',
    source: 'xlsx',
    group: '商品人群',
  },
  {
    key: 'productClickCount',
    label: '商品点击人数',
    unit: 'none',
    source: 'xlsx',
    group: '商品人群',
  },
  { key: 'clothingColor', label: '服装颜色', unit: 'text', source: 'manual', group: '商品人群' },
  {
    key: 'age50PlusRatio',
    label: '50+占比（观看）',
    unit: 'percent',
    source: 'manual',
    group: '商品人群',
  },
  {
    key: 'maleFansRatio',
    label: '男粉占比（观看）',
    unit: 'percent',
    source: 'manual',
    group: '商品人群',
  },
  { key: 'viewCoreCity', label: '观看核心城市', unit: 'text', source: 'manual', group: '商品人群' },
  { key: 'dealCoreCity', label: '成交核心城市', unit: 'text', source: 'manual', group: '商品人群' },
  { key: 'oldFans', label: '老粉数量', unit: 'none', source: 'manual', group: '商品人群' },
]

/** 人工列（AI 永不自动填，写入飞书时跳过） */
export const MANUAL_COLUMN_KEYS = REPORT_COLUMNS.filter(c => c.source === 'manual').map(c => c.key)

// ============ 数值解析（移植自分享包 N()，兼容 万/¥/逗号/百分号） ============
export function N(v: unknown): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return v
  const s = String(v).trim().replace(/,/g, '').replace(/¥/g, '').replace(/　/g, '')
  if (s === '' || s === '-' || s === '–' || s === '—') return 0
  if (s.endsWith('万')) {
    const n = Number.parseFloat(s.slice(0, -1))
    return Number.isNaN(n) ? 0 : n * 10000
  }
  const n = Number.parseFloat(s)
  return Number.isNaN(n) ? 0 : n
}

function rnd(x: number, p = 2): number {
  return Math.round(x * 10 ** p) / 10 ** p
}

function fmt(x: number | null, p = 4): string {
  if (x === null || !Number.isFinite(x)) return ''
  return String(rnd(x, p))
}

/** 把视觉/导出原文按列单位转成可写入的数值字符串 */
export function convertReportValue(column: ReportColumn, raw: string): string {
  const text = (raw ?? '').toString().trim()
  if (text === '') return ''
  if (column.unit === 'text') return text
  if (column.unit === 'percent') {
    const n = N(text)
    return String(n)
  }
  if (column.unit === 'wan') {
    const n = N(text)
    if (n >= 10000) return String(+(n / 10000).toFixed(4))
    return String(n)
  }
  if (column.unit === 'hour') {
    const m = text.match(/(\d+)\s*小时\s*(\d+)\s*分/)
    if (m) return String(+(Number(m[1]) + Number(m[2]) / 60).toFixed(4))
    const hms = text.match(/(\d+):(\d+):(\d+)/)
    if (hms)
      return String(+(Number(hms[1]) + Number(hms[2]) / 60 + Number(hms[3]) / 3600).toFixed(4))
    const n = N(text)
    return Number.isNaN(n) ? text : String(n)
  }
  return text
}

/**
 * 容错取值：罗盘导出表头偶发括号不全（如「直播间商品点击-成交转化率(人数」缺右括号）。
 * 先精确匹配，失败再按「去掉所有括号与空白后相等」兜底，避免取不到值。
 */
function lkup<T = unknown>(obj: Record<string, T>, key: string): T | undefined {
  if (obj == null) return undefined
  if (obj[key] !== undefined) return obj[key]
  const norm = (s: string) => s.replace(/[（）()]/g, '').replace(/\s+/g, '')
  const nk = norm(key)
  for (const k of Object.keys(obj)) {
    if (norm(k) === nk) return obj[k]
  }
  return undefined
}

// ============ 罗盘导出原始数据结构（解析器产出，buildReportFields 消费） ============
export interface RawLuopanData {
  base: Record<string, unknown> // 基本信息：表头 -> 第 2 行值
  funnel: Record<string, unknown> // 漏斗：表头 -> 第 2 行值
  inter: Record<string, unknown> // 互动人群售后：表头 -> 第 2 行值
  channels: Record<string, Record<string, unknown>> // 渠道分析：渠道名称 -> { 列名 -> 值 }
  goods: Array<{ name: string; gmv: number }> // 商品：按 GMV 降序
}

const WEEK_CN = '一二三四五六日'

/** 解析「直播时间」：格式 2026-10-10_20-54 或 2026-10-10_20-54-30~2026-10-11_00-43-10 */
function parseLiveTime(liveTime: string): {
  date: string
  startTime: string
  endTime: string | null
  hour: number
} {
  const s = (liveTime ?? '').trim()
  const rangeMatch = s.match(
    /(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})(?:-(\d{2}))?~(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})(?:-(\d{2}))?/,
  )
  if (rangeMatch) {
    const [, d, hh, mm] = rangeMatch
    const [, , eh, em] = rangeMatch.slice(5)
    return {
      date: d,
      startTime: `${hh}:${mm}`,
      endTime: `${eh}:${em}`,
      hour: Number(hh),
    }
  }
  const m = s.match(/(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})(?:-(\d{2}))?/)
  if (m) {
    return { date: m[1], startTime: `${m[2]}:${m[3]}`, endTime: null, hour: Number(m[2]) }
  }
  return { date: '', startTime: '', endTime: null, hour: 0 }
}

/** 场次判定：优先按直播间名称（示例直播间-晚场），否则按开播小时 */
export function judgeSession(liveName: string, hour: number): string {
  const n = (liveName ?? '').toString()
  if (n.includes('晚场') || n.includes('晚上')) return '晚场'
  if (n.includes('下午') || n.includes('午场')) return '下午场'
  if (n.includes('早场') || n.includes('早上')) return '早场'
  if (hour < 12) return '早场'
  if (hour < 17) return '下午场'
  if (hour < 20) return '午场'
  return '晚场'
}

function weekLabelOf(date: string): string {
  const m = date.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  // ⚠️ JS getDay(): 周日=0..周六=6；飞书口径按 Python weekday(): 周一=0..周日=6
  // 必须换算，否则会把「周六」算成「周日」。
  const wd = (d.getDay() + 6) % 7
  return '周' + WEEK_CN[wd]
}

/** 直播时长：'2小时49分钟' -> 小时数 */
function parseDuration(text: string): number | null {
  const m = (text ?? '').match(/(\d+)\s*小时\s*(\d+)\s*分钟/)
  if (m) return Number(m[1]) + Number(m[2]) / 60
  const m2 = (text ?? '').match(/(\d+)\s*分钟/)
  if (m2) return Number(m2[1]) / 60
  const m3 = (text ?? '').match(/(\d+):(\d+):(\d+)/)
  if (m3) return Number(m3[1]) + Number(m3[2]) / 60 + Number(m3[3]) / 3600
  return null
}

/**
 * 核心：罗盘导出原始数据 -> 飞书列值（仅产出 xlsx / computed 列，manual 列留空）。
 * 口径定案（与分享包 字段口径字典 / 红线 一致）：
 * - GPM 分母 = 观看**次数**（整体.观看次数）
 * - UV价值 分母 = 观看**人数**
 * - 商品率 = **指标卡值（整体口径）**：直播间商品曝光-点击率(人数) / 直播间商品点击-成交转化率(人数)
 * - 直播GPM = 推荐feed 成交金额 / 观看次数 * 1000；视频端GPM = 短视频引流 行同式
 */
export function buildReportFields(raw: RawLuopanData): Record<string, string> {
  const out: Record<string, string> = {}
  const base = raw.base
  const funnel = raw.funnel
  const inter = raw.inter
  const ch = raw.channels

  const gmv = N(lkup(base, '直播间成交金额'))
  const viewP = N(lkup(funnel, '直播间观看人数'))
  const expP = N(lkup(funnel, '直播间曝光人数'))
  const expC = N(lkup(funnel, '直播间曝光次数'))
  const totCnt = N(ch['整体']?.['观看次数'])
  const spend = N(ch['整体']?.['千川消耗'])
  const fans = N(lkup(inter, '新增粉丝数'))
  const paidCnt = N(lkup(funnel, '付费流量观看人数'))

  // ---- 基础信息 ----
  const liveTime = parseLiveTime(String(base['直播时间'] ?? ''))
  out['date'] = liveTime.date ? `${liveTime.date} 00:00:00` : ''
  out['time'] = liveTime.endTime ? `${liveTime.startTime}-${liveTime.endTime}` : liveTime.startTime
  out['session'] = judgeSession(String(base['直播间名称'] ?? ''), liveTime.hour)
  out['weekLabel'] = weekLabelOf(liveTime.date)
  out['anchorName'] = String(base['直播间名称'] ?? '')
    .replace(/[-－][下午晚场早场午场]+$/, '')
    .trim()
  const topGoods = raw.goods[0]
  out['mainProduct'] = topGoods ? topGoods.name : ''
  // 直播时长：罗盘原文「2小时49分钟」，分享包口径保留「2小时49分」文本，不转小数小时
  const rawDur = String(lkup(base, '直播时长') ?? '')
    .replace('分钟', '分')
    .trim()
  out['durationHour'] = rawDur

  // ---- 成交 / GPM（直读） ----
  out['payGmv'] = fmt(gmv, 2)
  out['payUsers'] = String(Math.round(N(lkup(funnel, '成交人数'))))
  out['gpm'] = fmt(N(lkup(base, '千次观看成交金额')), 2)
  // 观看-成交率(人数)：text 型且带百分号（口径陷阱3）
  const vd = N(lkup(funnel, '直播间观看-成交转化率(人数)'))
  out['viewDealRate'] = vd ? `${(vd * 100).toFixed(2)}%` : ''
  // 商品率：整体口径（红线7 已推翻主品口径），取漏斗整体指标卡值
  out['productExposeClickRate'] = fmt(N(lkup(funnel, '直播间商品曝光-点击率(人数)')), 6)
  out['productClickDealRate'] = fmt(N(lkup(funnel, '直播间商品点击-成交转化率(人数)')), 6)
  out['refundAmount'] = fmt(N(lkup(base, '退款金额')), 2)

  // ---- 规模与流量 ----
  out['viewersWan'] = fmt(viewP / 10000, 4)
  out['exposeUsersWan'] = fmt(expP / 10000, 4)
  out['exposeTimesWan'] = fmt(expC / 10000, 4)
  out['exposeViewRate'] = totCnt ? fmt(totCnt / expC, 6) : ''
  out['avgOnline'] = String(Math.round(N(lkup(funnel, '平均在线人数'))))
  out['peakOnline'] = String(Math.round(N(lkup(funnel, '最高在线人数'))))
  // 平均停留时长：罗盘给的是「21秒」原文，按分享包口径原样保留
  out['avgStayDuration'] = String(lkup(inter, '人均观看时长') ?? '')
  out['newFans'] = String(Math.round(fans))
  out['viewInteractRate'] = fmt(N(lkup(inter, '直播间观看-互动率(人数)')), 6)

  // ---- 投放与 ROI ----
  out['investAmount'] = fmt(spend, 2)
  out['roi'] = spend ? fmt(gmv / spend, 4) : ''
  out['payChannelRatio'] = viewP ? fmt(paidCnt / viewP, 6) : ''

  // ---- 视频与渠道占比（share = 渠道观看次数 / 整体观看次数） ----
  const share = (name: string) => (totCnt ? fmt(N(ch[name]?.['观看次数']) / totCnt, 6) : '')
  out['liveRecommend'] = share('推荐feed')
  out['searchRatio'] = share('搜索')
  out['followRatio'] = share('关注')
  out['videoRecommend'] = share('短视频引流')
  const spGmv = N(ch['短视频引流']?.['成交金额'])
  const spCnt = N(ch['短视频引流']?.['观看次数'])
  out['videoDealRatio'] = gmv ? fmt(spGmv / gmv, 6) : ''
  out['videoRecommendGpm'] = spCnt ? fmt((spGmv / spCnt) * 1000, 2) : ''
  const feedGmv = N(ch['推荐feed']?.['成交金额'])
  const feedCnt = N(ch['推荐feed']?.['观看次数'])
  out['liveRecommendGpm'] = feedCnt ? fmt((feedGmv / feedCnt) * 1000, 2) : ''

  // ---- 商品人数（计数） ----
  out['productExposeCount'] = String(Math.round(N(lkup(funnel, '商品曝光人数'))))
  out['productClickCount'] = String(Math.round(N(lkup(funnel, '商品点击人数'))))

  // ---- 派生（依赖基础列） ----
  out['uvValue'] = viewP ? fmt(gmv / viewP, 4) : ''
  out['fanConvertRate'] = viewP ? fmt(fans / viewP, 6) : ''
  // 加团率 / 平均评论次数：缺 粉丝团新增 / 评论数（导出无），留空等待人工或视觉补

  return out
}

/** 按目标表真实字段名解析我们的列键（对应分享包 field_alias：下午「直播推荐」/ 晚场「直播推荐流量占比」） */
export function resolveFeishuFieldName(targetFields: string[], col: ReportColumn): string | null {
  const candidates = [col.label, ...(col.aliases ?? [])]
  // 1) 精确匹配（最高优先）
  for (const c of candidates) {
    if (targetFields.includes(c)) return c
  }
  // 2) 兜底：目标列名以候选名开头（如「直播推荐」→「直播推荐流量占比」），取最短最具体
  //    注意：只用 target.startsWith(candidate)，绝不用 candidate.startsWith(target)，
  //    否则「直播推荐」会误匹配成「直播推荐GPM」。
  let best: string | null = null
  for (const c of candidates) {
    for (const f of targetFields) {
      if (f.startsWith(c) && (best === null || f.length < best.length)) best = f
    }
  }
  return best
}

// ============ 合理性校验（对应分享包 RULES，红线 P1 写飞书前复用） ============
export interface ValidationRule {
  key: string
  test: (v: number) => boolean
  msg: string
}

export const REPORT_VALIDATION_RULES: ValidationRule[] = [
  { key: 'payGmv', test: v => v >= 0, msg: 'GMV 不能为负' },
  { key: 'investAmount', test: v => v >= 0, msg: '投放不能为负' },
  { key: 'roi', test: v => v === 0 || (v > 0 && v < 200), msg: 'ROI 应在 0~200' },
  { key: 'uvValue', test: v => v === 0 || (v > 0 && v < 500), msg: 'UV价值应在 0~500' },
  { key: 'fanConvertRate', test: v => v >= 0 && v < 1, msg: '转粉率应在 0~1' },
  { key: 'viewersWan', test: v => v > 0 && v < 5000, msg: '观看人数异常' },
  { key: 'exposeViewRate', test: v => v === 0 || (v > 0 && v < 1), msg: '曝光观看率应在 0~1' },
  { key: 'payUsers', test: v => v >= 0, msg: '成交人数不能为负' },
]

/** 返回不通过的字段说明；空数组表示全部通过 */
export function validateReportFields(fields: Record<string, string>): string[] {
  const bad: string[] = []
  for (const r of REPORT_VALIDATION_RULES) {
    const raw = fields[r.key]
    if (raw === undefined || raw === '' || raw === null) continue
    const v = Number(raw)
    if (Number.isNaN(v)) continue
    if (!r.test(v)) bad.push(`${r.key}=${raw} → ${r.msg}`)
  }
  return bad
}
