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
import { type FilterKeywordItem, useAutoReplyConfigStore } from '@/hooks/useAutoReplyConfig'
import { useToast } from '@/hooks/useToast'

type Keyword = string | FilterKeywordItem

/** 老数据里关键词可能是纯字符串，统一成 { text, matchType } 再参与同步。 */
const normalize = (kw: Keyword): FilterKeywordItem =>
  typeof kw === 'string' ? { text: kw, matchType: 'fuzzy' } : { ...kw }

/**
 * 一键同步过滤关键词：把当前账号的「弹幕过滤关键词」写入到勾选的其他账号。
 *
 * 和提示词一样，关键词也是按账号隔离存储的，同产品多账号时同一批敏感词要重复录好几遍。
 * 这里勾选目标账号一次写入，并提供两种模式：
 * - 追加合并（默认）：保留目标账号已有词条，按文本去重，重复的以目标原有匹配模式为准；
 * - 完全覆盖：用当前账号的词条整个替换目标账号的列表（清理历史脏词时用）。
 */
export function SyncFilterKeywordsDialog({ keywords }: { keywords: Keyword[] }) {
  const accounts = useAccounts(s => s.accounts)
  const currentAccountId = useAccounts(s => s.currentAccountId)
  // 订阅各账号的过滤词条数：在弹窗里直接标出「已有 N 条」，方便判断覆盖还是追加
  const contexts = useAutoReplyConfigStore(s => s.contexts)
  const { toast } = useToast()

  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [overwrite, setOverwrite] = useState(false)

  const source = keywords.map(normalize)
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
    if (selected.length === 0 || source.length === 0) return
    const store = useAutoReplyConfigStore.getState()
    for (const id of selected) {
      if (overwrite) {
        store.updateConfig(id, { filterKeywords: source })
        continue
      }
      // 追加合并：目标已有词条原样保留，当前账号的词只补空缺（按文本去重）
      const existing = (store.contexts[id]?.config.filterKeywords ?? []).map(normalize)
      const seen = new Set(existing.map(kw => kw.text))
      const merged = [...existing]
      for (const kw of source) {
        if (seen.has(kw.text)) continue
        seen.add(kw.text)
        merged.push(kw)
      }
      store.updateConfig(id, { filterKeywords: merged })
    }
    toast.success(
      `已${overwrite ? '覆盖' : '追加'}同步 ${source.length} 条关键词到 ${selected.length} 个账号`,
    )
    setSelected([])
    setOpen(false)
  })

  return (
    <Dialog
      open={open}
      onOpenChange={v => {
        setOpen(v)
        if (!v) {
          setSelected([])
          setOverwrite(false)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={source.length === 0}>
          <CopyPlusIcon className="mr-2 h-4 w-4" />
          一键同步关键词
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>同步过滤关键词到其他账号</DialogTitle>
          <DialogDescription>
            把当前账号的 {source.length} 条过滤关键词写入勾选的账号
          </DialogDescription>
        </DialogHeader>

        {targets.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            暂无其他账号，先在「中控台管理」里创建账号
          </p>
        ) : (
          <div className="space-y-3 py-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="sync-keywords-overwrite"
                checked={overwrite}
                onCheckedChange={(v: boolean | 'indeterminate') => setOverwrite(v === true)}
              />
              <Label htmlFor="sync-keywords-overwrite" className="font-normal text-sm">
                覆盖目标账号已有词条（默认追加并去重）
              </Label>
            </div>
            <div className="flex items-center space-x-2 border-t pt-2">
              <Checkbox id="sync-keywords-all" checked={allSelected} onCheckedChange={toggleAll} />
              <Label htmlFor="sync-keywords-all" className="font-medium text-sm">
                全选
              </Label>
            </div>
            <ScrollArea className="max-h-56 rounded-md border">
              <div className="space-y-1 p-2">
                {targets.map(acc => {
                  const count = contexts[acc.id]?.config.filterKeywords?.length ?? 0
                  return (
                    <div
                      key={acc.id}
                      className="flex items-center space-x-2 rounded px-2 py-1.5 hover:bg-accent"
                    >
                      <Checkbox
                        id={`sync-keywords-${acc.id}`}
                        checked={selected.includes(acc.id)}
                        onCheckedChange={(v: boolean | 'indeterminate') =>
                          toggle(acc.id, v === true)
                        }
                      />
                      <Label
                        htmlFor={`sync-keywords-${acc.id}`}
                        className="flex-1 cursor-pointer text-sm font-normal"
                      >
                        {acc.name}
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        {count ? `已有 ${count} 条` : '暂无'}
                      </span>
                    </div>
                  )
                })}
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
