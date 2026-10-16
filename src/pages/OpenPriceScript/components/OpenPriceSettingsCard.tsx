import React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { useCurrentOpenPriceScript } from '@/hooks/useOpenPriceScript'

const OpenPriceSettingsCard = React.memo(() => {
  const messages = useCurrentOpenPriceScript(context => context.config.messages)

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4">
          {/* 「置顶首条话术」开关已移到上方「话术列表」卡片里（首行右侧），这里只留说明 */}
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
