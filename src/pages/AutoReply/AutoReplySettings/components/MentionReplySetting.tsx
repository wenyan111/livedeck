import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAutoReplyConfig } from '@/hooks/useAutoReplyConfig'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'

/**
 * 「@ 回复观众」开关：控制自动回复是否以平台可识别的 mention 形式回复观众。
 *
 * 支持哪些平台由 `src/abilities.ts` 的 `mention` 能力决定（`mentionPlatforms`）：
 * 巨量百应 / 抖音小店 / 视频号 / 快手 / 小红书千帆 / 蒲公英 / 淘宝。
 * 其他平台没有「点评论插入 @昵称」的能力，渲染出来也只会是一个无效开关。
 */
export function MentionReplySetting() {
  const { config, updateMentionReplyEnabled } = useAutoReplyConfig()
  const platform = useCurrentLiveControl(context => context.platform)
  const mentionId = useId()

  // 快手 / 视频号的评论区「不自动把最新评论渲染进 DOM」，且列表会随直播不断累积。
  // 平台自身行为改不了，只能靠刷新页面 / 保持前台来缓解，所以在这里给用户提示。
  const needsForegroundHint = platform === 'kuaishou' || platform === 'wxchannel'

  return (
    <div className="space-y-2">
      <div className="flex items-center space-x-2">
        <Switch
          id={mentionId}
          checked={config.comment.mentionReply.enable}
          onCheckedChange={checked => updateMentionReplyEnabled(checked)}
        />
        <Label htmlFor={mentionId}>@ 回复观众</Label>
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

      {needsForegroundHint && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs leading-relaxed">
          <b className="text-warning">
            {platform === 'kuaishou' ? '快手' : '视频号'}使用建议（影响准确率与速度）
          </b>
          <div className="mt-1 text-muted-foreground">
            这两个平台的评论列表<b>不会自动把最新评论渲染出来</b>，列表还会随直播不断累积。
            为保证「@ 回复」的准确率和回复速度，建议：
            <br />① 每隔一段时间<b>刷新一次该平台的浏览器页面</b>；
            <br />② 或把这个平台的浏览器窗口<b>放在最前面（主页面）</b>，不要一直压在后台。
            <br />
            长时间不刷新、又压在后台时，可能出现「找不到目标评论」而降级为纯文本
            @（回复照常发出，只是对方收不到「被回复」的提醒）。
          </div>
        </div>
      )}
    </div>
  )
}
