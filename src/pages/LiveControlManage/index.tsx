import { useMemoizedFn } from 'ahooks'
import {
  Loader2,
  MonitorSmartphone,
  MoreHorizontal,
  Pencil,
  PlayIcon,
  PlugZap,
  Plus,
  SquareIcon,
  Trash2,
  Unplug,
} from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'
import { platformLabels } from '@/abilities'
import { Title } from '@/components/common/Title'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAccounts } from '@/hooks/useAccounts'
import { useAutoMessageStore } from '@/hooks/useAutoMessage'
import { useAutoPopUpStore } from '@/hooks/useAutoPopUp'
import { useAutoReplyStore } from '@/hooks/useAutoReply'
import { useConnectLiveControl } from '@/hooks/useConnectLiveControl'
import { useLiveControlStore } from '@/hooks/useLiveControl'
import { useOpenPriceScriptStore } from '@/hooks/useOpenPriceScript'
import {
  isQuickStartSupported,
  QUICK_START_KEYS,
  QUICK_START_LABELS,
  type QuickStartKey,
  readQuickStartSelection,
  useFeatureControls,
  useQuickStartStore,
} from '@/hooks/useQuickStart'
import { useToast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'
import AccountFeatureToggles from './components/AccountFeatureToggles'

/** 记住上次勾选的账号，免去每次进页面重新勾一遍 */
const SELECTION_STORAGE_KEY = 'live-control-manage-selected'

/** 账号列表的状态筛选（账号多了以后用来快速只看未连接/已连接） */
type StatusFilter = 'all' | 'connected' | 'disconnected'

/** 平台下拉选项：生产环境隐藏 dev 测试平台 */
const PLATFORM_OPTIONS = (() => {
  const entries = Object.entries(platformLabels) as [LiveControlPlatform, string][]
  const isDev = process.env.NODE_ENV === 'development'
  return isDev ? entries : entries.filter(([key]) => key !== 'dev')
})()

function readStoredSelection(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SELECTION_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

type ConnStatus = 'connecting' | 'connected' | 'disconnected'

/** 连接状态徽章：灰=未连接、琥珀呼吸=连接中、绿=已连接 */
const StatusPill = React.memo(({ status }: { status: ConnStatus }) => {
  if (status === 'connecting') {
    return (
      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-warning/15 px-2.5 py-[3px] text-xs leading-none text-warning">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-warning" />
        连接中
      </span>
    )
  }
  const connected = status === 'connected'
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs leading-none',
        connected ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          connected ? 'bg-success' : 'bg-muted-foreground/50',
        )}
      />
      {connected ? '已连接' : '未连接'}
    </span>
  )
})

export default function LiveControlManage() {
  const accounts = useAccounts(s => s.accounts)
  const addAccount = useAccounts(s => s.addAccount)
  const updateAccountName = useAccounts(s => s.updateAccountName)
  const removeAccount = useAccounts(s => s.removeAccount)
  const contexts = useLiveControlStore(s => s.contexts)
  const setPlatform = useLiveControlStore(s => s.setPlatform)
  const { connectAccount, disconnectAccount } = useConnectLiveControl()
  // 每账号的「一键开启/停止」：复用首页「一键开启」的启动/停止实现，按各账号 × 平台各自的勾选操作
  const selectionMap = useQuickStartStore(s => s.selection)
  const { startByKey, stopByKey, getRunning } = useFeatureControls()
  const { toast } = useToast()

  // 运行状态必须「订阅」，不能靠 getRunning() 里的 getState() 读快照。
  // 历史 bug：按钮的 anyRunning 是在渲染时用 getRunning()（内部 getState() 读一次）算出来的，
  // 功能启动/停止不会让本页面重渲染 —— 于是出现「账号行下方绿点已经亮了（那个子组件自己订阅、
  // 实时更新），右侧按钮却还停在『一键开启』」，点了还会弹「没有可开启的功能」。
  // 这里订阅整份 contexts/runtime（引用稳定），页面就会随运行状态变化而重渲染。
  const autoMessageContexts = useAutoMessageStore(s => s.contexts)
  const autoPopUpContexts = useAutoPopUpStore(s => s.contexts)
  const autoReplyContexts = useAutoReplyStore(s => s.contexts)
  const openPriceRuntime = useOpenPriceScriptStore(s => s.runtime)

  /** 渲染用的运行状态（响应式）：与下方勾选行同源，保证按钮与绿点永远一致 */
  const isRunningOf = (key: QuickStartKey, id: string): boolean => {
    switch (key) {
      case 'autoMessage':
        return Boolean(autoMessageContexts[id]?.isRunning)
      case 'autoPopUp':
        return Boolean(autoPopUpContexts[id]?.isRunning)
      case 'autoReply':
        return Boolean(autoReplyContexts[id]?.isRunning)
      case 'openPrice':
        return Boolean(openPriceRuntime[id]?.isRunning)
    }
  }

  const [selected, setSelected] = useState<Record<string, boolean>>(() => readStoredSelection())
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // 账号增删改对话框
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)

  // 记住勾选，下次进页面自动还原
  useEffect(() => {
    try {
      localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selected))
    } catch {
      // 忽略隐私模式等写入失败
    }
  }, [selected])

  // 新账号首次出现在这里时补齐 live-control 上下文（否则平台为空，连不上）
  useEffect(() => {
    for (const account of accounts) {
      if (!useLiveControlStore.getState().contexts[account.id]) {
        setPlatform(account.id, 'douyin')
      }
    }
  }, [accounts, setPlatform])

  const statusOf = (id: string): ConnStatus => contexts[id]?.isConnected ?? 'disconnected'
  const platformOf = (id: string): LiveControlPlatform => contexts[id]?.platform ?? 'douyin'

  /** 该账号 × 平台下要操作的功能：已勾选 + 该平台支持（与账号行下方的勾选同源） */
  const keysOf = (id: string) => {
    const platform = platformOf(id)
    const selection = readQuickStartSelection(selectionMap, id, platform)
    return QUICK_START_KEYS.filter(key => selection[key] && isQuickStartSupported(key, platform))
  }

  const visibleAccounts = useMemo(
    () =>
      accounts.filter(a => {
        if (statusFilter === 'all') return true
        return (contexts[a.id]?.isConnected ?? 'disconnected') === statusFilter
      }),
    [accounts, statusFilter, contexts],
  )

  const selectedAccounts = useMemo(() => accounts.filter(a => selected[a.id]), [accounts, selected])
  const connectableCount = selectedAccounts.filter(a => statusOf(a.id) === 'disconnected').length
  const disconnectableCount = selectedAccounts.filter(a => statusOf(a.id) === 'connected').length
  const allSelected = accounts.length > 0 && accounts.every(a => selected[a.id])

  const toggleAccount = useMemoizedFn((id: string, checked: boolean) => {
    setSelected(prev => ({ ...prev, [id]: checked }))
  })

  const toggleAll = useMemoizedFn((checked: boolean) => {
    const next: Record<string, boolean> = {}
    for (const account of accounts) next[account.id] = checked
    setSelected(next)
  })

  const handleConnectSelected = useMemoizedFn(() => {
    const targets = accounts.filter(a => selected[a.id] && statusOf(a.id) === 'disconnected')
    if (targets.length === 0) {
      toast.error('请勾选未连接的账号')
      return
    }
    toast.success(`正在连接 ${targets.length} 个账号…`)
    // 并发发起、互不阻塞：某个账号需要手动登录时不会卡住其它账号的连接
    void Promise.all(targets.map(async a => ({ name: a.name, ok: await connectAccount(a) }))).then(
      results => {
        const okList = results.filter(r => r.ok).map(r => r.name)
        const failList = results.filter(r => !r.ok).map(r => r.name)
        if (okList.length > 0) toast.success(`已连接：${okList.join('、')}`)
        if (failList.length > 0) toast.error(`连接失败：${failList.join('、')}`)
      },
    )
  })

  const handleDisconnectSelected = useMemoizedFn(async () => {
    const targets = accounts.filter(a => selected[a.id] && statusOf(a.id) === 'connected')
    if (targets.length === 0) {
      toast.error('请勾选已连接的账号')
      return
    }
    const results = await Promise.all(
      targets.map(async a => ({ name: a.name, ok: await disconnectAccount(a.id) })),
    )
    const okList = results.filter(r => r.ok).map(r => r.name)
    const failList = results.filter(r => !r.ok).map(r => r.name)
    if (okList.length > 0) toast.success(`已断开：${okList.join('、')}`)
    if (failList.length > 0) toast.error(`断开失败：${failList.join('、')}`)
  })

  /** 单个账号的一键开启 / 停止：开启=启动该账号勾选且未运行的功能；停止=停掉正在运行的 */
  const runForAccount = useMemoizedFn(async (account: Account, mode: 'start' | 'stop') => {
    const okList: string[] = []
    const failList: string[] = []
    for (const key of keysOf(account.id)) {
      const running = getRunning(key, account.id)
      if (mode === 'start' && running) continue
      if (mode === 'stop' && !running) continue
      const label = QUICK_START_LABELS[key]
      if (mode === 'start') {
        const r = await startByKey[key](account.id)
        if (r.ok) okList.push(label)
        else failList.push(`${label}(${r.reason ?? '失败'})`)
      } else {
        try {
          await stopByKey[key](account.id)
          okList.push(label)
        } catch {
          failList.push(label)
        }
      }
    }
    const verb = mode === 'start' ? '开启' : '停止'
    if (okList.length > 0) toast.success(`${account.name} 已${verb}：${okList.join('、')}`)
    if (failList.length > 0) toast.error(`${account.name} ${verb}失败：${failList.join('；')}`)
    if (okList.length === 0 && failList.length === 0) {
      // 说明勾选的功能本来就全在运行（或全没运行），把原因说清楚，
      // 别再出现含糊的「没有可开启的功能」
      toast.error(
        mode === 'start'
          ? `${account.name} 勾选的功能都已开启，无需重复启动`
          : `${account.name} 勾选的功能都没有在运行`,
      )
    }
  })

  const handleConnectOne = useMemoizedFn(async (account: Account) => {
    const ok = await connectAccount(account)
    if (ok) toast.success(`${account.name} 已连接`)
    else toast.error(`${account.name} 连接失败`)
  })

  const handleDisconnectOne = useMemoizedFn(async (account: Account) => {
    const ok = await disconnectAccount(account.id)
    if (ok) toast.success(`${account.name} 已断开`)
    else toast.error(`${account.name} 断开失败`)
  })

  // —— 账号增删改 ——
  const handleAdd = useMemoizedFn(() => {
    const name = newName.trim()
    if (!name) {
      toast.error('请输入账号名称')
      return
    }
    if (accounts.some(a => a.name === name)) {
      toast.error('账号名称已存在')
      return
    }
    addAccount(name)
    setIsAddOpen(false)
    setNewName('')
    toast.success('添加账号成功')
  })

  const handleRename = useMemoizedFn(() => {
    if (!editing) return
    const name = editing.name.trim()
    if (!name) {
      toast.error('请输入账号名称')
      return
    }
    if (accounts.some(a => a.name === name && a.id !== editing.id)) {
      toast.error('账号名称已存在')
      return
    }
    updateAccountName(editing.id, name)
    setEditing(null)
    toast.success('修改账号名称成功')
  })

  const handleDelete = useMemoizedFn(() => {
    if (!deleting) return
    removeAccount(deleting.id)
    // 删除后若仍勾选着，清掉勾选，避免选中一个已不存在的账号
    setSelected(prev => {
      const next = { ...prev }
      delete next[deleting.id]
      return next
    })
    setDeleting(null)
    toast.success(`已删除账号「${deleting.name}」`)
  })

  return (
    <div className="container space-y-4 py-8">
      <Title title="中控台管理" description="勾选账号，一次性连接或断开多个中控台" />

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MonitorSmartphone className="h-4 w-4 text-brand" />
                账号连接管理
              </CardTitle>
              <CardDescription>
                每个账号使用各自的平台与登录态。连接成功后，会按该账号的「连接后自动开启」设置自动启动功能。
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setIsAddOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              添加账号
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 工具栏：全选 + 筛选 在左，批量操作在右（与单个账号的操作分层） */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="live-control-manage-select-all"
                  checked={allSelected}
                  onCheckedChange={v => toggleAll(Boolean(v))}
                  disabled={accounts.length === 0}
                />
                <label htmlFor="live-control-manage-select-all" className="cursor-pointer text-sm">
                  全选
                </label>
                <span className="text-xs text-muted-foreground">
                  已选 {selectedAccounts.length} / {accounts.length}
                </span>
              </div>
              <Select value={statusFilter} onValueChange={v => setStatusFilter(v as StatusFilter)}>
                <SelectTrigger className="h-7 w-[104px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="connected">只看已连接</SelectItem>
                  <SelectItem value="disconnected">只看未连接</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleConnectSelected}
                disabled={connectableCount === 0}
                title={connectableCount === 0 ? '勾选的账号都已在连接中/已连接' : undefined}
              >
                <PlugZap className="mr-2 h-4 w-4" />
                一键连接{connectableCount > 0 ? ` (${connectableCount})` : ''}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleDisconnectSelected}
                disabled={disconnectableCount === 0}
                title={disconnectableCount === 0 ? '勾选的账号里没有已连接的' : undefined}
              >
                <Unplug className="mr-2 h-4 w-4" />
                一键断开{disconnectableCount > 0 ? ` (${disconnectableCount})` : ''}
              </Button>
            </div>
          </div>

          {accounts.length === 0 ? (
            <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
              还没有账号，点击右上角「添加账号」新建一个吧
            </p>
          ) : visibleAccounts.length === 0 ? (
            <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
              当前筛选下没有账号
            </p>
          ) : (
            <div className="space-y-2">
              {visibleAccounts.map(account => {
                const status = statusOf(account.id)
                const connected = status === 'connected'
                const connecting = status === 'connecting'
                const isDefault = account.id === 'default'
                const platform = platformOf(account.id)
                // 未连接时一律按「没在运行」算：断线会停掉所有任务，
                // 万一状态没复位也不会把按钮卡在「一键停止」
                // 注意：这里必须用**响应式**的 isRunningOf（订阅来的），不能用 getRunning()，
                // 否则功能启动后按钮文字不会跟着变（见上面 isRunningOf 处的说明）。
                const runningKeys = keysOf(account.id).filter(k => isRunningOf(k, account.id))
                const anyRunning = connected && runningKeys.length > 0
                const canStart = keysOf(account.id).some(k => !isRunningOf(k, account.id))
                return (
                  <div
                    key={account.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 transition-colors hover:border-border hover:bg-accent/40"
                  >
                    <Checkbox
                      id={`live-control-manage-${account.id}`}
                      checked={Boolean(selected[account.id])}
                      onCheckedChange={v => toggleAccount(account.id, Boolean(v))}
                    />
                    {/* 平台徽标：比整块下拉更省地方，一眼区分平台 */}
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-medium">
                      {platformLabels[platform]?.[0] ?? '?'}
                    </span>
                    <Select
                      value={platform}
                      onValueChange={value => setPlatform(account.id, value as LiveControlPlatform)}
                      disabled={status !== 'disconnected'}
                    >
                      <SelectTrigger className="h-7 w-[104px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PLATFORM_OPTIONS.map(([key, name]) => (
                          <SelectItem key={key} value={key}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <label
                      htmlFor={`live-control-manage-${account.id}`}
                      className="min-w-0 flex-1 cursor-pointer truncate font-medium"
                    >
                      {account.name}
                    </label>
                    {/* 该账号的功能开关（与首页「一键开启」卡片同源，实时同步） */}
                    <AccountFeatureToggles
                      accountId={account.id}
                      platform={platform}
                      connected={connected}
                    />
                    <StatusPill status={status} />
                    {connected ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleDisconnectOne(account)}
                      >
                        断开
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => void handleConnectOne(account)}
                        disabled={connecting}
                      >
                        {connecting ? (
                          <>
                            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                            连接中
                          </>
                        ) : (
                          '连接'
                        )}
                      </Button>
                    )}
                    {/* 重命名 / 删除收进「更多」，避免误点红色的删除 */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground"
                          title="更多操作"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-32 p-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start"
                          onClick={() => setEditing({ id: account.id, name: account.name })}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          重命名
                        </Button>
                        {!isDefault && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start text-destructive"
                            onClick={() => setDeleting({ id: account.id, name: account.name })}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            删除
                          </Button>
                        )}
                      </PopoverContent>
                    </Popover>
                    {/* 一键开启 / 停止：只作用于此账号。
                        未连接时用灰色描边——绿色代表「可开启」，没连接时不该给绿色误导。 */}
                    <Button
                      size="sm"
                      variant={anyRunning ? 'destructive' : connected ? 'success' : 'outline'}
                      disabled={!connected || (!anyRunning && !canStart)}
                      title={connected ? undefined : '请先连接中控台'}
                      onClick={() => void runForAccount(account, anyRunning ? 'stop' : 'start')}
                    >
                      {anyRunning ? (
                        <>
                          <SquareIcon className="mr-1.5 h-4 w-4" />
                          一键停止
                        </>
                      ) : (
                        <>
                          <PlayIcon className="mr-1.5 h-4 w-4" />
                          一键开启
                        </>
                      )}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            提示：视频号 /
            淘宝需确认「已开播」后再连接；淘宝会强制关闭无头模式。若某账号需要登录，会弹出浏览器等待你完成登录，可继续操作其它账号。
          </p>
        </CardContent>
      </Card>

      {/* 添加账号对话框 */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加账号</DialogTitle>
            <DialogDescription>新增一个账号，名称不能重复。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="账号名称"
              value={newName}
              autoFocus
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAdd()
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setIsAddOpen(false)}>
                取消
              </Button>
              <Button onClick={handleAdd}>确定</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 重命名对话框 */}
      <Dialog open={editing !== null} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改账号名称</DialogTitle>
            <DialogDescription>账号名称不能重复。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="账号名称"
              value={editing?.name ?? ''}
              autoFocus
              onChange={e => setEditing(prev => (prev ? { ...prev, name: e.target.value } : null))}
              onKeyDown={e => {
                if (e.key === 'Enter') handleRename()
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                取消
              </Button>
              <Button onClick={handleRename}>确定</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={deleting !== null} onOpenChange={open => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除账号</DialogTitle>
            <DialogDescription>
              确定要删除账号「{deleting?.name}
              」吗？该操作会一并清除它的中控台连接与平台设置，且不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
