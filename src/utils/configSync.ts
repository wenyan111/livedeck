import type { LedgerRecord } from 'shared/dataEntryLedger'
import type { DataEntrySavedState } from 'shared/dataEntryState'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import type { LiveReportColumn } from 'shared/liveReportColumns'
import { useAccounts } from '@/hooks/useAccounts'
import { useLiveControlStore } from '@/hooks/useLiveControl'
import { useOpenPriceLinkageStore } from '@/hooks/useOpenPriceLinkage'

/**
 * 账号配置导出 / 导入（换电脑时带走配置）。
 *
 * 背景：配置都放在 localStorage（zustand persist），而且**几乎全部以 accountId
 * （本地随机 uuid）为 key**。换一台机器 accountId 会重新生成，所以导入时不能直接用
 * 旧 id ——必须用「平台 + 账号名」这个业务身份做映射，再把旧 id 重写成新 id。
 *
 * 设计取舍：
 * - **不导出登录态**（平台 cookie）。跨机器复制 cookie 有风控风险，且等于交出账号；
 *   新机器重新扫码即可。
 * - **不导出 accounts-storage**。账号列表属于「这台机器上有哪些账号」，
 *   导入会覆盖本地 id，反而破坏映射。
 * - 导出文件是明文 JSON，含 AI 的 API Key，所以界面上要提示用户妥善保管。
 */

/** 按账号分片的业务配置（key 是 accountId，导入时需要重映射） */
const PER_ACCOUNT_KEYS = [
  'auto-reply',
  'open-price-script-storage',
  'auto-popup-storage',
  'auto-message-storage',
  'open-price-linkage-storage',
  'quick-start-storage',
  'live-control-storage',
] as const

/**
 * 全局配置（不按账号分）。
 * 只带 AI 配置：浏览器路径（chrome-config）是机器相关的，带过去反而可能失效。
 */
const GLOBAL_KEYS = ['ai-chat-storage'] as const

const ALL_KEYS = [...PER_ACCOUNT_KEYS, ...GLOBAL_KEYS] as const

const FORMAT = 'livedeck-config'
const FORMAT_VERSION = 1

/** 「填写规则」的 localStorage key（与 DataEntry 页面一致） */
const NOTES_KEY = 'data-entry-section-notes'
/** 板块列表 / 自定义板块名：列配置和填写规则都按板块 key 存，缺了这两个迁移过去就是孤儿 */
const SECTIONS_KEY = 'data-entry-sections'
const SECTION_NAMES_KEY = 'data-entry-section-names'

type Persisted = { state?: Record<string, unknown>; version?: number } & Record<string, unknown>

export type ExportedAccount = {
  /** 导出机器上的 accountId（随机 uuid） */
  localId: string
  name: string
  platform: LiveControlPlatform | null
}

export type ConfigPayload = {
  format: typeof FORMAT
  version: number
  exportedAt: string
  /** 被跳过的空壳账号（名字为空 / 名字是 uuid），只是提示用 */
  skippedShellAccounts?: number
  accounts: ExportedAccount[]
  stores: Record<string, Persisted>
  dataEntry: {
    columns?: unknown
    rows?: unknown
    /** 「填写规则」：{ 板块 key: string[] }，裸 JSON，不走 persist 结构 */
    notes?: unknown
    /** 板块 key 列表 */
    sections?: unknown
    /** 板块 key → 自定义名称 */
    sectionNames?: unknown
    /** 日报总表已汇总的记录（按 id 合并） */
    ledger?: unknown
  }
}

export type ImportResult = {
  ok: boolean
  message: string
  /** 本机已有同名账号，直接对上 */
  matched: string[]
  /** 本机没有，已按导出信息**新建**账号（未连接） */
  created: string[]
  /** 连平台都不知道，没法建，只能跳过 */
  unmatched: string[]
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function readStore(key: string): Persisted | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Persisted) : null
  } catch {
    return null
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 是不是「空壳账号」：名字为空、或者名字本身就是一串 uuid。
 *
 * 这类账号是历史遗留（早期有流程用 id 当名字建账号），没有任何真实配置，
 * 导出时带过去只会在新机器上多出几条看不懂的条目（实测：导入后冒出
 * 「抖音小店 · 7e413243-1c31-4989-…」这种）。所以导出时直接跳过。
 */
function isShellAccount(name: string | undefined): boolean {
  const n = (name ?? '').trim()
  return n.length === 0 || UUID_RE.test(n)
}

/** 递归删掉指定 accountId 对应的属性（和 remapAccountKeys 同一套结构假设） */
function dropAccountKeys<T>(value: T, dropped: Set<string>): T {
  if (Array.isArray(value)) {
    return value.map(v => dropAccountKeys(v, dropped)) as unknown as T
  }
  if (!isPlainObject(value)) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    if (dropped.has(k)) continue
    out[k] = dropAccountKeys(v, dropped)
  }
  return out as unknown as T
}

/**
 * 清理本机的空壳账号（名字为空 / 名字是 uuid）。
 *
 * 导入过一版旧文件后，新机器上可能已经长出了几条「抖音小店 · 7e413243-…」这种条目，
 * 导出过滤只能防以后，清不掉已经存在的，所以给一个一键清理入口。
 * 至少保留一个账号（和 removeAccount 的约束一致）。
 */
export function cleanupShellAccounts(): { removed: number; orphans: number } {
  const shells = useAccounts.getState().accounts.filter(a => isShellAccount(a.name))
  let removed = 0
  for (const acc of shells) {
    if (useAccounts.getState().accounts.length <= 1) break
    useAccounts.getState().removeAccount(acc.id)
    removed++
  }
  // 账号删完再扫一遍：把历史上就没清干净的孤儿 context 一并清掉
  const orphans = pruneOrphanData()
  return { removed, orphans }
}

/** 像 accountId 的 key：'default' 或 uuid（store 里其它 key 都是有语义的名字） */
const ACCOUNT_KEY_RE = /^(default|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

/**
 * 清掉各 store 里指向「已不存在的账号」的残留（孤儿 context）。
 *
 * 账号删除时各 store 会通过 ACCOUNT_REMOVED 清自己的 context，但**历史遗留**的
 * （账号早就没了、context 还在）没人处理。这些残留会让界面在「跟随平台」等地方
 * 兜底显示成 `抖音小店 · default` / `抖音小店 · 7e413243-…`。
 *
 * @returns 清掉的条目数
 */
export function pruneOrphanData(): number {
  const valid = new Set(useAccounts.getState().accounts.map(a => a.id))
  let removed = 0

  for (const key of PER_ACCOUNT_KEYS) {
    const store = readStore(key)
    if (!store?.state) continue
    let hit = 0
    const walk = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(walk)
      if (!isPlainObject(v)) return v
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v)) {
        if (ACCOUNT_KEY_RE.test(k) && !valid.has(k)) {
          hit++
          continue
        }
        out[k] = walk(val)
      }
      return out
    }
    const next = walk(store.state) as Record<string, unknown>
    if (hit > 0) {
      localStorage.setItem(key, JSON.stringify({ ...store, state: next }))
      removed += hit
    }
  }

  // 联动 store 的 targets 是数组（{accountId}），key 不是 accountId，所以单独清
  try {
    useOpenPriceLinkageStore.getState().pruneOrphans()
  } catch {
    // store 还没初始化就算了
  }
  return removed
}

/** 当前这台机器上「平台 + 账号名」→ 本地 accountId */
function localIdentityMap(): Map<string, string> {
  const contexts = useLiveControlStore.getState().contexts
  const map = new Map<string, string>()
  for (const acc of useAccounts.getState().accounts) {
    const platform = contexts[acc.id]?.platform
    if (platform) map.set(`${platform}::${acc.name}`, acc.id)
  }
  return map
}

/** 收集本机配置，组装成导出用的 payload */
export async function collectConfig(): Promise<ConfigPayload> {
  const contexts = useLiveControlStore.getState().contexts
  const all = useAccounts.getState().accounts
  const accounts: ExportedAccount[] = all
    .filter(acc => !isShellAccount(acc.name))
    .map(acc => ({
      localId: acc.id,
      name: acc.name,
      platform: contexts[acc.id]?.platform ?? null,
    }))

  // 空壳账号在各大 store 里还留着 empty 的 context，一并剔掉，避免新机器上重新长出孤儿数据
  const dropped = new Set(all.filter(acc => isShellAccount(acc.name)).map(acc => acc.id))

  const stores: Record<string, Persisted> = {}
  for (const key of ALL_KEYS) {
    const value = readStore(key)
    if (!value) continue
    const pruned =
      dropped.size > 0 && value.state
        ? { ...value, state: dropAccountKeys(value.state, dropped) }
        : value
    stores[key] = pruned
  }

  // 直播日报的列配置 / 录入状态存在主进程的 json 里，一起带走
  let columns: unknown
  let rows: unknown
  try {
    columns = await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.getColumns)
    rows = await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.getRows)
  } catch {
    // 取不到就算了，不影响其它配置
  }

  // 「填写规则」是裸 JSON（不是 zustand persist 结构，没有 state 包一层），单独取
  let notes: unknown
  try {
    const raw = localStorage.getItem(NOTES_KEY)
    notes = raw ? JSON.parse(raw) : undefined
  } catch {
    notes = undefined
  }

  // 板块列表 / 名称 + 日报总表记录：不加这些，按板块存的列配置和填写规则到了新机器会找不到板块
  let sections: unknown
  let sectionNames: unknown
  try {
    const rawSections = localStorage.getItem(SECTIONS_KEY)
    sections = rawSections ? JSON.parse(rawSections) : undefined
    const rawNames = localStorage.getItem(SECTION_NAMES_KEY)
    sectionNames = rawNames ? JSON.parse(rawNames) : undefined
  } catch {
    // 读不到就算了
  }
  let ledger: unknown
  try {
    ledger = await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.getLedger)
  } catch {
    // 取不到就算了
  }

  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    skippedShellAccounts: all.length - accounts.length,
    accounts,
    stores,
    dataEntry: { columns, rows, notes, sections, sectionNames, ledger },
  }
}

/**
 * 把对象里所有「等于旧 accountId 的 key」递归替换成新 accountId。
 *
 * 之所以能这么写：所有 store 都是 `Record<accountId, ...>` 的嵌套结构，
 * 而 uuid 碰撞概率可忽略，所以不需要为每个 store 单独写映射逻辑。
 */
function remapAccountKeys<T>(value: T, idMap: Map<string, string>): T {
  if (Array.isArray(value)) {
    return value.map(v => remapAccountKeys(v, idMap)) as unknown as T
  }
  if (!isPlainObject(value)) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    const mappedKey = idMap.get(k) ?? k
    out[mappedKey] = remapAccountKeys(v, idMap)
  }
  return out as unknown as T
}

/** 合并两层的 state：同名字段里，对象做浅合并（保留本地其它账号），其余以导入为准 */
function mergeState(
  local: Record<string, unknown> | undefined,
  imported: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(local ?? {}) }
  for (const [k, v] of Object.entries(imported)) {
    const prev = out[k]
    out[k] = isPlainObject(prev) && isPlainObject(v) ? { ...prev, ...v } : v
  }
  return out
}

/**
 * 导入配置。
 *
 * @returns 匹配上的账号、没匹配上的账号，以及给用户看的结论。
 */
export async function applyConfig(payload: unknown): Promise<ImportResult> {
  if (!isPlainObject(payload) || payload.format !== FORMAT) {
    return {
      ok: false,
      message: '不是本应用导出的配置文件（缺少 format 标记）。',
      matched: [],
      created: [],
      unmatched: [],
    }
  }

  const data = payload as unknown as ConfigPayload
  if (!Array.isArray(data.accounts) || !isPlainObject(data.stores)) {
    return {
      ok: false,
      message: '配置文件结构异常，已中止导入。',
      matched: [],
      created: [],
      unmatched: [],
    }
  }

  // ① 用「平台 + 名字」把旧 id 映射到本机 id；
  //    本机没有这个账号就**直接建出来**（2026-10-31 按用户要求）——
  //    账号只是本机的一条记录（uuid + 名字 + 平台），「登录」是连接平台那一步，
  //    所以不需要先登录再导入：建好账号挂上配置，状态是未连接，之后点连接扫码即可。
  const local = localIdentityMap()
  const idMap = new Map<string, string>()
  const matched: string[] = []
  const created: string[] = []
  const unmatched: string[] = []
  for (const acc of data.accounts) {
    const hit = acc.platform ? local.get(`${acc.platform}::${acc.name}`) : undefined
    if (hit) {
      idMap.set(acc.localId, hit)
      matched.push(acc.name)
      continue
    }
    if (!acc.platform) {
      // 导出时这台机器就没记下平台，没法建
      unmatched.push(acc.name)
      continue
    }
    const before = new Set(useAccounts.getState().accounts.map(a => a.id))
    useAccounts.getState().addAccount(acc.name)
    const added = useAccounts.getState().accounts.find(a => !before.has(a.id))
    if (!added) {
      unmatched.push(acc.name)
      continue
    }
    useLiveControlStore.getState().setPlatform(added.id, acc.platform)
    idMap.set(acc.localId, added.id)
    created.push(acc.name)
  }

  // ② 逐项写入 localStorage（重写 id + 与本地合并）
  let applied = 0
  for (const key of ALL_KEYS) {
    const incoming = data.stores[key]
    if (!incoming) continue
    const localStore = readStore(key)
    const remapped = remapAccountKeys(incoming.state ?? {}, idMap)

    // 「连接状态」是机器相关的，导入后一律置为未连接，避免界面假装已连接
    if (key === 'live-control-storage' && isPlainObject(remapped.contexts)) {
      for (const ctx of Object.values(remapped.contexts)) {
        if (isPlainObject(ctx)) ctx.isConnected = 'disconnected'
      }
    }

    const merged: Persisted = {
      ...incoming,
      state: mergeState(localStore?.state, remapped),
    }
    localStorage.setItem(key, JSON.stringify(merged))
    applied++
  }

  // ③ 直播日报的列配置 / 录入状态
  if (isPlainObject(data.dataEntry)) {
    try {
      if (data.dataEntry.columns) {
        await window.ipcRenderer.invoke(
          IPC_CHANNELS.dataEntry.saveColumns,
          data.dataEntry.columns as LiveReportColumn[],
        )
      }
      if (data.dataEntry.rows) {
        await window.ipcRenderer.invoke(
          IPC_CHANNELS.dataEntry.saveRows,
          data.dataEntry.rows as DataEntrySavedState,
        )
      }
      if (data.dataEntry.columns || data.dataEntry.rows) applied++
    } catch {
      // 日报这块失败不影响其它配置
    }

    // 「填写规则」：按板块合并，同一条只留一份，绝不覆盖本机已经写好的规则
    if (isPlainObject(data.dataEntry.notes)) {
      const readLocal = (): Record<string, string[]> => {
        try {
          const raw = localStorage.getItem(NOTES_KEY)
          const parsed = raw ? JSON.parse(raw) : null
          if (!isPlainObject(parsed)) return {}
          const out: Record<string, string[]> = {}
          for (const [key, value] of Object.entries(parsed)) {
            if (Array.isArray(value)) {
              out[key] = value.filter((v): v is string => typeof v === 'string')
            }
          }
          return out
        } catch {
          return {}
        }
      }
      const merged = readLocal()
      for (const [key, value] of Object.entries(data.dataEntry.notes)) {
        if (!Array.isArray(value)) continue
        let list = merged[key]
        if (!list) {
          list = []
          merged[key] = list
        }
        for (const item of value) {
          if (typeof item === 'string' && item.trim() && !list.includes(item)) list.push(item)
        }
      }
      try {
        localStorage.setItem(NOTES_KEY, JSON.stringify(merged))
        applied++
      } catch {
        // 存不进去不影响其它配置
      }
    }

    // 板块列表：取并集，绝不删本机已有板块
    if (Array.isArray(data.dataEntry.sections)) {
      try {
        const incoming = (data.dataEntry.sections as unknown[]).filter(
          (x): x is string => typeof x === 'string' && x.trim() !== '',
        )
        const local = JSON.parse(localStorage.getItem(SECTIONS_KEY) || '[]')
        const mergedSections = Array.from(
          new Set([...(Array.isArray(local) ? local : []), ...incoming]),
        )
        localStorage.setItem(SECTIONS_KEY, JSON.stringify(mergedSections))
        applied++
      } catch {
        // 忽略
      }
    }
    // 板块名：本机已有的保留，只补本机没有的 key
    if (isPlainObject(data.dataEntry.sectionNames)) {
      try {
        const local = JSON.parse(localStorage.getItem(SECTION_NAMES_KEY) || '{}')
        const mergedNames: Record<string, string> = isPlainObject(local)
          ? { ...(local as Record<string, string>) }
          : {}
        for (const [key, value] of Object.entries(data.dataEntry.sectionNames)) {
          if (typeof value === 'string' && value.trim() && !(key in mergedNames)) {
            mergedNames[key] = value
          }
        }
        localStorage.setItem(SECTION_NAMES_KEY, JSON.stringify(mergedNames))
        applied++
      } catch {
        // 忽略
      }
    }
    // 日报总表：按 id 合并，本机记录优先，不覆盖
    if (Array.isArray(data.dataEntry.ledger) && data.dataEntry.ledger.length > 0) {
      try {
        const local = await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.getLedger)
        const byId = new Map<string, LedgerRecord>()
        for (const r of Array.isArray(local) ? (local as LedgerRecord[]) : []) {
          if (r?.id) byId.set(r.id, r)
        }
        for (const r of data.dataEntry.ledger as LedgerRecord[]) {
          if (r?.id && !byId.has(r.id)) byId.set(r.id, r)
        }
        await window.ipcRenderer.invoke(IPC_CHANNELS.dataEntry.saveLedger, [...byId.values()])
        applied++
      } catch {
        // 忽略
      }
    }
  }

  if (applied === 0 && matched.length === 0) {
    return {
      ok: false,
      message: '配置里没有任何可导入的内容，且账号都没对上。',
      matched,
      created,
      unmatched,
    }
  }

  const parts: string[] = []
  if (matched.length > 0) parts.push(`沿用本机已有账号 ${matched.length} 个`)
  if (created.length > 0) parts.push(`新建账号 ${created.length} 个（未连接，需点连接登录）`)
  if (unmatched.length > 0) parts.push(`跳过 ${unmatched.length} 个（缺平台信息）`)
  return {
    ok: applied > 0,
    message:
      applied > 0 ? `导入完成：${parts.join('，')}。` : `没有可导入的内容：${parts.join('，')}。`,
    matched,
    created,
    unmatched,
  }
}
