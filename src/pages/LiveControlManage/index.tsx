import { useMemoizedFn } from 'ahooks'
import { Loader2, MonitorSmartphone, Pencil, PlugZap, Plus, Trash2, Unplug } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAccounts } from '@/hooks/useAccounts'
import { useConnectLiveControl } from '@/hooks/useConnectLiveControl'
import { useLiveControlStore } from '@/hooks/useLiveControl'
import { useToast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'

/** 记住上次勾选的账号，免去每次进页面重新勾一遍 */
const SELECTION_STORAGE_KEY = 'live-control-manage-selected'

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

/** 连接状态小徽标（沿用全站绿/黄/灰圆点语义） */
const StatusPill = React.memo(({ status }: { status: ConnStatus }) => {
  if (status === 'connecting') {
    return (
      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-warning">
        <Loader2 className="h-3 w-3 animate-spin" />
        连接中
      </span>
    )
  }
  const connected = status === 'connected'
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs',
        connected ? 'text-success' : 'text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          connected ? 'bg-success' : 'bg-muted-foreground/40',
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
  const { toast } = useToast()

  const [selected, setSelected] = useState<Record<string, boolean>>(() => readStoredSelection())

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
          {/* 操作区 */}
          <div className="flex flex-wrap items-center justify-between gap-3">
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

          <div className="h-px bg-border" />

          {accounts.length === 0 ? (
            <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
              还没有账号，点击右上角「添加账号」新建一个吧
            </p>
          ) : (
            <div className="space-y-2">
              {accounts.map(account => {
                const status = statusOf(account.id)
                const connected = status === 'connected'
                const connecting = status === 'connecting'
                const isDefault = account.id === 'default'
                return (
                  <div
                    key={account.id}
                    className="flex items-center gap-3 rounded-md border px-3 py-2.5"
                  >
                    <Checkbox
                      id={`live-control-manage-${account.id}`}
                      checked={Boolean(selected[account.id])}
                      onCheckedChange={v => toggleAccount(account.id, Boolean(v))}
                    />
                    <Select
                      value={platformOf(account.id)}
                      onValueChange={value => setPlatform(account.id, value as LiveControlPlatform)}
                      disabled={status !== 'disconnected'}
                    >
                      <SelectTrigger className="h-8 w-[128px]">
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
                      className="flex-1 cursor-pointer truncate font-medium"
                    >
                      {account.name}
                    </label>
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
                    {/* 账号编辑：重命名 / 删除 */}
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground"
                        title="重命名"
                        onClick={() => setEditing({ id: account.id, name: account.name })}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {!isDefault && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          title="删除账号"
                          onClick={() => setDeleting({ id: account.id, name: account.name })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
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
