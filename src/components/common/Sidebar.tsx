import {
  AppWindow,
  Bot,
  Gift,
  LayoutDashboard,
  MessageSquare,
  Rocket,
  Settings,
  Sparkles,
  Table,
} from 'lucide-react'
import { NavLink } from 'react-router'
import { autoReplyPlatforms, openPricePlatforms } from '@/abilities'
import { useCurrentAutoMessage } from '@/hooks/useAutoMessage'
import { useCurrentAutoPopUp } from '@/hooks/useAutoPopUp'
import { useAutoReply } from '@/hooks/useAutoReply'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { useCurrentOpenPriceRuntime } from '@/hooks/useOpenPriceScript'
import { cn } from '@/lib/utils'

interface SidebarTab {
  id: string
  name: string
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
      icon: <LayoutDashboard className="h-[18px] w-[18px]" />,
    },
    {
      id: '/auto-message',
      name: '自动发言',
      isRunning: isAutoMessageRunning,
      icon: <MessageSquare className="h-[18px] w-[18px]" />,
    },
    {
      id: '/open-price-script',
      name: '开价话术',
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
      isRunning: isAutoPopupRunning,
      icon: <AppWindow className="h-[18px] w-[18px]" />,
    },
    {
      id: '/auto-reply',
      name: '自动回复',
      isRunning: isAutoReplyRunning,
      icon: <Bot className="h-[18px] w-[18px]" />,
      platform: autoReplyPlatforms,
    },
    {
      id: '/red-packet',
      name: '一键发红包',
      icon: <Gift className="h-[18px] w-[18px]" />,
      platform: ['douyin', 'buyin'],
    },
    {
      id: '/data-entry',
      name: '直播日报',
      icon: <Table className="h-[18px] w-[18px]" />,
    },
    {
      id: '/ai-chat',
      name: 'AI 助手',
      icon: <Sparkles className="h-[18px] w-[18px]" />,
    },
    {
      id: '/settings',
      name: '应用设置',
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
      <div className="p-4">
        <h2 className="mb-3 px-2 text-xs font-medium tracking-wide text-muted-foreground">
          功能列表
        </h2>
        <nav className="space-y-1">
          {filteredTabs.map(tab => (
            <NavLink
              key={tab.id}
              to={tab.id}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-sm transition-colors',
                  isActive
                    ? 'border-foreground bg-muted text-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
                      isActive ? 'bg-background text-foreground shadow-xs' : 'bg-transparent text-muted-foreground',
                    )}
                  >
                    {tab.icon}
                  </span>
                  <span className="flex-1 font-medium">{tab.name}</span>
                  {tab.isRunning ? (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--success))] animate-pulse"
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
        {/* 底部留白：让最后一项在滚动到底时不被日志面板压住 */}
        <div className="h-6" />
      </div>
    </aside>
  )
}
