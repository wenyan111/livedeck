import type { Page } from 'playwright'
import type { IOpenPriceWatcher, IPlatform } from './IPlatform'

/**
 * 开价监听脚本的心跳与自愈。
 *
 * 背景（2026-09-19 线上事故）：监听脚本是一次性 `page.evaluate` 注入到中控台页面的
 * MutationObserver。只要页面发生重载 / 导航，脚本就**静默消失**——
 * 主进程的运行标记仍是 true，界面继续显示「运行中」，但点开价再也不会触发。
 *
 * 解决思路：
 * 1. 脚本内加心跳 `window.__openPriceWatcherAlive`，页面 JS 正常执行时会持续刷新；
 * 2. 主进程定期检查心跳，发现失效就重新注入（自愈）；
 * 3. 页面 `load` 事件（重载的可靠信号）直接触发重注，不用等下一次检查。
 */

/** 页面内心跳刷新间隔 */
const HEARTBEAT_INTERVAL_MS = 1000

/** 心跳超过这个时长没刷新 = 页面卡死或脚本已丢失 */
export const WATCHER_HEARTBEAT_TIMEOUT_MS = 90_000

/** 主进程读取心跳时的超时保护（页面卡死时 evaluate 会挂住） */
const EVALUATE_TIMEOUT_MS = 10_000

/** 健康检查周期 */
export const WATCHER_HEALTH_CHECK_INTERVAL_MS = 30_000

interface WatcherWindow {
  __openPriceWatcherSet?: boolean
  __openPriceWatcherAlive?: number
  __openPriceCleanup?: () => void
}

/**
 * 注入中控台页面的监听脚本：检测「开价」按钮变为「预热」的跳变瞬间并回调。
 * 用字符串注入，避免主进程编译期校验页面内 DOM 全局类型。
 *
 * 抖音小店 / 巨量百应术语一致（开价→预热），按文本匹配，通用且无需依赖具体 DOM 结构。
 * 采用「状态跳变」检测（lastState 存在闭包里，跨 DOM 节点重建存活）：
 *  - 记录每一帧按钮状态（open / preheat / both / none）；
 *  - **只有上一帧明确扫到了「开价」按钮**（open / both）、本帧才可能出现预热时触发；
 *  - `none`（页面上扫不到任何开价 / 预热按钮）不能当作「上一帧不是预热」。
 *    否则页面重载 / 刚注入时按钮还没渲染出来（none），下一帧直接渲染成「预热」
 *    （比如上一场还在预热中），就会被误判成开价动作、把全部话术白送一遍；
 *    虚拟列表滚动导致按钮短暂消失也是同理。
 *  - 持续预热期间的普通 DOM 变动不重复触发，需先回到非预热态再切回预热才会再触发。
 */
export const OPEN_PRICE_WATCHER_SCRIPT = `
(function () {
  // 防止多次启停叠加多个 MutationObserver
  if (window.__openPriceWatcherSet) {
    return
  }
  window.__openPriceWatcherSet = true

  var lastState = null // 上一次扫描到的状态：open/preheat/both/none/null(尚未初始化)
  var fire = function () {
    if (typeof window.__openPriceTrigger === 'function') {
      window.__openPriceTrigger()
    }
  }
  var scan = function () {
    var nodes = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"]'))
    var sawOpen = false
    var sawPreheat = false
    for (var i = 0; i < nodes.length; i++) {
      var text = (nodes[i].textContent || '').trim()
      if (text === '开价') sawOpen = true
      else if (text === '预热') sawPreheat = true
    }
    var state = sawPreheat && !sawOpen ? 'preheat'
      : sawOpen && !sawPreheat ? 'open'
      : sawOpen && sawPreheat ? 'both'
      : 'none'
    // 仅在「开价 → 预热」跳变的一瞬间触发：
    // 上一帧必须真的看到过「开价」按钮，本帧才可能判定为开价动作。
    // 注意不能写成 lastState !== 'preheat' —— 那会把「还没渲染出来」(none) 也算进去，
    // 页面重载 / 刚开启监听遇到预热中的页面时会立刻误发全部话术。
    var prevHadOpen = lastState === 'open' || lastState === 'both'
    if (prevHadOpen && sawPreheat) {
      fire()
    }
    lastState = state
  }

  // 心跳：页面 JS 正常执行时持续刷新，主进程据此判断脚本是否还活着。
  // 顺便每秒扫一次：MutationObserver 只在 DOM 变动时回调，页面长时间静止的话
  // 状态基线会一直停在注入那一刻（可能是 none），真开价时就漏掉了。
  var heartbeatId = setInterval(function () {
    window.__openPriceWatcherAlive = Date.now()
    scan()
  }, ${HEARTBEAT_INTERVAL_MS})
  window.__openPriceWatcherAlive = Date.now()

  var observer = new MutationObserver(scan)
  observer.observe(document.body, { subtree: true, childList: true, characterData: true })
  window.__openPriceCleanup = function () {
    clearInterval(heartbeatId)
    observer.disconnect()
    window.__openPriceWatcherSet = false
  }
  scan()
})()
`

/** 给 evaluate 加超时保护，页面卡死时不至于把健康检查挂住 */
async function evaluateWithTimeout<T>(page: Page, fn: () => T): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      page.evaluate(fn),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('页面无响应')), EVALUATE_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 卸载页面里的监听脚本（清理 interval 与 observer） */
export async function stopWatcherScript(page: Page | null): Promise<void> {
  if (!page || page.isClosed()) {
    return
  }
  try {
    await evaluateWithTimeout(page, () => {
      const w = globalThis as unknown as WatcherWindow
      if (typeof w.__openPriceCleanup === 'function') {
        w.__openPriceCleanup()
      }
    })
  } catch {
    // 页面已失效时无需处理
  }
}

/** 页面里的监听脚本是否还活着（脚本存在 + 心跳在刷新） */
export async function isWatcherScriptAlive(page: Page | null): Promise<boolean> {
  if (!page || page.isClosed()) {
    return false
  }
  try {
    const state = await evaluateWithTimeout(page, () => {
      const w = globalThis as unknown as WatcherWindow
      return {
        injected: Boolean(w.__openPriceWatcherSet),
        lastBeat: typeof w.__openPriceWatcherAlive === 'number' ? w.__openPriceWatcherAlive : 0,
      }
    })
    if (!state.injected || state.lastBeat === 0) {
      return false
    }
    return Date.now() - state.lastBeat < WATCHER_HEARTBEAT_TIMEOUT_MS
  } catch {
    return false
  }
}

/**
 * 支持自愈的开价监听能力（可选实现）。
 * 没有实现的平台（如视频号，它自带 iframe 重扫机制）一律视为「始终存活」。
 */
export interface IOpenPriceWatcherSelfHealing extends IOpenPriceWatcher {
  /** 页面里的监听脚本是否还活着 */
  isOpenPriceWatcherAlive?(): Promise<boolean>
  /** 重新注入监听脚本，返回是否成功 */
  rearmOpenPriceWatcher?(): Promise<boolean>
}

export function supportsOpenPriceSelfHealing(
  platform: IPlatform,
): platform is IPlatform & IOpenPriceWatcherSelfHealing {
  const candidate = platform as unknown as IOpenPriceWatcherSelfHealing
  return (
    typeof candidate.isOpenPriceWatcherAlive === 'function' ||
    typeof candidate.rearmOpenPriceWatcher === 'function'
  )
}
