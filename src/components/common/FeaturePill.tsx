import { cn } from '@/lib/utils'

interface FeaturePillProps {
  /** 功能名，直接作为胶囊文字 */
  label: string
  /** 是否已勾选（勾选 = 珊瑚色实心胶囊） */
  checked: boolean
  onToggle: () => void
  /** 禁用（如开价话术在不支持自检的平台）：灰色不可点 */
  disabled?: boolean
  /** 禁用时鼠标悬停的说明 */
  disabledTitle?: string
  /** 是否已连接中控台：未连接不显示状态点 */
  connected?: boolean
  /** 是否正在运行：已连接且运行时亮绿点 */
  running?: boolean
  /** 开启失败原因：已连接且失败时亮红点 */
  error?: string | null
  id?: string
  /** 尺寸：sm=小号（默认，中控台管理账号行用），lg=大号（一键开启卡片用） */
  size?: 'sm' | 'lg'
}

/**
 * 功能勾选胶囊 —— 「一键开启」卡片与「中控台管理」账号行下方的功能勾选共用同一个组件，
 * 保证两处视觉与交互完全一致（改一处即两处同步）。
 *
 * 已勾选 = 珊瑚色实心胶囊（品牌色），未勾选 = 浅描边；运行中亮绿点、开启失败亮红点。
 * 用品牌色而非绿色表示「已勾选」，与「运行中绿点 / 停止红色」的语义区分开，一眼可辨。
 */
export default function FeaturePill({
  label,
  checked,
  onToggle,
  disabled = false,
  disabledTitle,
  connected = false,
  running = false,
  error,
  id,
  size = 'sm',
}: FeaturePillProps) {
  // sm=原尺寸（中控台管理），lg=加大版（一键开启卡片）
  const sizeCls = size === 'lg' ? 'gap-2 px-3.5 py-1.5 text-sm' : 'gap-1.5 px-2.5 py-[3px] text-xs'
  const dotCls = size === 'lg' ? 'h-2 w-2' : 'h-1.5 w-1.5'
  return (
    <button
      type="button"
      id={id}
      disabled={disabled}
      title={disabled ? disabledTitle : (error ?? undefined)}
      onClick={onToggle}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border leading-none transition-colors',
        sizeCls,
        disabled
          ? 'cursor-not-allowed border-border/40 text-muted-foreground/50'
          : checked
            ? 'border-brand/45 bg-brand/15 font-medium text-brand hover:bg-brand/25'
            : 'border-border/40 text-muted-foreground hover:border-border hover:text-foreground',
      )}
    >
      {/* 运行中亮绿点、开启失败亮红点（未连接一律不亮）：一眼看出该账号下哪些功能真跑起来了 */}
      {connected && running ? (
        <span className={`${dotCls} shrink-0 rounded-full bg-success`} title="运行中" />
      ) : connected && error ? (
        <span className={`${dotCls} shrink-0 rounded-full bg-destructive`} title={error} />
      ) : null}
      {label}
    </button>
  )
}
