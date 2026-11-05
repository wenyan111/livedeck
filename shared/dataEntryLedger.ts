import type { LiveReportColumn } from './liveReportColumns'

/**
 * 直播日报「总表」的一条记录。
 *
 * 背景（用户 2026-11-05 需求）：每个板块各自导出、导完还要手工拼，
 * 希望所有数据自动进同一张表，不用反复导出。
 *
 * 所以这里单独维护一本账：不管哪个板块、哪一天，写进去都是一条记录，
 * 页面上一个总表视图就能看全，导出也是一次导出整张表。
 */
export interface LedgerRecord {
  id: string
  /** 板块 key（板块改名不影响归档） */
  sectionKey: string
  /** 归档当时的板块名，便于在总表里辨认 */
  sectionName: string
  /** 归属平台（决定该用哪套字段解释 values） */
  platform: LiveControlPlatform
  /** 该行所有字段的值（key → 值） */
  values: Record<string, string>
  createdAt: number
  updatedAt: number
}

/**
 * 去重键：**日期 + 板块 + 场次**（用户 2026-11-05 确认的规则）。
 * 同一场重复识别只会更新这一行，不会堆出一堆重复数据。
 */
export function ledgerKeyOf(sectionKey: string, values: Record<string, string>): string {
  const date = (values.date ?? '').trim()
  const session = (values.session ?? '').trim() || '未填场次'
  return `${sectionKey}|${date}|${session}`
}

/**
 * 生成一条总表记录的唯一 id。
 *
 * 事故（2026-11-05，用户报「改一行两行一起变」）：
 * 原来直接借用录入页那一行的 id，可一旦这行的日期/场次改过，
 * 会同时存在「旧 key 的记录」和「新 key 的记录」，两者 id 相同 →
 * 按 id 改单元格时两行一起变。所以 id 必须独立生成，绝不复用行 id。
 */
export function newLedgerId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 这一行是否值得归档（全是空行就不进总表） */
export function hasAnyValue(values: Record<string, string>): boolean {
  return Object.values(values).some(v => (v ?? '').trim() !== '')
}

/**
 * 把新记录并进已有总表：
 * 同 key（日期+板块+场次）→ 覆盖字段值、刷新时间，保留最初创建时间和同一 id；
 * 新 key → 追加。
 */
export function mergeLedgerRecords(
  existing: LedgerRecord[],
  incoming: LedgerRecord[],
): LedgerRecord[] {
  const byKey = new Map<string, LedgerRecord>()
  for (const r of existing) byKey.set(ledgerKeyOf(r.sectionKey, r.values), r)

  for (const rec of incoming) {
    const key = ledgerKeyOf(rec.sectionKey, rec.values)
    const old = byKey.get(key)
    if (old) {
      byKey.set(key, {
        ...old,
        sectionName: rec.sectionName,
        platform: rec.platform,
        // 新识别到的值覆盖旧的；旧的里有的而这次没读到的保留（避免一次识别不全把已有数据清空）
        values: { ...old.values, ...stripEmpty(rec.values) },
        updatedAt: rec.updatedAt,
      })
    } else {
      byKey.set(key, rec)
    }
  }
  return [...byKey.values()]
}

/** 去掉空值，避免"这次没读到"把已有数据覆盖成空 */
function stripEmpty(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(values)) {
    if ((v ?? '').trim() !== '') out[k] = v
  }
  return out
}

/**
 * 总表表头 = 各板块字段的并集。
 * 同 key 只出现一次（标签取第一次见到的），顺序按板块顺序拼接，
 * 这样抖音那套字段在前，后面板块新增的自定义字段依次追加。
 */
export function buildLedgerColumns(columns: LiveReportColumn[]): LiveReportColumn[] {
  const seen = new Set<string>()
  const out: LiveReportColumn[] = []
  for (const c of columns) {
    if (seen.has(c.key)) continue
    seen.add(c.key)
    out.push(c)
  }
  return out
}
