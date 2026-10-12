import { useMemoizedFn } from 'ahooks'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { useChromeConfigStore } from './useChromeConfig'
import { useLiveControlStore } from './useLiveControl'

/**
 * 按「账号」维度连接 / 断开中控台。
 *
 * 与首页「打开中控台」的区别：首页那份只操作「当前账号」
 * （走 useCurrentLiveControlActions，读写 currentAccountId 对应的上下文），
 * 这里显式传入 accountId，供「中控台管理」一次性连接 / 断开多个账号。
 *
 * 每个账号用各自的平台（存于 live-control store）与浏览器配置（chrome-config store），
 * 互不代入 —— 连接多个账号时不会串用同一个平台/登录态。
 */
export function useConnectLiveControl() {
  /** 连接单个账号，返回是否成功（失败原因由主进程日志给出） */
  const connectAccount = useMemoizedFn(async (account: Account): Promise<boolean> => {
    const { contexts, setIsConnected } = useLiveControlStore.getState()
    const platform = contexts[account.id]?.platform
    if (!platform) {
      return false
    }
    const chrome = useChromeConfigStore.getState().contexts[account.id]
    // 淘宝会触发人机验证，强制有头模式（与首页「打开中控台」保持一致）
    const headless = platform === 'taobao' ? false : (chrome?.headless ?? false)
    setIsConnected(account.id, 'connecting')
    try {
      const ok = await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.liveControl.connect, {
        headless,
        chromePath: chrome?.path ?? '',
        storageState: chrome?.storageState ?? '',
        platform,
        account,
      })
      setIsConnected(account.id, ok ? 'connected' : 'disconnected')
      return Boolean(ok)
    } catch {
      setIsConnected(account.id, 'disconnected')
      return false
    }
  })

  /** 断开单个账号 */
  const disconnectAccount = useMemoizedFn(async (accountId: string): Promise<boolean> => {
    const { setIsConnected } = useLiveControlStore.getState()
    try {
      const ok = await window.ipcRenderer.invoke(
        IPC_CHANNELS.tasks.liveControl.disconnect,
        accountId,
      )
      return Boolean(ok)
    } catch {
      return false
    } finally {
      setIsConnected(accountId, 'disconnected')
    }
  })

  return { connectAccount, disconnectAccount }
}
