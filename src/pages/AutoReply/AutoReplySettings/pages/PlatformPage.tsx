import { useMemo } from 'react'
import { Separator } from '@/components/ui/separator'
import { useAutoReplyConfig } from '@/hooks/useAutoReplyConfig'
import { CompassSetting } from '../components/CompassSetting'
import { ListeningSourceSetting } from '../components/ListeningSourceSetting'
import { WebSocketSetting } from '../components/WebSocketSetting'
import { WechatChannelSetting } from '../components/WechatChannelSetting'

export default function PlatformPage() {
  const { config } = useAutoReplyConfig()

  // 监听来源决定下面出现哪块专属设置：罗盘→开价设置，视频号→置顶评论
  const extraSetting = useMemo(() => {
    switch (config.entry) {
      case 'compass':
        return <CompassSetting />
      case 'wechat-channel':
        return <WechatChannelSetting />
      default:
        return null
    }
  }, [config.entry])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">平台专属</h2>
        <p className="text-sm text-muted-foreground">
          监听来源与对应的专属设置。可用来源由当前账号的平台决定。
        </p>
      </div>
      <Separator />
      <ListeningSourceSetting />
      {extraSetting && (
        <>
          <Separator />
          {extraSetting}
        </>
      )}
      <Separator />
      <WebSocketSetting />
    </div>
  )
}
