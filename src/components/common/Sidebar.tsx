import {
  AppWindow,
  ArrowLeftRight,
  Bot,
  ChevronDown,
  FileSpreadsheet,
  Gift,
  LayoutDashboard,
  MessageSquare,
  MonitorSmartphone,
  Rocket,
  Settings,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { autoReplyPlatforms, openPricePlatforms } from '@/abilities'
import { useCurrentAutoMessage } from '@/hooks/useAutoMessage'
import { useCurrentAutoPopUp } from '@/hooks/useAutoPopUp'
import { useAutoReply } from '@/hooks/useAutoReply'
import { useAutoReplyConfig } from '@/hooks/useAutoReplyConfig'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { useCurrentOpenPriceRuntime } from '@/hooks/useOpenPriceScript'
import { cn } from '@/lib/utils'

type SidebarGroup = '中控管理' | '自动化' | '智能与设置'

/** 侧边栏分组顺序（结构参考豆包方案，视觉沿用本项目品牌色） */
const SIDEBAR_GROUPS: readonly SidebarGroup[] = ['中控管理', '自动化', '智能与设置']

/** 侧栏二级子项：跳到设置页的某个锚点，右侧可带「已配几条」这类摘要 */
interface SidebarChild {
  /** 锚点名（/auto-reply/settings#<hash>） */
  hash: string
  label: string
  badge?: string | number | null
}

interface SidebarTab {
  id: string
  name: string
  group: SidebarGroup
  /** 可展开的子项（目前只有「自动回复」用） */
  children?: SidebarChild[]
  isRunning?: boolean
  /** 开启失败：显示红点而不是绿点 */
  hasError?: boolean
  /** 小圆点的悬浮提示（失败原因） */
  statusTip?: string
  icon: React.ReactNode
  platform?: LiveControlPlatform[]
}

export default function Sidebar() {
  // 进了 /auto-reply/settings/xxx 时，父项「自动回复」也要保持高亮，
  // 否则侧栏一处高光都没有，人不知道自己在哪
  const location = useLocation()
  const isAutoMessageRunning = useCurrentAutoMessage(context => context.isRunning)
  const isAutoPopupRunning = useCurrentAutoPopUp(context => context.isRunning)
  const { isRunning: isAutoReplyRunning } = useAutoReply()
  const platform = useCurrentLiveControl(context => context.platform)
  const isConnected = useCurrentLiveControl(context => context.isConnected)
  // 开价话术的状态按账号隔离：绿点 = 监听中，红点 = 开启失败
  const { isRunning: isOpenPriceRunning, error: openPriceError } = useCurrentOpenPriceRuntime()
  const isOpenPriceScriptRunning = isOpenPriceRunning && isConnected === 'connected'
  const isOpenPriceScriptFailed = Boolean(openPriceError) && isConnected === 'connected'

  // 「自动回复」的子项摘要（随账号切换自动变，因为 config 是按账号存的）
  const { config: autoReplyConfig } = useAutoReplyConfig()
  const keywordCount = autoReplyConfig.comment.keywordReply.rules.length
  const filterCount = autoReplyConfig.filterKeywords.length + autoReplyConfig.blockList.length

  // 展开状态记在本地，下次进来保持一致（默认展开，方便发现子项）
  const [autoReplyOpen, setAutoReplyOpen] = useState(() => {
    try {
      return localStorage.getItem('sidebar-auto-reply-open') !== '0'
    } catch {
      return true
    }
  })
  const toggleAutoReply = () => {
    setAutoReplyOpen(prev => {
      const next = !prev
      try {
        localStorage.setItem('sidebar-auto-reply-open', next ? '1' : '0')
      } catch {
        // 隐私模式写不进去就算了
      }
      return next
    })
  }

  const tabs: SidebarTab[] = [
    {
      id: '/live-control-manage',
      name: '中控台管理',
      group: '中控管理',
      icon: <MonitorSmartphone className="h-[18px] w-[18px]" />,
    },
    {
      id: '/',
      name: '打开中控台',
      group: '中控管理',
      icon: <LayoutDashboard className="h-[18px] w-[18px]" />,
    },
    {
      id: '/data-entry',
      name: '直播日报',
      group: '中控管理',
      icon: <FileSpreadsheet className="h-[18px] w-[18px]" />,
    },
    {
      id: '/auto-message',
      name: '自动发言',
      group: '自动化',
      isRunning: isAutoMessageRunning,
      icon: <MessageSquare className="h-[18px] w-[18px]" />,
    },
    {
      id: '/open-price-script',
      name: '开价话术',
      group: '自动化',
      isRunning: isOpenPriceScriptRunning,
      hasError: isOpenPriceScriptFailed,
      statusTip: openPriceError ?? undefined,
      icon: <Rocket className="h-[18px] w-[18px]" />,
      // 所有能发言的平台都要能进这个页面配置自己的话术（联动时用），
      // 不能自己检测开价的平台（快手 / 小红书等）靠跨平台联动触发发送
      platform: openPricePlatforms,
    },
    {
      id: '/auto-popup',
      name: '自动弹窗',
      group: '自动化',
      isRunning: isAutoPopupRunning,
      icon: <AppWindow className="h-[18px] w-[18px]" />,
    },
    {
      id: '/auto-reply',
      name: '自动回复',
      group: '自动化',
      isRunning: isAutoReplyRunning,
      icon: <Bot className="h-[18px] w-[18px]" />,
      platform: autoReplyPlatforms,
      children: [
        { hash: 'keyword', label: '关键词回复', badge: keywordCount || null },
        {
          hash: 'ai',
          label: 'AI 回复',
          badge: autoReplyConfig.comment.aiReply.enable ? '开' : null,
        },
        { hash: 'filter', label: '过滤与黑名单', badge: filterCount || null },
        {
          hash: 'mention',
          label: '@ 回复',
          badge: autoReplyConfig.comment.mentionReply.enable ? '开' : null,
        },
        { hash: 'platform', label: '平台专属' },
      ],
    },
    {
      id: '/red-packet',
      name: '一键发红包',
      group: '自动化',
      icon: <Gift className="h-[18px] w-[18px]" />,
      platform: ['douyin', 'buyin'],
    },
    {
      id: '/ai-chat',
      name: 'AI 助手',
      group: '智能与设置',
      icon: <Sparkles className="h-[18px] w-[18px]" />,
    },
    {
      id: '/config-transfer',
      name: '数据迁移',
      group: '智能与设置',
      icon: <ArrowLeftRight className="h-[18px] w-[18px]" />,
    },
    {
      id: '/settings',
      name: '应用设置',
      group: '智能与设置',
      icon: <Settings className="h-[18px] w-[18px]" />,
    },
  ]

  const filteredTabs = tabs.filter(tab => {
    if (tab.platform) {
      return tab.platform.includes(platform)
    }
    return true
  })

  return (
    <aside className="sidebar-scroll flex w-64 min-w-[256px] shrink-0 flex-col overflow-y-auto border-r border-border bg-background">
      <div className="px-4 pb-4 pt-4">
        {SIDEBAR_GROUPS.map(group => {
          const groupTabs = filteredTabs.filter(tab => tab.group === group)
          // 该分组在当前平台下没有任何可用项时，整组隐藏（含分组标题）
          if (groupTabs.length === 0) return null
          return (
            <div key={group}>
              <h2 className="flex items-center gap-2 px-1 pb-2 pt-5 text-[11px] font-medium tracking-[0.14em] text-foreground/45">
                {group}
                <span className="h-px flex-1 bg-border/60" />
              </h2>
              <nav className="space-y-1.5">
                {groupTabs.map(tab => (
                  <div key={tab.id}>
                    <div className="relative">
                      <NavLink
                        to={tab.id}
                        className={({ isActive }) =>
                          cn(
                            // 卡片式条目：圆角 + 细边框 + 底色，和设置页的卡片同一种语言
                            'group flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors',
                            // 浅色主题里 --card 与 --background 都是纯白，只用 bg-card 等于没底色。
                            // 所以走 secondary（浅灰）+ primary 混合，深浅主题都能拉开层次。
                            isActive || (tab.children && location.pathname.startsWith(`${tab.id}/`))
                              ? 'border-primary/40 bg-secondary text-foreground'
                              : 'border-border bg-card text-muted-foreground hover:border-primary/25 hover:bg-secondary/60 hover:text-foreground',
                          )
                        }
                      >
                        {({ isActive }) => {
                          const groupActive =
                            isActive ||
                            Boolean(tab.children && location.pathname.startsWith(`${tab.id}/`))
                          return (
                            <>
                              {groupActive && (
                                <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
                              )}
                              <span
                                className={cn(
                                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
                                  groupActive
                                    ? 'bg-background text-foreground'
                                    : 'bg-transparent text-muted-foreground/80',
                                )}
                              >
                                {tab.icon}
                              </span>
                              <span
                                className={cn(
                                  'flex-1 truncate font-medium',
                                  tab.children && 'pr-5',
                                )}
                              >
                                {tab.name}
                              </span>
                              {tab.isRunning ? (
                                <span
                                  className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[hsl(var(--success))]"
                                  title="运行中"
                                />
                              ) : tab.hasError ? (
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--destructive))]"
                                  title={tab.statusTip ?? '开启失败'}
                                />
                              ) : null}
                            </>
                          )
                        }}
                      </NavLink>
                      {tab.children && tab.children.length > 0 && (
                        <button
                          type="button"
                          onClick={toggleAutoReply}
                          title={autoReplyOpen ? '收起子项' : '展开子项'}
                          className="absolute right-7 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
                        >
                          <ChevronDown
                            className={cn(
                              'h-3.5 w-3.5 transition-transform',
                              autoReplyOpen ? '' : '-rotate-90',
                            )}
                          />
                        </button>
                      )}
                    </div>
                    {tab.children && autoReplyOpen && (
                      <div className="mt-1.5 mb-2 ml-3 space-y-0.5 rounded-lg border border-border/70 bg-card p-1.5">
                        {tab.children.map(child => (
                          <NavLink
                            key={child.hash}
                            to={`${tab.id}/settings/${child.hash}`}
                            className={({ isActive }) =>
                              cn(
                                'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
                                isActive
                                  ? 'bg-secondary font-medium text-foreground'
                                  : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                              )
                            }
                          >
                            <span className="min-w-0 flex-1 truncate">{child.label}</span>
                            {child.badge != null && child.badge !== '' && (
                              <span className="shrink-0 rounded bg-background/70 px-1 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                                {child.badge}
                              </span>
                            )}
                          </NavLink>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </nav>
            </div>
          )
        })}
        {/* 底部留白：让最后一项在滚动到底时不被日志面板压住 */}
        <div className="h-6" />
      </div>
    </aside>
  )
}
