import { useEffect, useRef } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { STREAM_END_SIGNALS } from 'shared/streamEnd'
import { useLiveControlStore } from './useLiveControl'
import { useLogsStore } from './useLogs'
import { useToast } from './useToast'

/**
 * 断播自动断开。
 *
 * 背景（2026-11-04 用户实测）：下播后各平台中控台里的评论列表/商品列表都会消失，
 * 于是「真@回复」和「自动弹窗」开始疯狂报「未命中 / 找不到元素」，
 * 10 分钟能刷 179 条警告，而且这些任务还在后台空转、占着浏览器。
 *
 * 判据不用额外探测，直接复用**日志里的失败信号**：
 *   同一平台在 3 分钟内累计 N 次失败 → 判定已断播 → 断开该平台的中控台。
 *
 * 为什么淘宝不做：淘宝下播后页面仍保留商品/评论区，探测不到异常，
 * 硬判会误断正在进行的直播（用户 2026-11-05 明确要求排除）。
 */

/** 统计窗口（用户 2026-11-05 定为 45 秒） */
const WINDOW_MS = 45 * 1000
/**
 * 窗口内失败达到这个次数才断开。
 *
 * ⚠️ 不能设成 3：任务重试本身就是「第 1/3、2/3、3/3」连打三次，
 * 2 秒内就能凑满 3 次 —— 正常直播时某一轮弹窗失败就会误断整个平台。
 *
 * ⚠️ 这里是**按平台各自计数**（hits 以平台为 key），不是所有平台加在一起。
 *
 * 2026-11-04 实际下播日志（各平台各自的异常条数，窗口内）：
 *   抖音   33(ERR) 40 41 42 52 53 54      → 21 秒内 7 条
 *   视频号 38 39 40 55 56 57              → 19 秒内 6 条
 *   小红书 42 43 44 59                    → 17 秒内 4 条（任务间隔 15 秒，攒得慢）
 *   快手 / 淘宝 基本没有
 *   你手动断开：09:19:00（距第一条异常 27 秒）
 *
 * 取 **5 条/平台**：抖音 09:18:52（+19 秒）、视频号 09:18:56（+23 秒）触发，
 * 都在你手动操作之前完成；单条任务重试最多产生 3 条，5 条至少要两轮，不会误判。
 */
const THRESHOLD = 5

/**
 * 平台单独的阈值覆盖。
 *
 * 小红书一次失败会打**两行**日志（`[ERROR] 小红书商品列表 定位失败` +
 * `[WARN] @小红书 -> 自动弹窗 第 N/3 次执行失败`），相当于每次失败计 2 条，
 * 5 条其实只等于 3 次真实失败——正常直播时连续两轮弹卡失败就会被误断。
 * 所以给它放宽到 8 条（≈4 次真实失败，45 秒内约 16 秒才攒满）。
 */
const THRESHOLD_BY_PLATFORM: Record<string, number> = {
  xiaohongshu: 8,
}
/** 断开后冷却，避免反复触发 */
const COOLDOWN_MS = 5 * 60 * 1000

/**
 * 不参与自动断开的平台：
 * - taobao：下播后页面仍保留商品/评论区，探测不到异常，硬判会误断
 * - kuaishou：它下播时几乎不报错（11-04 那场只有 1 条「与中控台连接断开」），
 *   按失败计数永远攒不满。快手改由主进程做**正向探测**：
 *   页面上出现「本场直播已结束」就直接断开（AccountManager.checkStreamEnd）。
 *   这里排除它，避免两套判定同时生效。
 */
const SKIP_PLATFORMS = new Set<string>(['taobao', 'kuaishou'])

/**
 * 这些警告属于「正常现象」，不计入断播判定：
 *   冷却中            —— 开价话术的防重复跳过，正常
 *   已在讲解中        —— 弹窗任务主动跳过，正常
 *   任务已停止        —— 用户手动停的
 *
 * 除这些之外，**所有 WARN / ERROR 都算一次异常**（用户 2026-11-05 要求：
 * 不止失败，警告也要纳入），因为断播时各任务抛出来的大多就是 WARN 级。
 */
const IGNORE_KEYWORDS = ['冷却中', '已在讲解中', '任务已停止']

/** 从日志文本里认出平台 */
const PLATFORM_KEYWORDS: Array<[RegExp, string]> = [
  [/快手/, 'kuaishou'],
  [/视频号/, 'wxchannel'],
  [/小红书|蒲公英/, 'xiaohongshu'],
  [/淘宝/, 'taobao'],
  [/抖音|百应/, 'douyin'],
]

const PLATFORM_LABEL: Record<string, string> = {
  kuaishou: '快手',
  wxchannel: '视频号',
  xiaohongshu: '小红书',
  taobao: '淘宝',
  douyin: '抖音',
}

export function useStreamEndWatcher() {
  const { toast } = useToast()
  const lastProcessedId = useRef<string | null>(null)
  /** 平台 → 窗口内的失败时间戳 */
  const hits = useRef<Map<string, number[]>>(new Map())
  /** 平台 → 上次自动断开时间 */
  const cooldown = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    const unsubscribe = useLogsStore.subscribe(state => {
      const latest = state.messages[state.messages.length - 1]
      if (!latest || latest.id === lastProcessedId.current) return
      lastProcessedId.current = latest.id

      if (latest.level !== 'WARN' && latest.level !== 'ERROR') return
      const text = `${latest.module} ${latest.message}`
      if (IGNORE_KEYWORDS.some(k => text.includes(k))) return

      const platform = PLATFORM_KEYWORDS.find(([re]) => re.test(text))?.[1]
      if (!platform || SKIP_PLATFORMS.has(platform)) return
      // 该平台已有「已下播」正向信号（主进程 AccountManager 每 20 秒探测一次），
      // 就用精确判定，不再靠数失败次数 —— 避免正常直播时误断。
      if (STREAM_END_SIGNALS[platform as LiveControlPlatform]) return

      const now = latest.at
      const window = (hits.current.get(platform) ?? []).filter(t => now - t <= WINDOW_MS)
      window.push(now)
      hits.current.set(platform, window)
      const limit = THRESHOLD_BY_PLATFORM[platform] ?? THRESHOLD
      if (window.length < limit) return

      const last = cooldown.current.get(platform) ?? 0
      if (now - last < COOLDOWN_MS) return
      cooldown.current.set(platform, now)
      hits.current.set(platform, [])

      void disconnectPlatform(platform, window.length, toast)
    })
    return unsubscribe
  }, [toast])
}

async function disconnectPlatform(
  platform: string,
  failCount: number,
  toast: ReturnType<typeof useToast>['toast'],
) {
  const contexts = useLiveControlStore.getState().contexts as Record<string, { platform: string }>
  const accountIds = Object.entries(contexts)
    .filter(([, ctx]) => ctx.platform === platform)
    .map(([id]) => id)

  if (accountIds.length === 0) return

  const label = PLATFORM_LABEL[platform] ?? platform
  let done = 0
  for (const id of accountIds) {
    try {
      await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.liveControl.disconnect, id)
      done++
    } catch {
      // 单个账号断开失败不影响其它
    }
  }
  if (done > 0) {
    toast.error(
      `检测到${label}可能已断播（3 分钟内失败 ${failCount} 次），已自动断开 ${done} 个账号`,
    )
  }
}
