import React from 'react'
import { openPricePlatforms, openPriceSelfDetectPlatforms } from '@/abilities'
import FeaturePill from '@/components/common/FeaturePill'
import { useAutoMessageStore } from '@/hooks/useAutoMessage'
import { useAutoPopUpStore } from '@/hooks/useAutoPopUp'
import { useAutoReplyStore } from '@/hooks/useAutoReply'
import { useOpenPriceScriptStore } from '@/hooks/useOpenPriceScript'
import {
  QUICK_START_KEYS,
  QUICK_START_LABELS,
  type QuickStartKey,
  readQuickStartSelection,
  useQuickStartStore,
} from '@/hooks/useQuickStart'
import { cn } from '@/lib/utils'

/**
 * 账号行下方的紧凑功能勾选（自动发言 / 自动弹窗 / 自动回复 / 开价话术）。
 *
 * 与「一键开启」卡片共用同一份勾选存储（按「账号 × 平台」隔离），
 * 在这里勾选等同于在「一键开启」卡片里勾选，两处实时同步 —— 连接中控台后会按此自动开启。
 * 功能运行中时名字后面亮绿点。
 */
const AccountFeatureToggles = React.memo(
  ({
    accountId,
    platform,
    connected,
  }: {
    accountId: string
    platform: LiveControlPlatform
    connected: boolean
  }) => {
    // 取整份 selection（引用稳定），在渲染里按「账号 × 平台」解析，避免选择器返回新对象导致频繁重渲
    const selectionMap = useQuickStartStore(s => s.selection)
    const toggle = useQuickStartStore(s => s.toggle)
    const selection = readQuickStartSelection(selectionMap, accountId, platform)

    // 各功能的真实运行状态（按账号读取）：只有真跑起来才亮绿点，勾了但没启动的不亮
    const autoMessageRunning = useAutoMessageStore(s => Boolean(s.contexts[accountId]?.isRunning))
    const autoPopUpRunning = useAutoPopUpStore(s => Boolean(s.contexts[accountId]?.isRunning))
    const autoReplyRunning = useAutoReplyStore(s => Boolean(s.contexts[accountId]?.isRunning))
    const openPriceRunning = useOpenPriceScriptStore(s => Boolean(s.runtime[accountId]?.isRunning))
    // 四个功能的「开启失败」错误：用于功能胶囊的红色失败点（失败即亮红，成功/停止即清掉）
    const autoMessageError = useAutoMessageStore(s => s.contexts[accountId]?.error ?? null)
    const autoPopUpError = useAutoPopUpStore(s => s.contexts[accountId]?.error ?? null)
    const autoReplyError = useAutoReplyStore(s => s.contexts[accountId]?.error ?? null)
    const openPriceError = useOpenPriceScriptStore(s => s.runtime[accountId]?.error ?? null)
    const errorMap: Record<QuickStartKey, string | null> = {
      autoMessage: autoMessageError,
      autoPopUp: autoPopUpError,
      autoReply: autoReplyError,
      openPrice: openPriceError,
    }
    const runningMap: Record<QuickStartKey, boolean> = {
      autoMessage: autoMessageRunning,
      autoPopUp: autoPopUpRunning,
      autoReply: autoReplyRunning,
      openPrice: openPriceRunning,
    }

    // 开价话术只在「能发送话术」的平台显示；不能自检的平台禁用（只能靠跨平台联动触发）
    const keys = QUICK_START_KEYS.filter(key =>
      key === 'openPrice' ? openPricePlatforms.includes(platform) : true,
    )

    // 窄屏自适应：按本单元格实测宽度降档，永远排成一行（不换行、不被挤出）。
    // 阈值对应三档的自然宽度：标准≈338px、compact≈276px、tiny≈222px。
    const wrapRef = React.useRef<HTMLDivElement>(null)
    const [density, setDensity] = React.useState<'default' | 'compact' | 'tiny'>('default')
    React.useEffect(() => {
      const el = wrapRef.current
      if (!el) return
      const apply = (w: number) => {
        if (w <= 0) return
        const next: 'default' | 'compact' | 'tiny' =
          w < 280 ? 'tiny' : w < 330 ? 'compact' : 'default'
        setDensity(prev => (prev === next ? prev : next))
      }
      apply(el.getBoundingClientRect().width)
      const ro = new ResizeObserver(entries => {
        for (const entry of entries) apply(entry.contentRect.width)
      })
      ro.observe(el)
      return () => ro.disconnect()
    }, [])

    return (
      <div
        ref={wrapRef}
        className={cn(
          'flex min-w-0 flex-nowrap items-center',
          density === 'tiny' ? 'gap-[3px]' : density === 'compact' ? 'gap-1' : 'gap-1.5',
        )}
      >
        {keys.map(key => {
          const disabled = key === 'openPrice' && !openPriceSelfDetectPlatforms.includes(platform)
          const checked = disabled ? false : Boolean(selection[key])
          return (
            <FeaturePill
              key={key}
              id={`acct-feat-${accountId}-${key}`}
              label={QUICK_START_LABELS[key]}
              checked={checked}
              disabled={disabled}
              disabledTitle={disabled ? '由跨平台开价联动触发，无需在此启动' : undefined}
              connected={connected}
              running={runningMap[key]}
              error={errorMap[key]}
              density={density}
              onToggle={() => toggle(accountId, platform, key, !checked)}
            />
          )
        })}
      </div>
    )
  },
)

export default AccountFeatureToggles
