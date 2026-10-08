import { useLocalStorageState, useMemoizedFn } from 'ahooks'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { Message } from '@/hooks/useAutoMessage'
import { useOpenPriceScriptStore } from '@/hooks/useOpenPriceScript'
import MessageEditor from '@/pages/AutoMessage/components/MessageEditor'

/** 选择器里不能返回新数组，否则每次渲染引用都变，会触发无限重渲染 */
const EMPTY_MESSAGES: Message[] = []

/**
 * 指定账号的「开价话术」编辑器。
 *
 * 跨平台联动时，每个平台发的是**自己账号下配置的**话术，
 * 所以必须能在这里直接编辑「非当前账号」的话术，
 * 而不是切账号再去顶部的话术列表里填。
 */
export default function AccountScriptEditor({ accountId }: { accountId: string }) {
  // 展开状态按账号持久化（localStorage），展开后下次进入仍保持，
  // 不用每次都手动拉开才能看全部配置话术
  const [open, setOpen] = useLocalStorageState<boolean>(`open-price-script-editor:${accountId}`, {
    defaultValue: false,
  })
  // 只取原始引用（可能为 undefined），保证引用稳定
  const messages = useOpenPriceScriptStore(state => state.contexts[accountId]?.config.messages)
  const list = messages ?? EMPTY_MESSAGES

  const handleChange = useMemoizedFn((next: Message[]) => {
    useOpenPriceScriptStore.getState().setConfig(accountId, { messages: next })
  })

  const count = list.filter(m => m.content.trim() !== '').length

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
          {open ? (
            <ChevronDown className="mr-1 h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="mr-1 h-3.5 w-3.5" />
          )}
          开价话术
          <Badge
            variant={count > 0 ? 'default' : 'secondary'}
            className="ml-2 h-5 px-1.5 text-[10px]"
          >
            {count > 0 ? `${count} 条` : '未配置'}
          </Badge>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <MessageEditor messages={list} unlimitedLength={true} onChange={handleChange} />
        <p className="mt-1 text-xs text-muted-foreground">
          一行一条，首行将置顶。该平台联动时会发送这里配置的话术
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}
