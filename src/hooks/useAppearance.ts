import { useEffect } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AppearanceStore {
  /** 是否使用深色背景界面 */
  dark: boolean
  setDark: (dark: boolean) => void
  toggleDark: () => void
}

export const useAppearanceStore = create<AppearanceStore>()(
  persist(
    set => ({
      dark: false,
      setDark: dark => set({ dark }),
      toggleDark: () => set(s => ({ dark: !s.dark })),
    }),
    {
      name: 'appearance-storage',
      version: 1,
    },
  ),
)

/** 把深色模式应用到 <html>：加上 / 移除 .dark 类，整个界面随之切换 */
export function applyTheme(dark: boolean) {
  const root = document.documentElement
  if (dark) {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

/** 在 App 根组件调用：挂载时 + 每次切换时同步 .dark 类与系统窗口主题 */
export function useApplyTheme() {
  const dark = useAppearanceStore(s => s.dark)
  useEffect(() => {
    applyTheme(dark)
    // 同步系统标题栏明暗（macOS 也一起变深）
    window.ipcRenderer
      ?.invoke(IPC_CHANNELS.app.setTheme, dark ? 'dark' : 'light')
      .catch(() => {})
  }, [dark])
}
