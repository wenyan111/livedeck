import { X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAutoReplyConfig } from '@/hooks/useAutoReplyConfig'

export function FilterKeywordsManager() {
  const { updateFilterKeywords, config } = useAutoReplyConfig()
  const filterKeywords = config.filterKeywords ?? []
  const [newKeyword, setNewKeyword] = useState('')
  const [newMatchType, setNewMatchType] = useState<'fuzzy' | 'exact' | 'regex'>('fuzzy')

  const handleAddKeyword = () => {
    const trimmed = newKeyword.trim()
    if (!trimmed) {
      return
    }

    // 检查重复 (只比较文本)
    const isDuplicate = filterKeywords.some(kw => {
      const text = typeof kw === 'string' ? kw : kw.text
      return text === trimmed
    })

    if (isDuplicate) {
      setNewKeyword('')
      return
    }

    const updatedList = [...filterKeywords, { text: trimmed, matchType: newMatchType }]
    updateFilterKeywords(updatedList)
    setNewKeyword('')
  }

  const handleRemoveKeyword = (index: number) => {
    const updatedList = filterKeywords.filter((_, i) => i !== index)
    updateFilterKeywords(updatedList)
  }

  const handleToggleMatchType = (index: number) => {
    const updatedList = filterKeywords.map((kw, i) => {
      if (i !== index) return kw
      const isString = typeof kw === 'string'
      const text = isString ? kw : kw.text
      const currentType = isString ? 'fuzzy' : kw.matchType
      const nextType: 'exact' | 'fuzzy' | 'regex' =
        currentType === 'fuzzy' ? 'exact' : currentType === 'exact' ? 'regex' : 'fuzzy'
      return { text, matchType: nextType }
    })
    updateFilterKeywords(updatedList)
  }

  const getBadgeClass = (type: 'exact' | 'fuzzy' | 'regex') => {
    switch (type) {
    case 'exact':
      return 'bg-warning/10 text-warning border-warning/30 hover:bg-warning/15'
    case 'regex':
      return 'bg-accent/60 text-accent-foreground border-border hover:bg-accent'
    default:
      return 'bg-muted text-muted-foreground border-border hover:bg-muted/70'
    }
  }

  const getBadgeLabel = (type: 'exact' | 'fuzzy' | 'regex') => {
    switch (type) {
      case 'exact':
        return '精准'
      case 'regex':
        return '正则'
      default:
        return '模糊'
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">弹幕过滤关键词</h3>
        <p className="text-sm text-muted-foreground">
          如果观众发送的弹幕符合以下过滤规则，则跳过不回复。可点击标签切换匹配模式：
        </p>
      </div>

      <div className="space-y-2 max-h-[200px] overflow-y-auto border rounded-md p-2">
        {filterKeywords.length === 0 ? (
          <div className="text-sm text-center py-4 text-muted-foreground">暂无过滤条件</div>
        ) : (
          filterKeywords.map((keyword, index) => {
            const isString = typeof keyword === 'string'
            const text = isString ? keyword : keyword.text
            const matchType = isString ? 'fuzzy' : keyword.matchType

            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: 下标无妨
              <div key={index} className="flex items-center gap-2 group">
                <div className="flex-1 text-sm p-2 rounded bg-muted/50 flex items-center justify-between">
                  <span className="font-mono">{text}</span>
                  <button
                    type="button"
                    onClick={() => handleToggleMatchType(index)}
                    className={`text-[10px] px-2 py-0.5 rounded border font-medium cursor-pointer transition-colors select-none ${getBadgeClass(
                      matchType,
                    )}`}
                    title="点击切换过滤类型（模糊 / 精准 / 正则）"
                  >
                    {getBadgeLabel(matchType)}
                  </button>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleRemoveKeyword(index)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )
          })
        )}
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder={
            newMatchType === 'exact'
              ? '输入精准匹配的内容（如：1 2 3，必须完全一致）...'
              : newMatchType === 'regex'
                ? '输入正则表达式（如：/\\d+/）...'
                : '输入包含关键词（如：广告，包含即过滤）...'
          }
          value={newKeyword}
          onChange={e => setNewKeyword(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              handleAddKeyword()
            }
          }}
          className="flex-1"
        />
        <select
          value={newMatchType}
          onChange={e => setNewMatchType(e.target.value as 'exact' | 'fuzzy' | 'regex')}
          className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring cursor-pointer hover:bg-muted/50"
        >
          <option value="fuzzy">模糊匹配</option>
          <option value="exact">精准匹配</option>
          <option value="regex">正则匹配</option>
        </select>
        <Button onClick={handleAddKeyword}>添加</Button>
      </div>
    </div>
  )
}
