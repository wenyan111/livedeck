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
          <b className="text-warning">{platform === 'kuaishou' ? '快手' : '视频号'}使用建议</b>
          <ul className="mt-1.5 space-y-1 text-muted-foreground">
            <li>
              · <b>定期刷新页面</b>，或把浏览器窗口放在最前。压在后台会出现「找不到目标评论」，
              自动降级为纯文本 @。
            </li>
            <li>
              · 看到「评论列表未命中」提醒（Dock 跳 + 角标「!」／Windows 任务栏闪烁）时：
              <b>刷新页面</b>，或把公屏<b>滚到最新</b>。
            </li>
            {platform === 'kuaishou' && (
              <li>
                · 同一条评论<b>只能 @ 一次</b>。请关闭快手后台的<b>「关键词回复」</b>
                ，否则两边会抢着回同一条评论。
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
