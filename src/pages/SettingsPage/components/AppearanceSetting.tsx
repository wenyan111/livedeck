import { MoonIcon } from 'lucide-react'
import { useId } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAppearanceStore } from '@/hooks/useAppearance'

export function AppearanceSetting() {
  const dark = useAppearanceStore(s => s.dark)
  const setDark = useAppearanceStore(s => s.setDark)
  const id = useId()

  return (
    <Card>
      <CardHeader>
        <CardTitle>外观设置</CardTitle>
        <CardDescription>自定义界面的显示外观</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h4 className="text-sm font-medium leading-none">深色背景</h4>
            <p className="text-sm text-muted-foreground">
              启用后界面使用深色配色，适合暗光环境下长时间使用，减少眩光
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <Label htmlFor={id} className="text-sm text-muted-foreground">
              深色模式
            </Label>
            <Switch id={id} checked={dark} onCheckedChange={setDark} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
