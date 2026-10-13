import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { type RefObject, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** 一次命中的信息：位置、所在行号、该行原文、命中在该行内的偏移 */
type PromptMatch = {
  start: number
  end: number
  line: number
  lineText: string
  offsetInLine: number
}

const MAX_MATCHES = 300

function findMatches(text: string, rawQuery: string): PromptMatch[] {
  const query = rawQuery.trim()
  if (!query) return []
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  const out: PromptMatch[] = []
  let from = 0
  while (out.length < MAX_MATCHES) {
    const idx = haystack.indexOf(needle, from)
    if (idx === -1) break
    const before = text.slice(0, idx)
    // 行号从 1 起，和心里数的行号一致
    const line = before.split('\n').length
    const lineStart = before.lastIndexOf('\n') + 1
    const nextBreak = text.indexOf('\n', idx)
    const lineEnd = nextBreak === -1 ? text.length : nextBreak
    out.push({
      start: idx,
      end: idx + query.length,
      line,
      lineText: text.slice(lineStart, lineEnd),
      offsetInLine: idx - lineStart,
    })
    from = idx + query.length
  }
  return out
}

/**
 * 提示词查找。
 *
 * 提示词是一整块 textarea，条数多了以后要改某句话（比如改价格、改链接）
 * 只能靠肉眼扫，很容易漏改。这里把**所有命中一次性列出来**，
 * 点哪一条就定位选中哪一条，逐条核对，改没改全一目了然。
 */
export function PromptSearch({
  value,
  textareaRef,
}: {
  value: string
  textareaRef: RefObject<HTMLTextAreaElement | null>
}) {
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(0)

  const matches = useMemo(() => findMatches(value, query), [value, query])
  const keyword = query.trim()
  const total = matches.length
  // 提示词被编辑后命中数会变，把游标夹回合法范围
  const cursor = total === 0 ? -1 : Math.min(current, total - 1)

  const goTo = (index: number) => {
    const match = matches[index]
    const el = textareaRef.current
    if (!match || !el) return
    setCurrent(index)
    el.focus()
    el.setSelectionRange(match.start, match.end)
    // textarea 不会自动把选区滚进视野，按行号手动滚一下
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 20
    el.scrollTop = Math.max(0, (match.line - 1) * lineHeight - el.clientHeight / 3)
  }

  const step = (delta: number) => {
    if (total === 0) return
    goTo((cursor + delta + total) % total)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={e => {
              setQuery(e.target.value)
              setCurrent(0)
            }}
            placeholder="在提示词中查找（防止漏改），回车跳下一处"
            className="h-8 pl-8 pr-7 text-xs"
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                step(e.shiftKey ? -1 : 1)
              }
            }}
          />
          {keyword && (
            <button
              type="button"
              title="清空"
              onClick={() => {
                setQuery('')
                setCurrent(0)
              }}
              className="-translate-y-1/2 absolute top-1/2 right-2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {keyword ? (total > 0 ? `共 ${total} 处` : '无匹配') : ''}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title="上一处 (Shift+Enter)"
          disabled={total === 0}
          onClick={() => step(-1)}
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title="下一处 (Enter)"
          disabled={total === 0}
          onClick={() => step(1)}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </div>

      {keyword && total > 0 && (
        <div className="max-h-56 overflow-y-auto rounded-md border">
          {matches.map((match, index) => (
            <button
              key={match.start}
              type="button"
              onClick={() => goTo(index)}
              className={cn(
                'flex w-full items-start gap-2 px-2 py-1 text-left text-xs transition-colors hover:bg-accent',
                index === cursor && 'bg-accent',
              )}
            >
              <span className="w-8 shrink-0 text-right text-muted-foreground">{match.line}</span>
              <span className="min-w-0 flex-1 truncate">
                {match.lineText.slice(0, match.offsetInLine)}
                <mark className="rounded bg-brand/25 px-0.5 text-brand">
                  {match.lineText.slice(match.offsetInLine, match.offsetInLine + keyword.length)}
                </mark>
                {match.lineText.slice(match.offsetInLine + keyword.length)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
