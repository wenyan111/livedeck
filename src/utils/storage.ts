import { version as APP_VERSION } from '../../package.json'

/**
 * 存储版本信息的键名
 */
const STORAGE_VERSION_KEY = 'storage-version'

/**
 * 当前应用使用的所有 localStorage 键名
 * 用于账号删除时清理数据
 */
export const STORAGE_KEYS = {
  // 账号相关
  ACCOUNTS: 'accounts-storage',

  // 各功能模块配置（按账号存储 contexts）
  AUTO_MESSAGE: 'auto-message-storage',
  AUTO_REPLY: 'auto-reply',
  AUTO_POPUP: 'auto-popup-storage',
  LIVE_CONTROL: 'live-control-storage',
  CHROME_CONFIG: 'chrome-config',

  // 全局配置（不按账号存储）
  AI_CHAT: 'ai-chat-storage',
  UPDATE: 'update-storage',
  DEV_MODE: 'dev-mode-storage',
  STORAGE_VERSION: STORAGE_VERSION_KEY,
} as const

/**
 * 已废弃的 localStorage 键名（历史版本使用），用于版本迁移时清理旧数据。
 *
 * 🔴 这里必须**显式写死**，绝对不能用「白名单之外的所有 key」动态推导：
 * 以前写成 `getAllStorageKeys().filter(k => !Object.values(STORAGE_KEYS).includes(k))`，
 * 于是所有新功能加进来的 key（填写规则 `data-entry-section-notes`、快速开始、
 * 侧栏开关、输入框高度…）全被当成「废弃键」。每次版本号一变，
 * `main.tsx` 启动时的 `autoCleanupStorage()` 就把它们删光 ——
 * 2026-11-08 升级 1.3.3 时，用户 10 / 10 / 14 条填写规则就是这样没的。
 *
 * 目前没有需要清理的历史键，留空数组。以后确实要淘汰某个旧键，手动加进来即可；
 * 宁可留几个没用的 key，也不能误删用户配置。
 */
export const DEPRECATED_STORAGE_KEYS: string[] = []

/**
 * 按账号存储的 localStorage 键名列表
 */
const ACCOUNT_BASED_STORAGE_KEYS = [
  STORAGE_KEYS.AUTO_MESSAGE,
  STORAGE_KEYS.AUTO_REPLY,
  STORAGE_KEYS.AUTO_POPUP,
  STORAGE_KEYS.LIVE_CONTROL,
  STORAGE_KEYS.CHROME_CONFIG,
]

/**
 * 获取指定账号在指定存储键中的数据
 */
export function getAccountData<T>(storageKey: string, accountId: string): T | undefined {
  try {
    const data = localStorage.getItem(storageKey)
    if (!data) return undefined

    const parsed = JSON.parse(data)
    return parsed.state?.contexts?.[accountId] as T | undefined
  } catch {
    return undefined
  }
}

/**
 * 删除指定账号在指定存储键中的数据
 */
export function removeAccountData(storageKey: string, accountId: string): void {
  try {
    const data = localStorage.getItem(storageKey)
    if (!data) return

    const parsed = JSON.parse(data)
    if (parsed.state?.contexts?.[accountId]) {
      delete parsed.state.contexts[accountId]
      localStorage.setItem(storageKey, JSON.stringify(parsed))
    }
  } catch (error) {
    console.error(`Failed to remove account data for ${storageKey}:`, error)
  }
}

/**
 * 清理指定账号的所有 localStorage 数据
 * 包括所有按账号存储的配置
 */
export function clearAccountStorage(accountId: string): void {
  if (!accountId || accountId === 'default') return

  for (const key of ACCOUNT_BASED_STORAGE_KEYS) {
    removeAccountData(key, accountId)
  }
}

/**
 * 清理所有已废弃的 localStorage 键
 * 在版本迁移时调用
 * @returns 清理的废弃键数量
 */
export function clearDeprecatedStorage(): number {
  let count = 0
  for (const key of DEPRECATED_STORAGE_KEYS) {
    if (localStorage.getItem(key)) {
      localStorage.removeItem(key)
      count++
    }
  }
  return count
}

/**
 * 清理孤立的账号数据（账号已被删除但数据仍存在）
 * 在版本迁移或手动清理时调用
 * @returns 清理的孤立数据数量
 */
export function cleanupOrphanedAccountData(): number {
  const validAccountIds = new Set(getExistingAccountIds())
  let totalCount = 0

  for (const storageKey of ACCOUNT_BASED_STORAGE_KEYS) {
    try {
      const data = localStorage.getItem(storageKey)
      if (!data) continue

      const parsed = JSON.parse(data)
      const contexts = parsed.state?.contexts || {}
      const contextKeys = Object.keys(contexts)

      let hasChanges = false
      let count = 0
      for (const accountId of contextKeys) {
        // 跳过默认账号
        if (accountId === 'default') continue

        // 如果账号不存在于账号列表中，删除其数据
        if (!validAccountIds.has(accountId)) {
          delete contexts[accountId]
          count++
          hasChanges = true
        }
      }

      if (hasChanges) {
        localStorage.setItem(storageKey, JSON.stringify(parsed))
        totalCount += count
      }
    } catch (error) {
      console.error(`[Storage] Failed to cleanup orphaned data for ${storageKey}:`, error)
    }
  }
  return totalCount
}

/**
 * 执行完整的存储清理
 * 包括清理废弃键和孤立数据
 * @returns 清理的总数据量
 */
export function performFullCleanup(): number {
  // 清理废弃的存储键
  const deprecatedCount = clearDeprecatedStorage()
  // 清理孤立的账号数据
  const orphanedCount = cleanupOrphanedAccountData()
  // 更新存储版本
  localStorage.setItem(STORAGE_VERSION_KEY, APP_VERSION)
  const totalCount = deprecatedCount + orphanedCount
  return totalCount
}

/**
 * 获取账号列表
 */
function getExistingAccountIds(): string[] {
  try {
    const accountsData = localStorage.getItem(STORAGE_KEYS.ACCOUNTS)
    if (!accountsData) return []

    const parsed = JSON.parse(accountsData)
    const accounts = parsed.state?.accounts || []
    return accounts.map((acc: { id: string }) => acc.id)
  } catch {
    return []
  }
}

/**
 * 获取所有 localStorage 键名（用于调试）
 */
export function getAllStorageKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key) keys.push(key)
  }
  return keys
}

/**
 * 启动时只记录当前版本号，**绝不在启动时删除任何 localStorage 数据**。
 *
 * 以前这里会调 `performFullCleanup()`（清废弃键 + 清孤儿账号数据），
 * 结果版本号一变就误删新功能的配置（2026-11-08 事故）。
 * 清理这种不可逆操作只保留在设置页由用户手动点；
 * 启动阶段只读不写业务数据，符合「别做启动时迁移/兜底」的约定。
 */
export function autoCleanupStorage(): void {
  const storedVersion = localStorage.getItem(STORAGE_VERSION_KEY)
  if (storedVersion !== APP_VERSION) {
    localStorage.setItem(STORAGE_VERSION_KEY, APP_VERSION)
  }
}
