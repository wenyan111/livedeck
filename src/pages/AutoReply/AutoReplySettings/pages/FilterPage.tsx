import { Separator } from '@/components/ui/separator'
import { AIFilterSetting } from '../components/AIFilterSetting'
import { BlocklistManager } from '../components/BlocklistManager'
import { FilterKeywordsManager } from '../components/FilterKeywordsManager'

export default function FilterPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">过滤与黑名单</h2>
        <p className="text-sm text-muted-foreground">
          不回复的观众与内容。过滤在 AI 判定之前执行，命中即跳过。
        </p>
      </div>
      <Separator />
      <BlocklistManager />
      <Separator />
      <FilterKeywordsManager />
      <Separator />
      <AIFilterSetting />
    </div>
  )
}
