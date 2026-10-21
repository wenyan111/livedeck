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
  /**
   * 紧凑档位（仅 sm 生效）：窄屏时由父容器按实测宽度自动降档，
   * 让 4 个胶囊始终排在同一行而不是换行/被挤出。
   */
  density?: 'default' | 'compact' | 'tiny'
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
  density = 'default',
}: FeaturePillProps) {
  // sm 分三档：standard / compact / tiny。窄屏降档只压内边距与字号，不换行，
  // 保证账号行里的 4 个功能胶囊永远排在同一行（放不下就小一点）。
  const sizeCls =
    size === 'lg'
      ? 'gap-2 px-3.5 py-1.5 text-sm'
      : density === 'tiny'
        ? 'gap-[3px] px-1.5 py-[1.5px] text-[10px]'
        : density === 'compact'
          ? 'gap-1 px-2 py-[2px] text-[11px]'
          : 'gap-1.5 px-2.5 py-[3px] text-xs'
  const dotCls = size === 'lg' ? 'h-2 w-2' : density === 'tiny' ? 'h-1 w-1' : 'h-1.5 w-1.5'
  return (
    <button
      type="button"
      id={id}
      disabled={disabled}
      title={disabled ? disabledTitle : (error ?? undefined)}
      onClick={onToggle}
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border leading-none transition-colors',
        sizeCls,
        disabled
          ? 'cursor-not-allowed border-foreground/30 text-muted-foreground/50'
          : checked
            ? 'border-brand/45 bg-brand/15 font-medium text-brand hover:bg-brand/25'
            : // 未勾选：描边用「前景色」——浅色模式=黑边、深色模式=白边，随主题切换。
              // 这样未勾选胶囊也有清晰描边，和已勾选（珊瑚描边）一样都是 1px 边框，视觉大小/尺寸完全一致。
              'border-foreground text-muted-foreground hover:text-foreground',
      )}
    >
      {/* 状态点：运行中=绿、开启失败=红、未运行/未勾选/未连接=灰。
          始终渲染（不再有「无点」分支），保证所有胶囊等宽、跨行严格对齐。 */}
      <span
        className={cn(
          dotCls,
          'shrink-0 rounded-full',
          running ? 'bg-success' : error ? 'bg-destructive' : 'bg-muted-foreground/50',
        )}
        title={running ? '运行中' : error ? (error ?? '运行失败') : connected ? '未运行' : '未连接'}
      />
      {label}
    </button>
  )
}
