import { useMemoizedFn } from 'ahooks'
import { CopyPlusIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAccounts } from '@/hooks/useAccounts'
import { useAutoReplyConfigStore } from '@/hooks/useAutoReplyConfig'
import { useToast } from '@/hooks/useToast'

/**
 * 一键同步配置词：把当前账号的 AI 提示词覆盖写入到勾选的其他账号。
 *
 * 每个账号的自动回复配置相互独立（按账号 × 配置隔离存储），同产品多账号时
 * 每个号都要把同一份提示词粘一遍很繁琐——这里勾选目标账号，一次写入全部。
 * 只覆盖提示词（prompt）本身，目标账号的其他配置（开关、关键词规则等）不动。
 */
export function SyncPromptDialog({ prompt }: { prompt: string }) {
  const accounts = useAccounts(s => s.accounts)
  const currentAccountId = useAccounts(s => s.currentAccountId)
  const { toast } = useToast()

  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])

  // 目标账号 = 除当前账号外的全部已创建账号
  const targets = accounts.filter(acc => acc.id !== currentAccountId)
  const allSelected = targets.length > 0 && selected.length === targets.length

  const toggle = (id: string, checked: boolean) => {
    setSelected(prev => (checked ? [...prev, id] : prev.filter(x => x !== id)))
  }

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? targets.map(acc => acc.id) : [])
  }

  const handleSync = useMemoizedFn(() => {
    if (selected.length === 0) return
    const store = useAutoReplyConfigStore.getState()
    for (const id of selected) {
      store.updateConfig(id, { comment: { aiReply: { prompt } } })
    }
    toast.success(`已把配置词同步到 ${selected.length} 个账号`)
    setSelected([])
    setOpen(false)
  })

  return (
    <Dialog
      open={open}
      onOpenChange={v => {
        setOpen(v)
        if (!v) setSelected([])
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={prompt.trim().length === 0}>
          <CopyPlusIcon className="mr-2 h-4 w-4" />
          一键同步配置词
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>同步配置词到其他账号</DialogTitle>
          <DialogDescription>
            把当前账号的提示词覆盖写入勾选的账号（只覆盖提示词，其他配置不变）
          </DialogDescription>
        </DialogHeader>

        {targets.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            暂无其他账号，先在「中控台管理」里创建账号
          </p>
        ) : (
          <div className="space-y-3 py-2">
            <div className="flex items-center space-x-2">
              <Checkbox id="sync-prompt-all" checked={allSelected} onCheckedChange={toggleAll} />
              <Label htmlFor="sync-prompt-all" className="font-medium text-sm">
                全选
              </Label>
            </div>
            <ScrollArea className="max-h-56 rounded-md border">
              <div className="space-y-1 p-2">
                {targets.map(acc => (
                  <div
                    key={acc.id}
                    className="flex items-center space-x-2 rounded px-2 py-1.5 hover:bg-accent"
                  >
                    <Checkbox
                      id={`sync-prompt-${acc.id}`}
                      checked={selected.includes(acc.id)}
                      onCheckedChange={(v: boolean | 'indeterminate') => toggle(acc.id, v === true)}
                    />
                    <Label
                      htmlFor={`sync-prompt-${acc.id}`}
                      className="flex-1 cursor-pointer text-sm font-normal"
                    >
                      {acc.name}
                    </Label>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            variant="default"
            onClick={handleSync}
            disabled={targets.length === 0 || selected.length === 0}
          >
            同步（{selected.length}）
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
