import React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  useCurrentOpenPriceScript,
  useOpenPriceScriptActions,
} from '@/hooks/useOpenPriceScript'

const OpenPriceSettingsCard = React.memo(() => {
  const { messages, pinTopEnabled } = useCurrentOpenPriceScript(context => context.config)
  const { setPinTopEnabled } = useOpenPriceScriptActions()

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label className="text-sm font-medium leading-none">置顶首条话术</Label>
              <p className="text-sm text-muted-foreground">
                开价变预热时，把第一条话术置顶（抖音）或上墙（视频号）到直播间公屏。
                关闭后第一条不置顶，仅按每条右侧的图钉决定。
              </p>
            </div>
            <Switch
              checked={pinTopEnabled ?? true}
              onCheckedChange={checked => setPinTopEnabled(Boolean(checked))}
            />
          </div>

          <p className="text-sm text-muted-foreground">
            点击右上角「开始任务」后，中控台点击「开价/讲解」按钮变为「预热/结束讲解」时，自动按顺序发送以上全部话术。需先连接中控台再开始任务。
          </p>
          {messages.length === 0 && (
            <p className="text-xs text-destructive">
              尚未配置任何话术，开始任务后不会发送任何内容。
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
})

export default OpenPriceSettingsCard
