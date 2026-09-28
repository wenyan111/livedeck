import { useMemoizedFn } from 'ahooks'
import { useEffect, useMemo } from 'react'
import { platformLabels } from '@/abilities'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useAccounts } from '@/hooks/useAccounts'
import { useLiveControlStore } from '@/hooks/useLiveControl'
import {
  canSelfWatch,
  useOpenPriceLinkage,
  useOpenPriceLinkageStore,
} from '@/hooks/useOpenPriceLinkage'
import { useOpenPriceScriptStore } from '@/hooks/useOpenPriceScript'
import { cn } from '@/lib/utils'
import AccountScriptEditor from './AccountScriptEditor'

function formatTime(time: number) {
  return new Date(time).toLocaleTimeString('zh-CN', { hour12: false })
}

/** 避免每次渲染都产生新数组引用导致无限重渲染 */
const EMPTY_MESSAGES: { content: string; pinTop: boolean }[] = []

export default function OpenPriceLinkageCard() {
  const accounts = useAccounts(state => state.accounts)
  const contexts = useLiveControlStore(state => state.contexts)

  const config = useOpenPriceLinkageStore(state => state.config)
  const lastResult = useOpenPriceLinkageStore(state => state.lastResult)
  const setEnabled = useOpenPriceLinkageStore(state => state.setEnabled)
  const setSource = useOpenPriceLinkageStore(state => state.setSource)
  const setCooldown = useOpenPriceLinkageStore(state => state.setCooldown)
  const upsertTarget = useOpenPriceLinkageStore(state => state.upsertTarget)

  const accountNames = useMemo(
    () => Object.fromEntries(accounts.map(a => [a.id, a.name])),
    [accounts],
  )
  const accountPlatforms = useMemo(
    () => Object.fromEntries(accounts.map(a => [a.id, contexts[a.id]?.platform])),
    [accounts, contexts],
  )
  const accountConnected = useMemo(
    () =>
      Object.fromEntries(accounts.map(a => [a.id, contexts[a.id]?.isConnected === 'connected'])),
    [accounts, contexts],
  )

  const {
    triggerManual,
    applySelfWatchPolicy,
    applySelfWatchPolicyFor,
    startWatcher,
    stopWatcher,
  } = useOpenPriceLinkage({
    accountNames,
    accountPlatforms,
    accountConnected,
  })

  /** 触发源自身的开价监听是否在运行（没开的话整条联动都不会自动触发） */
  const sourceRunning = useOpenPriceScriptStore(state =>
    config.sourceAccountId ? Boolean(state.runtime[config.sourceAccountId]?.isRunning) : false,
  )
  const sourceError = useOpenPriceScriptStore(state =>
    config.sourceAccountId ? (state.runtime[config.sourceAccountId]?.error ?? null) : null,
  )
  const sourceMessages = useOpenPriceScriptStore(state =>
    config.sourceAccountId
      ? (state.contexts[config.sourceAccountId]?.config.messages ?? EMPTY_MESSAGES)
      : EMPTY_MESSAGES,
  )
  const sourceHasScript = sourceMessages.filter(m => m.content.trim() !== '').length > 0

  // 账号增减时补齐跟随列表条目；触发源自己不出现在跟随列表里
  useEffect(() => {
    for (const account of accounts) {
      if (account.id === config.sourceAccountId) continue
      const exists = config.targets.some(t => t.accountId === account.id)
      if (!exists) {
        upsertTarget({ accountId: account.id, follow: false, disableSelfWatch: true })
      }
    }
  }, [accounts, config.sourceAccountId, config.targets, upsertTarget])

  // 还没选触发源时，默认挑一个能检测开价的账号（优先巨量百应）
  useEffect(() => {
    if (config.sourceAccountId) return
    const candidates = accounts.filter(a => {
      const platform = accountPlatforms[a.id]
      return platform === 'buyin' || platform === 'douyin' || platform === 'wxchannel'
    })
    if (candidates.length === 0) return
    const preferred = candidates.find(a => accountPlatforms[a.id] === 'buyin') ?? candidates[0]
    setSource(preferred.id)
  }, [accounts, accountPlatforms, config.sourceAccountId, setSource])

  const sourceOptions = accounts.filter(a => canSelfWatch(accountPlatforms[a.id]))
  const followTargets = config.targets.filter(t => t.accountId !== config.sourceAccountId)

  // 已勾选跟随但还没填话术的平台，联动时会跳过，提前提示
  const scriptContexts = useOpenPriceScriptStore(state => state.contexts)
  const missingCount = followTargets.filter(t => {
    if (!t.follow) return false
    const list = scriptContexts[t.accountId]?.config.messages ?? []
    return list.filter(m => m.content.trim() !== '').length === 0
  }).length

  const handleToggleEnabled = useMemoizedFn(async (enabled: boolean) => {
    setEnabled(enabled)
    if (enabled) {
      // 开启联动时，按策略停掉跟随平台自身的开价监听，避免重复发送
      await applySelfWatchPolicy()
    }
  })

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>跨平台开价联动</CardTitle>
            <CardDescription>
              触发源检测到开价后，自动带动其他平台一起发各自配置的开价话术。
              每个平台的话术在下方各自的「开价话术」里填写，触发源自身需先在本页开启开价监听才会产生联动
            </CardDescription>
          </div>
          <Switch checked={config.enabled} onCheckedChange={handleToggleEnabled} />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">触发源（哪个平台开价就跟着发）</Label>
          <Select value={config.sourceAccountId ?? undefined} onValueChange={setSource}>
            <SelectTrigger>
              <SelectValue placeholder="选择触发源账号" />
            </SelectTrigger>
            <SelectContent>
              {sourceOptions.length === 0 ? (
                <SelectItem value="none" disabled>
                  没有已配置的可监听账号
                </SelectItem>
              ) : null}
              {sourceOptions.map(account => (
                <SelectItem key={account.id} value={account.id}>
                  {platformLabels[accountPlatforms[account.id] ?? 'douyin']} · {account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {config.sourceAccountId ? (
            <div className="pt-1 space-y-2">
              {/* 触发源必须先开启自己的开价监听，否则检测不到开价 → 整条联动都不会跑 */}
              <div className="flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      'w-1.5 h-1.5 shrink-0 rounded-full',
                      sourceRunning ? 'bg-success' : sourceError ? 'bg-destructive' : 'bg-muted-foreground/40',
                    )}
                  />
                  <span className="text-xs text-muted-foreground truncate">
                    {sourceRunning
                      ? '监听中：检测到开价会自动带动其他平台'
                      : sourceError
                        ? sourceError
                        : '未开启监听：检测到开价后不会联动，需先开启'}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant={sourceRunning ? 'secondary' : 'success'}
                  disabled={!accountConnected[config.sourceAccountId] || !sourceHasScript}
                  onClick={() =>
                    sourceRunning
                      ? stopWatcher(config.sourceAccountId as string)
                      : startWatcher(config.sourceAccountId as string)
                  }
                >
                  {sourceRunning ? '停止监听' : '开启监听'}
                </Button>
              </div>
              <AccountScriptEditor
                key={`source-${config.sourceAccountId}`}
                accountId={config.sourceAccountId}
              />
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>跟随平台</Label>
            {missingCount > 0 ? (
              <span className="text-xs text-destructive">
                {missingCount} 个已勾选平台还没填开价话术，联动时会跳过
              </span>
            ) : null}
          </div>
          {followTargets.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3 text-center border rounded-md border-dashed">
              还没有其他账号，先去中控台添加并连接
            </p>
          ) : null}
          {followTargets.map(target => {
            const platform = accountPlatforms[target.accountId]
            const connected = accountConnected[target.accountId]
            const selfWatch = canSelfWatch(platform)
            return (
              <div key={target.accountId} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={target.follow}
                    onCheckedChange={follow => {
                      upsertTarget({ ...target, follow })
                      // 跟随关系变化时立即应用「停用自身检测」策略，不用等下次开关联动
                      void applySelfWatchPolicyFor(target.accountId)
                    }}
                  />
                  <span className="text-sm font-medium">
                    {platformLabels[platform ?? 'douyin']} ·{' '}
                    {accountNames[target.accountId] ?? target.accountId}
                  </span>
                  <Badge variant={connected ? 'default' : 'secondary'}>
                    {connected ? '已连接' : '未连接'}
                  </Badge>
                </div>
                <div className="pl-11 space-y-2">
                  {/* 每个平台发的是自己账号下配置的话术，这里直接编辑，不用切账号 */}
                  <AccountScriptEditor
                    key={`target-${target.accountId}`}
                    accountId={target.accountId}
                  />
                  {selfWatch && target.follow ? (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        该平台自己能检测开价，跟随期间停用自身检测，避免重复发送
                      </span>
                      <Switch
                        checked={target.disableSelfWatch}
                        onCheckedChange={disableSelfWatch => {
                          upsertTarget({ ...target, disableSelfWatch })
                          // 勾选即立刻停掉它自身的开价监听；取消勾选则不再干涉
                          void applySelfWatchPolicyFor(target.accountId)
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">发送冷却（秒，防重复）</Label>
            <Input
              type="number"
              min={0}
              value={Math.round(config.cooldownMs / 1000)}
              onChange={e => setCooldown(Math.max(0, Number(e.target.value)) * 1000)}
              className="h-8"
            />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={triggerManual}>
              全部平台立即开价
            </Button>
          </div>
        </div>

        {lastResult ? (
          <div className="rounded-md border p-3 space-y-1">
            <p className="text-xs text-muted-foreground">
              {formatTime(lastResult.time)}
              {lastResult.source ? ` · 由「${lastResult.source}」触发` : ' · 手动触发'}
            </p>
            {lastResult.results.map(r => (
              <div key={r.accountName} className="flex items-center gap-2 text-sm">
                <span className={r.ok ? 'text-success' : 'text-destructive'}>
                  {r.ok ? '成功' : '失败'}
                </span>
                <span>{r.accountName}</span>
                {r.reason ? (
                  <span className="text-xs text-muted-foreground">{r.reason}</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
