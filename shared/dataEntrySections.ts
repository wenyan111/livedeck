/**
 * 「直播日报 → 录入」页的板块列表与板块自定义名称。
 *
 * 这两项以前只存在渲染进程的 localStorage 里，强退 / 自动更新 / 覆盖安装都可能回退，
 * 用户反复遇到「板块被删了」「抖音又被改回抖音小店」（2026-11-07 第二次事故）。
 * 现在改成和行数据、字段一样落到主进程 userData 的 JSON 文件里，
 * localStorage 只作为镜像保留（配置迁移还在读它）。
 */
export interface DataEntrySectionsState {
  /** 板块 key 列表，顺序即页面上的显示顺序 */
  sections: string[]
  /** 板块 key → 显示名；没改过名的板块不在里面 */
  names: Record<string, string>
}

export const EMPTY_SECTIONS_STATE: DataEntrySectionsState = { sections: [], names: {} }

/** 只保留非空字符串 key，去重且保持原顺序 */
export function normalizeSectionKeys(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of input) {
    if (typeof item !== 'string') continue
    const key = item.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

/** 名称只收「字符串 → 非空字符串」，空名字视为未改名 */
export function normalizeSectionNames(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value !== 'string') continue
    const name = value.trim()
    if (!name) continue
    out[key] = name
  }
  return out
}

export function normalizeSectionsState(
  input: Partial<DataEntrySectionsState> | null,
): DataEntrySectionsState {
  return {
    sections: normalizeSectionKeys(input?.sections),
    names: normalizeSectionNames(input?.names),
  }
}

/**
 * 合并两份板块配置：列表取并集（绝不删板块），名称以 base 为准、incoming 只补空缺。
 * 用途：主进程存档 + localStorage 镜像对齐、以及配置迁移导入。
 */
export function mergeSectionsState(
  base: DataEntrySectionsState,
  incoming: DataEntrySectionsState,
): DataEntrySectionsState {
  const names: Record<string, string> = { ...incoming.names }
  for (const [key, value] of Object.entries(base.names)) {
    if (value) names[key] = value
  }
  return {
    sections: Array.from(new Set([...base.sections, ...incoming.sections])),
    names,
  }
}
