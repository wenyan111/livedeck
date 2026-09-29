import { useMemoizedFn } from 'ahooks'
import { PlayIcon, SquareIcon } from 'lucide-react'
import React from 'react'
import { openPricePlatforms, openPriceSelfDetectPlatforms, platformLabels } from '@/abilities'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
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
  readQuickStartSelection,
  useQuickStart,
  useQuickStartStore,
} from '@/hooks/useQuickStart'
import { cn } from '@/lib/utils'

/** 各功能限定的平台，不在列表里则不显示该选项（与一键开启/自动开启共用同一份定义） */
const SUPPORTED_PLATFORMS = QUICK_START_SUPPORTED_PLATFORMS

const ALL_KEYS: QuickStartKey[] = ['autoMessage', 'autoPopUp', 'autoReply', 'openPrice']

/** 单个功能：勾选框 + 实时运行状态 */
const FeatureCheckbox = React.memo(
  ({
    accountId,
    platform,
    featureKey,
    running,
    error,
    note,
  }: {
    accountId: string
    platform: LiveControlPlatform
    featureKey: QuickStartKey
    running: boolean
    /** 开启失败原因，有值则显示红点 */
    error?: string | null
    /** 传了表示该平台不能在此启动，只展示说明，勾选框禁用 */
    note?: string
  }) => {
    // 「账号 × 平台」双重隔离：同一平台不同账号各记一份，切平台/切账号互不代入
    const checked = useQuickStartStore(s =>
      Boolean(readQuickStartSelection(s.selection, accountId, platform)[featureKey]),
    )
    const toggle = useQuickStartStore(s => s.toggle)
    const isConnected = useCurrentLiveControl(context => context.isConnected)
    const disabled = Boolean(note)

    return (
      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <div className="flex items-center gap-3">
          <Checkbox
            id={`quick-start-${platform}-${featureKey}`}
            checked={disabled ? false : checked}
            disabled={disabled}
            onCheckedChange={v => toggle(accountId, platform, featureKey, Boolean(v))}
          />
          <Label
            htmlFor={`quick-start-${platform}-${featureKey}`}
            className={cn('text-sm', disabled ? 'text-muted-foreground' : 'cursor-pointer')}
          >
            {QUICK_START_LABELS[featureKey]}
          </Label>
        </div>
        {note ? (
          <span className="text-xs text-muted-foreground">{note}</span>
        ) : (
          isConnected === 'connected' && (
            <span
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              title={error ?? undefined}
            >
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  running ? 'bg-success' : error ? 'bg-destructive' : 'bg-muted-foreground/40',
                )}
              />
              {running ? '运行中' : error ? '开启失败' : '未运行'}
            </span>
          )
        )}
      </div>
    )
  },
)

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
  const { selection, startAll, stopAll } = useQuickStart()
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
        <CardTitle>一键开启</CardTitle>
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
          <div className="grid gap-2 sm:grid-cols-2">
            {displayKeys.map(key => (
              <FeatureCheckbox
                key={key}
                accountId={currentAccountId}
                platform={platform}
                featureKey={key}
                running={runningMap[key]}
                error={key === 'openPrice' ? openPriceError : undefined}
                note={
                  key === 'openPrice' && !isOpenPriceStartable
                    ? '由跨平台联动触发，无需启动'
                    : undefined
                }
              />
            ))}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm">连接后自动开启</div>
              <div className="text-muted-foreground text-xs">
                连接到中控台后，自动开启上面勾选的功能（按账号 × 平台各自记忆）
              </div>
            </div>
            <AutoStartSwitch accountId={currentAccountId} platform={platform} />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {connected
                ? anyRunning
                  ? `运行中 ${selectedKeys.filter(k => runningMap[k]).length}/${selectedKeys.length}`
                  : `已勾选 ${selectedKeys.length} 项`
                : '请先连接直播控制台'}
            </span>
            <Button
              size="sm"
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
