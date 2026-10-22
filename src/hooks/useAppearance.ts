import { useEffect, useState } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** 主题模式：浅色 / 深色 / 跟随系统 / 定时 */
export type ThemeMode = 'light' | 'dark' | 'system' | 'schedule'

interface AppearanceStore {
  /** 当前主题模式（默认跟随系统，与手机一致） */
  mode: ThemeMode
  /** 定时模式的深色时段起止（'HH:MM'，24 小时制）；跨午夜由 isInSchedule 处理 */
  scheduleStart: string
  scheduleEnd: string
  setMode: (mode: ThemeMode) => void
  setSchedule: (start: string, end: string) => void
}

const DEFAULT_SCHEDULE_START = '20:00'
const DEFAULT_SCHEDULE_END = '07:00'

export const useAppearanceStore = create<AppearanceStore>()(
  persist(
    set => ({
      mode: 'system',
      scheduleStart: DEFAULT_SCHEDULE_START,
      scheduleEnd: DEFAULT_SCHEDULE_END,
      setMode: mode => set({ mode }),
      setSchedule: (start, end) => set({ scheduleStart: start, scheduleEnd: end }),
    }),
    {
      name: 'appearance-storage',
      version: 2,
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Record<string, unknown>
        // 旧版本只有 dark: boolean，迁移为对应模式，避免丢设置
        if (version < 2 && typeof state.dark === 'boolean') {
          state.mode = state.dark ? 'dark' : 'light'
          state.scheduleStart = DEFAULT_SCHEDULE_START
          state.scheduleEnd = DEFAULT_SCHEDULE_END
        }
        return state as unknown as AppearanceStore
      },
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

/** 是否处于定时深色时段（支持跨午夜，如 20:00–07:00） */
export function isInSchedule(start: string, end: string, now = new Date()): boolean {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }
  const s = toMin(start)
  const e = toMin(end)
  const cur = now.getHours() * 60 + now.getMinutes()
  if (s === e) return false
  if (s < e) return cur >= s && cur < e
  // 跨午夜：如 20:00–07:00 => cur>=20 或 cur<7
  return cur >= s || cur < e
}

/** 系统是否深色（renderer matchMedia 跟随 Electron nativeTheme / 操作系统） */
function useSystemDark(): boolean {
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false,
  )
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return systemDark
}

/** 当前是否应处于定时深色（每分钟重新计算一次，跨边界自动切换） */
function useScheduleDark(start: string, end: string): boolean {
  const [inSchedule, setInSchedule] = useState(() => isInSchedule(start, end))
  useEffect(() => {
    setInSchedule(isInSchedule(start, end))
    const id = setInterval(() => setInSchedule(isInSchedule(start, end)), 60_000)
    return () => clearInterval(id)
  }, [start, end])
  return inSchedule
}

/** 在 App 根组件调用：根据模式解析最终明暗，同步 .dark 类与系统窗口主题 */
export function useApplyTheme() {
  const mode = useAppearanceStore(s => s.mode)
  const scheduleStart = useAppearanceStore(s => s.scheduleStart)
  const scheduleEnd = useAppearanceStore(s => s.scheduleEnd)
  const systemDark = useSystemDark()
  const scheduleDark = useScheduleDark(scheduleStart, scheduleEnd)

  const dark =
    mode === 'dark' || (mode === 'system' && systemDark) || (mode === 'schedule' && scheduleDark)

  useEffect(() => {
    applyTheme(dark)
    // 系统模式下让原生窗口（标题栏）也跟随 OS；其余模式按实际明暗强制
    const nativeThemeArg = mode === 'system' ? 'system' : dark ? 'dark' : 'light'
    window.ipcRenderer?.invoke(IPC_CHANNELS.app.setTheme, nativeThemeArg).catch(() => {})
  }, [dark, mode])
}
