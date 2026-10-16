import { useMemoizedFn } from 'ahooks'
import { PlayIcon, SquareIcon, ZapIcon } from 'lucide-react'
import React from 'react'
import { openPricePlatforms, openPriceSelfDetectPlatforms, platformLabels } from '@/abilities'
import FeaturePill from '@/components/common/FeaturePill'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useAccounts } from '@/hooks/useAccounts'
import { useCurrentAutoMessage } from '@/hooks/useAutoMessage'
import { useCurrentAutoPopUp } from '@/hooks/useAutoPopUp'
import { useAutoReply } from '@/hooks/useAutoReply'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { useCurrentOpenPriceRuntime } from '@/hooks/useOpenPriceScript'
import {
  QUICK_START_LABELS,
  QUICK_START_SUPPORTED_PLATFORMS,
  type QuickStartKey,
  readQuickStartAutoStart,
  useQuickStart,
  useQuickStartStore,
} from '@/hooks/useQuickStart'

/** 各功能限定的平台，不在列表里则不显示该选项（与一键开启/自动开启共用同一份定义） */
const SUPPORTED_PLATFORMS = QUICK_START_SUPPORTED_PLATFORMS

const ALL_KEYS: QuickStartKey[] = ['autoMessage', 'autoPopUp', 'autoReply', 'openPrice']

/** 「连接后自动开启」开关：按「账号 × 平台」各自记忆，切平台/账号互不代入 */
const AutoStartSwitch = React.memo(
  ({ accountId, platform }: { accountId: string; platform: LiveControlPlatform }) => {
    const checked = useQuickStartStore(s =>
      readQuickStartAutoStart(s.autoStart, accountId, platform),
    )
    const setAutoStartOnConnect = useQuickStartStore(s => s.setAutoStartOnConnect)
    return (
      <Switch
        checked={checked}
        onCheckedChange={v => setAutoStartOnConnect(accountId, platform, v)}
      />
    )
  },
)

const QuickStartCard = React.memo(() => {
  const isConnected = useCurrentLiveControl(context => context.isConnected)
  const platform = useCurrentLiveControl(context => context.platform)
  const { currentAccountId, accounts } = useAccounts()
  const accountName = accounts.find(acc => acc.id === currentAccountId)?.name
  const { selection, toggle, startAll, stopAll } = useQuickStart()
  const [busy, setBusy] = React.useState(false)

  const isAutoMessageRunning = useCurrentAutoMessage(context => context.isRunning)
  const isAutoPopUpRunning = useCurrentAutoPopUp(context => context.isRunning)
  const { isRunning: isAutoReplyRunning } = useAutoReply()
  const { isRunning: isOpenPriceRunning, error: openPriceError } = useCurrentOpenPriceRuntime()

  const runningMap: Record<QuickStartKey, boolean> = {
    autoMessage: isAutoMessageRunning,
    autoPopUp: isAutoPopUpRunning,
    autoReply: isAutoReplyRunning,
    openPrice: isOpenPriceRunning,
  }

  const isOpenPriceStartable = openPriceSelfDetectPlatforms.includes(platform)

  // 平台完全不支持的「功能」不显示；但开价话术只要能发言的平台就显示出来，
  // 检测不了开价的平台（快手/小红书等）禁用勾选框并说明由联动触发，
  // 否则用户会以为这个平台没有开价话术功能。
  const displayKeys = ALL_KEYS.filter(key => {
    if (key === 'openPrice') return openPricePlatforms.includes(platform)
    const allowed = SUPPORTED_PLATFORMS[key]
    return !allowed || allowed.includes(platform)
  })

  // 能真正被「一键开启」启动的功能（开价话术只有能自动检测开价的平台才可启动）
  const keys = displayKeys.filter(key => {
    const allowed = SUPPORTED_PLATFORMS[key]
    return !allowed || allowed.includes(platform)
  })

  const connected = isConnected === 'connected'
  const selectedKeys = keys.filter(k => selection[k])
  const anyRunning = selectedKeys.some(k => runningMap[k])

  const handleClick = useMemoizedFn(async () => {
    setBusy(true)
    try {
      if (anyRunning) {
        await stopAll()
      } else {
        await startAll()
      }
    } finally {
      setBusy(false)
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ZapIcon className="h-4 w-4 text-brand" />
          一键开启
        </CardTitle>
        <CardDescription>
          勾选开播后要启动的功能，连接中控台后会自动开启，也可以随时手动一键开启/停止
        </CardDescription>
        {/* 勾选按「账号 × 平台」隔离，标明当前作用对象，避免误以为切平台/账号后状态串了 */}
        <div className="text-xs text-muted-foreground">
          当前：{platformLabels[platform]}
          {accountName ? ` · ${accountName}` : ''}
          （各平台、各账号的勾选相互独立）
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* 操作区置顶：状态提示（一键开启/停止按钮已移至下方胶囊行末尾，按用户要求） */}
          <div className="text-xs text-muted-foreground">
            {connected
              ? anyRunning
                ? `运行中 ${selectedKeys.filter(k => runningMap[k]).length}/${selectedKeys.length}`
                : `已勾选 ${selectedKeys.length} 项`
              : '请先连接直播控制台'}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm">连接后自动开启</div>
              <div className="text-muted-foreground text-xs">
                连接到中控台后稍候约 15 秒（等页面加载完成）自动开启下方勾选的功能（按账号 ×
                平台各自记忆）
              </div>
            </div>
            <AutoStartSwitch accountId={currentAccountId} platform={platform} />
          </div>

          <Separator />

          {/* 功能勾选：与「中控台管理」账号行下方的功能勾选同款胶囊（共用 FeaturePill 组件）
              已勾选=珊瑚色实心、未勾选=浅描边；运行中亮绿点、开启失败亮红点
              一键开启/停止按钮放在胶囊行末尾（按用户要求） */}
          <div className="flex flex-wrap items-center gap-2">
            {displayKeys.map(key => {
              const disabled = key === 'openPrice' && !isOpenPriceStartable
              return (
                <FeaturePill
                  key={key}
                  id={`quick-start-${platform}-${key}`}
                  label={QUICK_START_LABELS[key]}
                  size="lg"
                  checked={disabled ? false : Boolean(selection[key])}
                  disabled={disabled}
                  disabledTitle={disabled ? '由跨平台联动触发，无需启动' : undefined}
                  connected={connected}
                  running={runningMap[key]}
                  error={key === 'openPrice' ? openPriceError : undefined}
                  onToggle={() => toggle(currentAccountId, platform, key, !selection[key])}
                />
              )
            })}
            <Button
              size="sm"
              className="ml-1"
              onClick={handleClick}
              disabled={!connected || !currentAccountId || selectedKeys.length === 0 || busy}
              variant={anyRunning ? 'destructive' : 'success'}
            >
              {anyRunning ? (
                <>
                  <SquareIcon className="mr-2 h-4 w-4" />
                  一键停止
                </>
              ) : (
                <>
                  <PlayIcon className="mr-2 h-4 w-4" />
                  一键开启
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
})

export default QuickStartCard
