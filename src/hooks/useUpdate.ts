import { IPC_CHANNELS } from 'shared/ipcChannels'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { createSelectors } from '@/utils/zustand'

export type UpdateStatus =
  | 'idle' // 空闲
  | 'checking' // 通过 CDN 简单检查最新版本号
  | 'available' // 有可用更新 (已获取到信息，等待用户确认)
  | 'preparing' // 用户点击更新后，正在请求 Electron-Updater 确认链接
  | 'downloading' // 正在下载
  | 'ready' // 下载完成，等待重启
  | 'error' // 发生错误

export interface VersionState {
  currentVersion: string
  latestVersion: string
  releaseNote?: string
}

interface UpdateState {
  status: UpdateStatus
  versionInfo: VersionState | null
  progress: number
  error: ErrorType | null
  source: string
}

interface UpdateAction {
  checkUpdateManually: () => Promise<{ upToDate: boolean } | undefined>
  startDownload: (source: string) => void
  installUpdate: () => void
  setProgress: (progress: number) => void
  setStatus: (status: UpdateStatus) => void
  reset: () => void
  handleError: (error: ErrorType) => void
  handleUpdate: (info: VersionState) => void
  setSource: (source: string) => void
}

type UpdateStore = UpdateState & UpdateAction

const useUpdateStoreBase = create<UpdateStore>()((set, get) => ({
  status: 'idle',
  versionInfo: null,
  progress: 0,
  error: null,
  source: 'github',

  checkUpdateManually: async () => {
    set({ status: 'checking', error: null })
    try {
      // 这里只获取信息，不触发 electron-updater
      const result = await window.ipcRenderer.invoke(IPC_CHANNELS.updater.checkUpdate)
      if (result) {
        set({ status: 'available', versionInfo: result })
      } else {
        set({ status: 'idle' })
        return { upToDate: true }
      }
    } catch (e) {
      set({ status: 'error', error: { message: (e as Error).message || '检查更新失败' } })
    }
  },
  startDownload: (source: string) => {
    set({ status: 'preparing' })
    window.ipcRenderer.invoke(IPC_CHANNELS.updater.startDownload, source)
  },
  installUpdate: () => {
    set({ status: 'ready' })
    window.ipcRenderer.invoke(IPC_CHANNELS.updater.quitAndInstall)
  },
  setStatus: (status: UpdateStatus) => set({ status }),
  setProgress: (progress: number) => set({ progress }),
  reset: () => set({ status: 'idle', progress: 0, versionInfo: null, error: null }),
  handleError: (error: ErrorType) => {
    if (get().status === 'preparing' || get().status === 'downloading') {
      set({ status: 'error', error })
    }
  },
  handleUpdate: (info: VersionState) => {
    if (get().status === 'idle') {
      set({ status: 'available', versionInfo: info })
    }
  },
  setSource: (source: string) => set({ source }),
}))

export const useUpdateStore = createSelectors(useUpdateStoreBase)
interface UpdateConfigStore {
  enableAutoCheckUpdate: boolean
  source: string
  customSource: string
  setEnableAutoCheckUpdate: (enabled: boolean) => void
  setSource: (source: string) => void
  setCustomSource: (customSource: string) => void
}

export const useUpdateConfigStore = create<UpdateConfigStore>()(
  persist(
    set => ({
      enableAutoCheckUpdate: true,
      // 默认走 GitHub 代理（gh-proxy.com），国内用户无需开 VPN 即可下载更新；
      // 用户仍可在更新弹窗的「更新源」里切回 GitHub 或填自定义镜像
      source: 'https://gh-proxy.com',
      customSource: '',
      setEnableAutoCheckUpdate: enabled => set({ enableAutoCheckUpdate: enabled }),
      setSource: source => set({ source }),
      setCustomSource: customSource => set({ customSource }),
    }),
    {
      name: 'update-storage',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted: unknown, version: number) => {
        // 旧版本默认 source 为 'github'（国内需 VPN 才能下载），统一升级为代理；
        // 已手动设为自定义源的用户保持不变
        const state = persisted as { source?: string } & Record<string, unknown>
        if (version < 1 && state.source === 'github') {
          state.source = 'https://gh-proxy.com'
        }
        return state
      },
    },
  ),
)
