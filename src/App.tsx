import { RefreshCwIcon, TerminalIcon } from 'lucide-react'
import { Outlet, useLocation } from 'react-router'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import LogDisplayer from '@/components/common/LogDisplayer'
import Sidebar from '@/components/common/Sidebar'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Toaster } from '@/components/ui/toaster'
import { useDevMode } from '@/hooks/useDevMode'
import { Header } from './components/common/Header'
import LogPanel from './components/common/LogPanel'
import { useIpcListener } from './hooks/useIpc'
import './App.css'
import { useEffect } from 'react'
import { UpdateDialog } from './components/update/UpdateDialog'
import { useAccounts } from './hooks/useAccounts'
import { useAutoMessageStore } from './hooks/useAutoMessage'
import { useAutoPopUpStore } from './hooks/useAutoPopUp'
import { useAutoReply, useAutoReplyStore } from './hooks/useAutoReply'
import { useChromeConfigStore } from './hooks/useChromeConfig'
import { useLiveControlStore } from './hooks/useLiveControl'
import { useOpenPriceLinkageGlobal } from './hooks/useOpenPriceLinkage'
import { useOpenPriceScriptStore, useOpenPriceStatusSync } from './hooks/useOpenPriceScript'
import { markDisconnectedTasks, useQuickStartAutoStart } from './hooks/useQuickStart'
import { useApplyTheme } from './hooks/useAppearance'
import { useToast } from './hooks/useToast'
import { useUpdateConfigStore, useUpdateStore } from './hooks/useUpdate'

function useGlobalIpcListener() {
  const { handleComment } = useAutoReply()
  const { setIsListening } = useAutoReplyStore()
  const { setIsConnected, setAccountName } = useLiveControlStore()
  const setIsRunningAutoMessage = useAutoMessageStore(s => s.setIsRunning)
  const setIsRunningAutoPopUp = useAutoPopUpStore(s => s.setIsRunning)
  const setStorageState = useChromeConfigStore(s => s.setStorageState)
  const enableAutoCheckUpdate = useUpdateConfigStore(s => s.enableAutoCheckUpdate)
  const handleUpdate = useUpdateStore.use.handleUpdate()
  const { toast } = useToast()

  useIpcListener(IPC_CHANNELS.tasks.autoReply.showComment, ({ comment, accountId }) => {
    handleComment(comment, accountId)
  })

  useIpcListener(IPC_CHANNELS.tasks.liveControl.disconnectedEvent, (id, resumableTaskTypes) => {
    setIsConnected(id, 'disconnected')
    // 断线会把所有任务停掉，界面状态必须跟着复位——
    // 否则会显示成「还在监听 / 还在运行」，用户根本不知道要重开
    //（历史上就因此漏掉了「自动回复」，一整段时间一条弹幕都没进来）。
    setIsListening(id, 'stopped')
    setIsRunningAutoMessage(id, false)
    setIsRunningAutoPopUp(id, false)
    useOpenPriceScriptStore.getState().setRunning(id, false)
    // 记下断线前的现场，重连成功后自动恢复
    markDisconnectedTasks(id, resumableTaskTypes ?? [])
    toast.error('直播控制台已断开连接')
  })

  useIpcListener(IPC_CHANNELS.tasks.autoMessage.stoppedEvent, id => {
    setIsRunningAutoMessage(id, false)
    toast.error('自动发言已停止')
  })

  useIpcListener(IPC_CHANNELS.tasks.autoMessage.openPriceWarmupTriggered, _id => {
    toast.success('检测到开价变预热，已自动发送全部话术')
  })

  // 开价监听失效 / 恢复：让界面状态如实反映页面里的监听脚本是否还活着
  useIpcListener(IPC_CHANNELS.tasks.autoMessage.openPriceWatcherLost, id => {
    useOpenPriceScriptStore
      .getState()
      .setError(id, '开价监听已失效（页面已重载），请到开价话术页重新开启')
    toast.error('开价监听已失效，请到「开价话术」页重新开启')
  })

  useIpcListener(IPC_CHANNELS.tasks.autoMessage.openPriceWatcherRestored, id => {
    const store = useOpenPriceScriptStore.getState()
    store.setError(id, null)
    store.setRunning(id, true)
    toast.success('开价监听已自动恢复')
  })

  useIpcListener(IPC_CHANNELS.tasks.autoPopUp.stoppedEvent, id => {
    setIsRunningAutoPopUp(id, false)
    toast.error('自动弹窗已停止')
  })

  useIpcListener(IPC_CHANNELS.tasks.autoReply.listenerStopped, id => {
    setIsListening(id, 'stopped')
  })

  useIpcListener(IPC_CHANNELS.chrome.saveState, (id, state) => {
    setStorageState(id, state)
  })

  useIpcListener(IPC_CHANNELS.tasks.liveControl.notifyAccountName, params => {
    if (params.ok) {
      setAccountName(params.accountId, params.accountName || '')
    }
  })

  useIpcListener(IPC_CHANNELS.app.notifyUpdate, info => {
    if (enableAutoCheckUpdate) {
      handleUpdate(info)
    }
  })
}

function App() {
  const { enabled: devMode } = useDevMode()
  const location = useLocation()
  const { accounts, currentAccountId } = useAccounts()

  useEffect(() => {
    const account = accounts.find(acc => acc.id === currentAccountId)
    if (account) {
      window.ipcRenderer.invoke(IPC_CHANNELS.account.switch, { account })
    }
  }, [accounts, currentAccountId])

  useGlobalIpcListener()
  // 跨平台开价联动需要在任意页面都能响应，因此挂在这里常驻
  useOpenPriceLinkageGlobal()
  // 开价话术的运行状态校正也常驻：切账号 / 重连后绿点才不会显示成别的账号的状态
  useOpenPriceStatusSync()
  // 连接中控台成功后，按首页「一键开启」的勾选自动启动功能
  useQuickStartAutoStart()
  // 应用外观主题（深色背景）：挂载时与每次切换时同步 .dark 类
  useApplyTheme()

  const handleRefresh = () => {
    window.location.reload()
  }

  const handleToggleDevTools = async () => {
    await window.ipcRenderer.invoke(IPC_CHANNELS.chrome.toggleDevTools)
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger disabled={!devMode} className="min-h-screen">
          <div className="flex flex-col h-screen bg-background">
            {/* 头部标题 */}
            <Header />

            {/* 主体内容 */}
            <div className="flex-1 flex overflow-hidden">
              {/* 侧边栏 */}
              <Sidebar />

              {/* 主要内容区域 */}
              <main className="flex-1 overflow-y-auto p-8">
                <div key={location.pathname} className="page-fade h-full">
                  <Outlet />
                </div>
              </main>
            </div>

            {/* 下半部分：日志面板（可折叠 / 拖拽调高） */}
            <LogPanel />
          </div>
          <UpdateDialog />
        </ContextMenuTrigger>
        {devMode && (
          <ContextMenuContent>
            <ContextMenuItem onClick={handleRefresh}>
              <RefreshCwIcon className="mr-2 h-4 w-4" />
              <span>刷新页面</span>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={handleToggleDevTools}>
              <TerminalIcon className="mr-2 h-4 w-4" />
              <span>开发者工具</span>
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>
      <Toaster />
    </>
  )
}

export default App
