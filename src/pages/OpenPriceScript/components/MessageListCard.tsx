import React, { useId } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useCurrentOpenPriceScript, useOpenPriceScriptActions } from '@/hooks/useOpenPriceScript'
import MessageEditor from '@/pages/AutoMessage/components/MessageEditor'

const MessageListCard = React.memo(() => {
  const { messages, pinTopEnabled } = useCurrentOpenPriceScript(context => context.config)
  const { setMessages, setPinTopEnabled } = useOpenPriceScriptActions()
  const pinTopSwitchId = useId()

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label>话术列表</Label>
              <p className="text-sm text-muted-foreground">
                配置开价时自动发送的话术（一行一条）。开启右侧「置顶首条话术」后，第一条会自动置顶（抖音）/上墙（视频号）；
                关闭则仅按每行左侧的图钉决定是否置顶。
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <MessageEditor
              messages={messages}
              unlimitedLength={true}
              onChange={messages => setMessages(messages)}
              // 置顶开关原先在页面最底部的「设置」卡片里，直播中容易看不到，移到首行右侧
              rightSlot={
                <>
                  <Label
                    htmlFor={pinTopSwitchId}
                    className="cursor-pointer text-xs text-muted-foreground"
                  >
                    置顶首条话术
                  </Label>
                  <Switch
                    id={pinTopSwitchId}
                    checked={pinTopEnabled ?? true}
                    onCheckedChange={checked => setPinTopEnabled(Boolean(checked))}
                  />
                </>
              }
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
})

export default MessageListCard
