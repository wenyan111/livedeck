import { useDebounceFn } from 'ahooks'
import { Play, Square } from 'lucide-react'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'

export function TaskButton({
  isTaskRunning,
  onStartStop,
  forbidden = false,
  forbiddenTip,
}: {
  isTaskRunning: boolean
  onStartStop: () => void
  forbidden?: boolean
  /** forbidden 为 true 时提示的原因，只有传了才代替默认的「请先连接直播控制台」 */
  forbiddenTip?: string
}) {
  const isConnected = useCurrentLiveControl(context => context.isConnected)
  const debouncedFn = useDebounceFn(onStartStop, {
    wait: 500,
    leading: true,
    trailing: false,
  })
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              variant={isTaskRunning ? 'destructive' : 'success'}
              onClick={() => debouncedFn.run()}
              disabled={forbidden || isConnected !== 'connected'}
            >
              {isTaskRunning ? (
                <>
                  {/* 主操作图标保留实心（fill-current），与常规线性图标区分层级 */}
                  <Square className="mr-2 h-4 w-4 fill-current" />
                  停止任务
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4 fill-current" />
                  开始任务
                </>
              )}
            </Button>
          </span>
        </TooltipTrigger>
        {forbidden && forbiddenTip ? (
          <TooltipContent>
            <p className="max-w-xs">{forbiddenTip}</p>
          </TooltipContent>
        ) : (
          isConnected !== 'connected' && (
            <TooltipContent>
              <p>请先连接直播控制台</p>
            </TooltipContent>
          )
        )}
      </Tooltip>
    </TooltipProvider>
  )
}
