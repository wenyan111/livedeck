import { useDebounceFn } from 'ahooks'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { CarbonPlayFilledAlt, CarbonStopFilledAlt } from '../icons/carbon'
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
                  <CarbonStopFilledAlt className="mr-2 h-4 w-4" />
                  停止任务
                </>
              ) : (
                <>
                  <CarbonPlayFilledAlt className="mr-2 h-4 w-4" />
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
