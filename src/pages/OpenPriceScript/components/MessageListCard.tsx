import React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { useCurrentOpenPriceScript, useOpenPriceScriptActions } from '@/hooks/useOpenPriceScript'
import MessageEditor from '@/pages/AutoMessage/components/MessageEditor'

const MessageListCard = React.memo(() => {
  const { messages } = useCurrentOpenPriceScript(context => context.config)
  const { setMessages } = useOpenPriceScriptActions()

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label>话术列表</Label>
              <p className="text-sm text-muted-foreground">
                配置开价时自动发送的话术（一行一条）。勾选「置顶首条话术」后第一条会自动置顶/上墙；每条右侧的图钉可单独控制该条是否置顶。
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <MessageEditor
              messages={messages}
              unlimitedLength={true}
              onChange={messages => setMessages(messages)}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
})

export default MessageListCard
