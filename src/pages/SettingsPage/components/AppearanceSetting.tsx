import { useId } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { type ThemeMode, useAppearanceStore } from '@/hooks/useAppearance'

const modeOptions: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
  { value: 'schedule', label: '定时' },
]

export function AppearanceSetting() {
  const mode = useAppearanceStore(s => s.mode)
  const scheduleStart = useAppearanceStore(s => s.scheduleStart)
  const scheduleEnd = useAppearanceStore(s => s.scheduleEnd)
  const setMode = useAppearanceStore(s => s.setMode)
  const setSchedule = useAppearanceStore(s => s.setSchedule)
  const id = useId()

  return (
    <Card>
      <CardHeader>
        <CardTitle>外观设置</CardTitle>
        <CardDescription>自定义界面的显示外观，支持跟随系统或定时自动切换深色模式</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h4 className="text-sm font-medium leading-none">主题模式</h4>
            <p className="text-sm text-muted-foreground">
              选择「跟随系统」可随操作系统明暗自动切换；选择「定时」可在指定时段自动使用深色
            </p>
          </div>
          <Select value={mode} onValueChange={v => setMode(v as ThemeMode)}>
            <SelectTrigger className="w-[140px]" id={id}>
              <SelectValue placeholder="选择主题模式" />
            </SelectTrigger>
            <SelectContent>
              {modeOptions.map(o => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {mode === 'schedule' && (
          <div className="flex flex-wrap items-end gap-4 rounded-md border p-4">
            <div className="space-y-1">
              <Label htmlFor="schedule-start" className="text-sm text-muted-foreground">
                深色开始
              </Label>
              <Input
                id="schedule-start"
                type="time"
                value={scheduleStart}
                onChange={e => setSchedule(e.target.value, scheduleEnd)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="schedule-end" className="text-sm text-muted-foreground">
                深色结束
              </Label>
              <Input
                id="schedule-end"
                type="time"
                value={scheduleEnd}
                onChange={e => setSchedule(scheduleStart, e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground pb-1">
              该时段内自动使用深色（支持跨午夜，如 20:00–07:00）
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
