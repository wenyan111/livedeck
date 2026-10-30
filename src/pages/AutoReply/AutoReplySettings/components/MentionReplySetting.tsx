import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAutoReplyConfig } from '@/hooks/useAutoReplyConfig'

/**
 * 「真 @ 观众」开关：控制自动回复是否以平台可识别的 mention 形式回复观众。
 *
 * 支持哪些平台由 `src/abilities.ts` 的 `mention` 能力决定（`mentionPlatforms`）：
 * 巨量百应 / 抖音小店 / 视频号 / 快手 / 小红书千帆 / 蒲公英 / 淘宝。
 * 其他平台没有「点评论插入 @昵称」的能力，渲染出来也只会是一个无效开关。
 */
export function MentionReplySetting() {
  const { config, updateMentionReplyEnabled } = useAutoReplyConfig()
  const mentionId = useId()

  return (
    <div className="space-y-2">
      <div className="flex items-center space-x-2">
        <Switch
          id={mentionId}
          checked={config.comment.mentionReply.enable}
          onCheckedChange={checked => updateMentionReplyEnabled(checked)}
        />
        <Label htmlFor={mentionId}>真 @ 观众（mention 回复）</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        开启后，自动回复会先点击中控台评论列表里<b>那条观众评论</b>，让平台自动插入
        <span className="font-bold mx-1 bg-muted px-1 rounded-md">@昵称</span>
        标识，再在后面追加回复正文——发出的是平台可识别的「回复该观众」，对方会收到通知。
        <br />
        关闭时保持原有行为：只在正文里把
        <span className="font-bold mx-1 bg-muted px-1 rounded-md">{'{用户名}'}</span>
        替换成纯文本 @，平台不视为回复该观众。
        <br />
        若那条评论已经滚出评论列表、或查找失败，会<b>自动回退为纯文本发送</b>，不会丢回复。
      </p>
    </div>
  )
}
