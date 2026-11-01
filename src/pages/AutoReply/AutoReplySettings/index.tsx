import { ArrowLeft } from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { mentionPlatforms } from '@/abilities'
import { Button } from '@/components/ui/button'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { cn } from '@/lib/utils'

/**
 * 自动回复设置的外壳：每个分组是**独立页面**（子路由），
 * 这里只负责标题、分组切换和内容出口。
 *
 * 为什么拆开（2026-11-01 用户要求）：原来 9 块内容堆在一页里靠分隔线隔开，
 * 一屏滚不完也不好找，所以按侧栏子项拆成独立页面，一页只做一件事。
 */
type Section = { path: string; label: string; needMention?: boolean }

const SECTIONS: Section[] = [
  { path: 'keyword', label: '关键词回复' },
  { path: 'ai', label: 'AI 回复' },
  { path: 'filter', label: '过滤与黑名单' },
  { path: 'mention', label: '@ 回复', needMention: true },
  { path: 'platform', label: '平台专属' },
]

export default function AutoReplySettings() {
  const navigate = useNavigate()
  const platform = useCurrentLiveControl(ctx => ctx.platform)
  const showMention = platform ? mentionPlatforms.includes(platform) : false

  return (
    <div className="container py-8 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} title="返回">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">自动回复设置</h1>
      </div>

      {/* 分组切换：只换下面的页面内容，不把内容堆在一起 */}
      <div className="flex flex-wrap gap-1 border-b pb-2">
        {SECTIONS.filter(s => !s.needMention || showMention).map(section => (
          <NavLink
            key={section.path}
            to={section.path}
            className={({ isActive }) =>
              cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                isActive
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )
            }
          >
            {section.label}
          </NavLink>
        ))}
      </div>

      <div className="pt-2">
        <Outlet />
      </div>
    </div>
  )
}
