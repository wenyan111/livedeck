import { Separator } from '@/components/ui/separator'
import { AIReplySetting } from '../components/AIReplySetting'

export default function AIPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">AI 回复</h2>
        <p className="text-sm text-muted-foreground">
          用大模型生成回复内容。可配置提示词、模型与是否自动发送。
        </p>
      </div>
      <Separator />
      <AIReplySetting />
    </div>
  )
}
