import { Separator } from '@/components/ui/separator'
import { MentionReplySetting } from '../components/MentionReplySetting'

export default function MentionPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">@ 回复</h2>
        <p className="text-sm text-muted-foreground">
          回复时带上平台原生的 @昵称，让对方收到「被回复」的通知。
        </p>
      </div>
      <Separator />
      <MentionReplySetting />
    </div>
  )
}
