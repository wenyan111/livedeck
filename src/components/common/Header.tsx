import { Package } from 'lucide-react'
import { useLocation } from 'react-router'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { cn } from '@/lib/utils'
import { AccountSwitcher } from './AccountSwitcher'

/** 这些页面的主体本身就是「全账号」视图，头部的单账号切换/状态徽标在此没有意义（会误导） */
const HIDE_ACCOUNT_CONTROLS_ROUTES = ['/live-control-manage']

export function Header() {
  const location = useLocation()
  const isConnected = useCurrentLiveControl(context => context.isConnected)

  // 「中控台管理」页自己管理所有账号，隐藏头部这条围绕「当前账号」的控件
  const hideAccountControls = HIDE_ACCOUNT_CONTROLS_ROUTES.includes(location.pathname)

  const status =
    isConnected === 'connected'
      ? {
          label: '已连接',
          dot: 'bg-[hsl(var(--success))]',
          cls: 'text-[hsl(var(--success))] border-[hsl(var(--success)/0.3)] bg-[hsl(var(--success)/0.1)]',
        }
      : isConnected === 'connecting'
        ? {
            label: '连接中',
            dot: 'bg-[hsl(var(--warning))] animate-pulse',
            cls: 'text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.1)]',
          }
        : {
            label: '未连接',
            dot: 'bg-[hsl(var(--destructive))]',
            cls: 'text-[hsl(var(--destructive))] border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.1)]',
          }

  return (
    <header className="flex h-16 w-full items-center justify-between border-b border-border bg-background px-6">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-foreground">
          <Package className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-base font-semibold leading-tight text-foreground">直播助手</h1>
          <p className="text-[11px] leading-tight text-muted-foreground">直播中控工具</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* 「中控台管理」页自行管理全账号，头部这条围绕「当前账号」的控件在此无意义，隐藏 */}
        {!hideAccountControls && (
          <>
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                status.cls,
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />
              {status.label}
            </span>
            <AccountSwitcher />
          </>
        )}
      </div>
    </header>
  )
}
