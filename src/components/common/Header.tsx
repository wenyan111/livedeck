import { Package } from 'lucide-react'
import { AccountSwitcher } from './AccountSwitcher'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { cn } from '@/lib/utils'

export function Header() {
  const isConnected = useCurrentLiveControl(context => context.isConnected)

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
      </div>
    </header>
  )
}
