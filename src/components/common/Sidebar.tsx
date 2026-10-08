import {
  AppWindow,
  Bot,
  FileSpreadsheet,
  Gift,
  LayoutDashboard,
  MessageSquare,
  Rocket,
  Settings,
  Sparkles,
} from 'lucide-react'
import { NavLink } from 'react-router'
import { autoReplyPlatforms, openPricePlatforms } from '@/abilities'
import { useCurrentAutoMessage } from '@/hooks/useAutoMessage'
import { useCurrentAutoPopUp } from '@/hooks/useAutoPopUp'
import { useAutoReply } from '@/hooks/useAutoReply'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { useCurrentOpenPriceRuntime } from '@/hooks/useOpenPriceScript'
import { cn } from '@/lib/utils'

type SidebarGroup = '中控管理' | '自动化' | '智能与设置'

/** 侧边栏分组顺序（结构参考豆包方案，视觉沿用本项目品牌色） */
const SIDEBAR_GROUPS: readonly SidebarGroup[] = ['中控管理', '自动化', '智能与设置']

interface SidebarTab {
  id: string
  name: string
  group: SidebarGroup
  isRunning?: boolean
  /** 开启失败：显示红点而不是绿点 */
  hasError?: boolean
  /** 小圆点的悬浮提示（失败原因） */
  statusTip?: string
  icon: React.ReactNode
  platform?: LiveControlPlatform[]
}

export default function Sidebar() {
  const isAutoMessageRunning = useCurrentAutoMessage(context => context.isRunning)
  const isAutoPopupRunning = useCurrentAutoPopUp(context => context.isRunning)
  const { isRunning: isAutoReplyRunning } = useAutoReply()
  const platform = useCurrentLiveControl(context => context.platform)
  const isConnected = useCurrentLiveControl(context => context.isConnected)
  // 开价话术的状态按账号隔离：绿点 = 监听中，红点 = 开启失败
  const { isRunning: isOpenPriceRunning, error: openPriceError } = useCurrentOpenPriceRuntime()
  const isOpenPriceScriptRunning = isOpenPriceRunning && isConnected === 'connected'
  const isOpenPriceScriptFailed = Boolean(openPriceError) && isConnected === 'connected'

  const tabs: SidebarTab[] = [
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
              <h2 className="px-2 pb-2 pt-4 text-[11px] font-medium tracking-[0.12em] text-muted-foreground/70">
                {group}
              </h2>
              <nav className="space-y-1">
                {groupTabs.map(tab => (
                  <NavLink
                    key={tab.id}
                    to={tab.id}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-sm transition-colors',
                        isActive
                          ? 'border-brand bg-muted text-foreground'
                          : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={cn(
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
                            isActive
                              ? 'bg-brand/[0.14] text-brand'
                              : 'bg-transparent text-muted-foreground',
                          )}
                        >
                          {tab.icon}
                        </span>
                        <span className="flex-1 font-medium">{tab.name}</span>
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
                    )}
                  </NavLink>
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
