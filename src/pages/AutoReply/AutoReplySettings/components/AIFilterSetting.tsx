import { CheckIcon, XIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import AIModelInfo from '@/components/ai-chat/AIModelInfo'
import { APIKeyDialog } from '@/components/ai-chat/APIKeyDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAIProvider } from '@/hooks/useAIProvider'
import { useAutoReplyConfig } from '@/hooks/useAutoReplyConfig'
import { useProviders } from '@/hooks/useProviders'

const defaultPrompt =
  '如果评论是在提问、咨询商品、求购买链接、表达购买意向、需要互动或明显期待回复，则判定为需要回复；如果是纯灌水、刷屏、无意义表情、广告引流或与直播间无关的内容，则判定为无需回复（直接过滤）。'

export function AIFilterSetting() {
  const { config, updateAIFilterSettings } = useAutoReplyConfig()
  const aiProvider = useAIProvider('autoReply')
  const providers = useProviders()

  const aiFilter = config.comment.aiFilter
  const aiFilterEnabled = aiFilter.enable
  const prompt = aiFilter.prompt || defaultPrompt

  const handleEnableChange = (checked: boolean) => {
    updateAIFilterSettings({ enable: checked })
  }

  const handleUseReplyModelChange = (checked: boolean) => {
    updateAIFilterSettings({ useReplyModel: checked })
  }

  const currentProvider = aiFilter.provider
  const currentModels = providers[currentProvider]?.models ?? []
  const apiKey = aiProvider.apiKeys[currentProvider] ?? ''

  const [testLoading, setTestLoading] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null)

  const handleTestConnection = async () => {
    if (!apiKey) return
    setTestLoading(true)
    setTestResult(null)
    try {
      const res = await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.aiChat.testApiKey, {
        apiKey,
        provider: currentProvider,
        customBaseURL: aiProvider.customBaseURL,
      })
      setTestResult(res?.success ? { success: true } : { success: false, error: res?.error })
    } catch (err) {
      setTestResult({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setTestLoading(false)
    }
  }

  const aiFilterId = useId()
  const useReplyModelId = useId()

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">AI 智能过滤</h3>
        <p className="text-sm text-muted-foreground">
          在「弹幕过滤关键词」之后，使用 AI
          小模型判断每条评论是否需要回复。判定为「无需回复」的评论会被直接过滤，
          判定为「需要回复」的评论才进入关键词回复 / AI 回复流程。
        </p>
      </div>

      <div className="flex items-center space-x-2">
        <Switch id={aiFilterId} checked={aiFilterEnabled} onCheckedChange={handleEnableChange} />
        <Label htmlFor={aiFilterId}>启用 AI 智能过滤</Label>
      </div>

      {aiFilterEnabled && (
        <div className="space-y-4 pl-2 border-l-2 border-muted ml-1">
          <div className="space-y-2">
            <div className="flex items-center space-x-2">判定标准（提示词）</div>
            <Textarea
              placeholder="输入 AI 判定标准..."
              value={prompt}
              onChange={e => updateAIFilterSettings({ prompt: e.target.value })}
              className="min-h-[120px]"
            />
            <p className="text-xs text-muted-foreground">
              告诉 AI 什么样的评论应该回复、什么样的评论应该过滤。模型会据此返回
              <code className="mx-1">{'{"reply": true}'}</code> 或
              <code className="mx-1">{'{"reply": false}'}</code>。
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id={useReplyModelId}
              checked={aiFilter.useReplyModel}
              onCheckedChange={handleUseReplyModelChange}
            />
            <Label htmlFor={useReplyModelId}>复用 AI 回复的模型</Label>
          </div>

          {aiFilter.useReplyModel ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                判定将使用【AI回复】选项卡中配置的模型（建议选择一个快速、低成本的模型）。
              </p>
              <div className="flex justify-between items-center space-x-2">
                <APIKeyDialog type="autoReply" />
                <AIModelInfo type="autoReply" />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>模型提供商</Label>
                <Select
                  value={currentProvider}
                  onValueChange={provider => {
                    const models = providers[provider]?.models ?? []
                    updateAIFilterSettings({
                      provider,
                      // 切换提供商时，如果当前模型不在该提供商列表里，自动选第一个
                      model: models.includes(aiFilter.model) ? aiFilter.model : (models[0] ?? ''),
                    })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择提供商" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(providers).map(([key, p]) => (
                      <SelectItem key={key} value={key}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>模型</Label>
                {currentProvider === 'custom' ? (
                  <Input
                    value={aiFilter.model}
                    onChange={e => updateAIFilterSettings({ model: e.target.value })}
                    placeholder="输入模型名称，如 deepseek-reasoner"
                    className="font-mono"
                  />
                ) : (
                  <Select
                    value={aiFilter.model}
                    onValueChange={model => updateAIFilterSettings({ model })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择模型" />
                    </SelectTrigger>
                    <SelectContent>
                      {currentModels.map(m => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>API Key（{providers[currentProvider]?.name ?? currentProvider}）</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleTestConnection}
                    disabled={!apiKey || testLoading}
                  >
                    {testLoading ? '测试中...' : '测试连接'}
                  </Button>
                </div>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={e => aiProvider.setApiKey(currentProvider, e.target.value)}
                  placeholder={`请输入 ${providers[currentProvider]?.name ?? currentProvider} 的 API Key`}
                  className="font-mono"
                />
                {testResult?.success && (
                  <p className="text-xs text-success flex items-center gap-1">
                    <CheckIcon className="h-3.5 w-3.5" /> 连接成功，可正常用于 AI 智能过滤
                  </p>
                )}
                {testResult && !testResult.success && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <XIcon className="h-3.5 w-3.5" /> 连接失败：
                    {testResult.error || '未知错误'}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  该 Key
                  与【AI回复】共用一套存储，按提供商区分；此处仅验证当前过滤模型所用的提供商与 Key
                  是否可用。
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
