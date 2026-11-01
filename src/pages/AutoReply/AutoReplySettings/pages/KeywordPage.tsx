import { Separator } from '@/components/ui/separator'
import { HideUsernameSetting } from '../components/HideUsernameSetting'
import { KeywordReplySetting } from '../components/KeywordReplySetting'

export default function KeywordPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">关键词回复</h2>
        <p className="text-sm text-muted-foreground">
          命中关键词时自动发送对应话术。支持多组规则，每组可配多个关键词和话术。
        </p>
      </div>
      <Separator />
      <HideUsernameSetting />
      <Separator />
      <KeywordReplySetting />
    </div>
  )
}
