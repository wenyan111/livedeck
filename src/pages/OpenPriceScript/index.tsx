import { useMemoizedFn } from 'ahooks'
import { useEffect } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { openPriceSelfDetectPlatforms, platformLabels } from '@/abilities'
import { TaskButton } from '@/components/common/TaskButton'
import { Title } from '@/components/common/Title'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useAccounts } from '@/hooks/useAccounts'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import {
  buildOpenPriceSendMessages,
  useCurrentOpenPriceRuntime,
  useCurrentOpenPriceScript,
  useOpenPriceScriptTaskControl,
} from '@/hooks/useOpenPriceScript'
import MessageListCard from './components/MessageListCard'
import OpenPriceLinkageCard from './components/OpenPriceLinkageCard'
import OpenPriceSettingsCard from './components/OpenPriceSettingsCard'

export default function OpenPriceScript() {
  const messages = useCurrentOpenPriceScript(context => context.config.messages)
  const pinTopEnabled = useCurrentOpenPriceScript(context => context.config.pinTopEnabled ?? true)
  const { isRunning } = useCurrentOpenPriceRuntime()
  const isConnected = useCurrentLiveControl(context => context.isConnected)
  const platform = useCurrentLiveControl(context => context.platform)
  const { currentAccountId } = useAccounts()
  const { onStartTask, onStopTask } = useOpenPriceScriptTaskControl()

  // 快手 / 小红书 / 淘宝等平台没有开价监听，不能「开始任务」，
  // 但它们能发言，话术由「跨平台开价联动」在其他平台开价时触发发送。
  const canSelfDetect = openPriceSelfDetectPlatforms.includes(platform)
  const platformName = platformLabels[platform] ?? platform

  const handleTaskButtonClick = useMemoizedFn(() => {
    if (!isRunning) onStartTask()
    else onStopTask()
  })

  // 运行状态以主进程为准，由 App 层的 useOpenPriceStatusSync 在挂载 / 切账号时校正，
  // 这里只读当前账号的 runtime，不自己回查，避免覆盖其他账号的状态。

  // 运行中修改话术 / 置顶开关：实时同步到监听中的待发送列表
  useEffect(() => {
    if (!currentAccountId || !isRunning || isConnected !== 'connected') return
    window.ipcRenderer.invoke(
      IPC_CHANNELS.tasks.autoMessage.updateOpenPriceMessages,
      currentAccountId,
      buildOpenPriceSendMessages(messages, pinTopEnabled),
    )
  }, [currentAccountId, isRunning, isConnected, messages, pinTopEnabled])

  return (
    <div className="container py-8 space-y-4">
      <div className="flex items-center justify-between">
        <Title
          title="开价话术"
          description={
            canSelfDetect
              ? '直播中控台开始开价/讲解时自动发送配置的话术（抖音：「开价」变「预热」；视频号：「讲解」变「结束讲解」）'
              : `${platformName}无法自动检测开价，这里配置的话术会在其他平台开价时，由下方「跨平台开价联动」自动发送`
          }
        />
        <TaskButton
          isTaskRunning={isRunning}
          onStartStop={handleTaskButtonClick}
          forbidden={!canSelfDetect}
          forbiddenTip={`${platformName}无法自动检测开价，不能开启监听。在下方配置好话术，由「跨平台开价联动」在其他平台开价时触发发送即可`}
        />
      </div>
      {!canSelfDetect ? (
        <Alert>
          <AlertTitle>当前平台不支持自动检测开价</AlertTitle>
          <AlertDescription>
            {platformName}
            没有开价监听能力，因此不需要（也不能）开启任务。请在下方填写该平台要发的开价话术，
            并到「跨平台开价联动」里把它勾选为跟随平台；
            当触发源（如巨量百应）检测到开价时，它就会自动发出这里配置的话术。
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-6">
        <MessageListCard />
        <OpenPriceLinkageCard />
        <OpenPriceSettingsCard />
      </div>
    </div>
  )
}
