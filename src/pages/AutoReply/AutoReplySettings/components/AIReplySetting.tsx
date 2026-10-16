import { useLocalStorageState, useMemoizedFn } from 'ahooks'
import { useEffect, useId, useRef } from 'react'
import AIModelInfo from '@/components/ai-chat/AIModelInfo'
import { APIKeyDialog } from '@/components/ai-chat/APIKeyDialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAutoReplyConfig } from '@/hooks/useAutoReplyConfig'
import { PromptSearch } from './PromptSearch'
import { SyncPromptDialog } from './SyncPromptDialog'

/**
 * 提示词输入框的默认高度。
 *
 * 提示词动辄几十行，框太小每次都要手动拉开才能看全，所以默认就给足高度；
 * 手动拖过的高度依然优先，但不会低于这个值（旧版本存下的小高度也会被抬上来）。
 */
const MIN_PROMPT_HEIGHT = 400

export function AIReplySetting() {
  const { config, updateAIReplySettings } = useAutoReplyConfig()
  const aiReplyEnabled = config.comment.aiReply.enable
  const autoSend = config.comment.aiReply.autoSend

  // 记住提示词输入框被手动拖拽后的高度：拖高一次，之后每次进入都保持同一高度，
  // 不用再「拉开」才能看全提示词
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const [promptHeight, setPromptHeight] = useLocalStorageState<number>('ai-reply-prompt-height', {
    defaultValue: 0,
  })

  const savePromptHeight = useMemoizedFn(() => {
    const el = promptRef.current
    if (!el) return
    const h = Math.round(el.offsetHeight)
    setPromptHeight(prev => (prev === h ? prev : h))
  })

  // 应用记忆的高度 + 监听拖拽（textarea 拖拽改高不会派发 resize 事件，只能用 ResizeObserver）
  useEffect(() => {
    const el = promptRef.current
    if (!el || !aiReplyEnabled) return
    // 手动拖过的高度照旧保留，但不低于默认高度，避免再出现「每次都要拉开」
    el.style.height = promptHeight > 0 ? `${Math.max(promptHeight, MIN_PROMPT_HEIGHT)}px` : ''
    const observer = new ResizeObserver(savePromptHeight)
    observer.observe(el)
    return () => observer.disconnect()
  }, [aiReplyEnabled, promptHeight, savePromptHeight])
  // 处理AI自动回复开关
  const handleAiReplyChange = (checked: boolean) => {
    updateAIReplySettings({ enable: checked })
  }

  const handleAutoSendChange = (checked: boolean) => {
    updateAIReplySettings({ autoSend: checked })
  }

  const aiReplyId = useId()
  const autoSendId = useId()

  return (
    <>
      <div className="flex flex-col space-y-4">
        <div className="flex items-center space-x-2">
          <Switch id={aiReplyId} checked={aiReplyEnabled} onCheckedChange={handleAiReplyChange} />
          <Label htmlFor={aiReplyId}>启用AI自动回复</Label>
        </div>
        <div>
          <div className="flex items-center space-x-2">
            <Switch id={autoSendId} checked={autoSend} onCheckedChange={handleAutoSendChange} />
            <Label htmlFor={autoSendId}>自动发送</Label>
          </div>
          <div className="text-xs text-muted-foreground mt-2 pl-2">
            <p>
              请注意：开启自动发送后，AI生成的所有回复都会自动发送到直播间，这可能会带来以下
              <strong>风险</strong>：
            </p>
            <ul className="list-disc pl-6 mt-1">
              <li>
                AI可能会生成<strong>不恰当或不相关</strong>的回复
              </li>
              <li>
                回复内容可能会<strong>违反平台规则</strong>
              </li>
              <li>可能会影响与观众的真实互动体验</li>
            </ul>
            <p className="font-medium mt-1">
              ※ 建议在开启自动发送前，先观察一段时间AI的回复质量。您也可以通过点击每条回复预览旁边的
              <strong>小飞机按钮</strong>来手动发送。
            </p>
          </div>
        </div>
      </div>
      {aiReplyEnabled && (
        <div className="space-y-4">
          {/* 标题行右侧放「一键同步配置词」：把当前提示词勾选同步到其他已创建账号 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">提示词配置</div>
            <SyncPromptDialog prompt={config.comment.aiReply.prompt} />
          </div>
          {/* 提示词条数多时，改某一句容易漏改：先搜一遍，看着清单逐条核对 */}
          <PromptSearch value={config.comment.aiReply.prompt} textareaRef={promptRef} />
          <Textarea
            ref={promptRef}
            placeholder="输入AI提示词..."
            value={config.comment.aiReply.prompt}
            onChange={e => updateAIReplySettings({ prompt: e.target.value })}
            className="min-h-[400px] resize-y"
          />
          <p className="text-xs text-muted-foreground">提示词将指导AI如何回复用户评论</p>
          <div className="flex justify-between items-center space-x-2">
            <APIKeyDialog type="autoReply" />
            <AIModelInfo type="autoReply" />
          </div>
        </div>
      )}
    </>
  )
}
