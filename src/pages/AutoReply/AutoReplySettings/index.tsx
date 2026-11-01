import { ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { mentionPlatforms } from '@/abilities'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAutoReplyConfig } from '@/hooks/useAutoReplyConfig'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { cn } from '@/lib/utils'
import { AIFilterSetting } from './components/AIFilterSetting'
import { AIReplySetting } from './components/AIReplySetting'
import { BlocklistManager } from './components/BlocklistManager'
import { CompassSetting } from './components/CompassSetting'
import { FilterKeywordsManager } from './components/FilterKeywordsManager'
import { HideUsernameSetting } from './components/HideUsernameSetting'
import { KeywordReplySetting } from './components/KeywordReplySetting'
import { ListeningSourceSetting } from './components/ListeningSourceSetting'
import { MentionReplySetting } from './components/MentionReplySetting'
import { WebSocketSetting } from './components/WebSocketSetting'
import { WechatChannelSetting } from './components/WechatChannelSetting'

/**
 * 侧栏子项对应的落点。
 * - platform / mention / filter 直接滚到对应区块
 * - content 是「关键词回复 / AI 回复」两个 Tab 的容器，靠 #ai / #keyword 决定切哪个 Tab
 */
const SCROLL_TARGETS = ['platform', 'mention', 'content', 'filter'] as const

export default function AutoReplySettings() {
  const { config } = useAutoReplyConfig()
  const navigate = useNavigate()
  const location = useLocation()
  // 「@ 回复观众」支持哪些平台，统一由 abilities.ts 的 mention 能力决定
  // （2026-10-30 之前这里写死一份白名单，加淘宝时漏了，导致开关不出现）
  const platform = useCurrentLiveControl(ctx => ctx.platform)
  const showMentionSetting = platform ? mentionPlatforms.includes(platform) : false

  const [tab, setTab] = useState<'keyword' | 'ai'>('keyword')
  // 从侧栏跳过来时高亮对应区块，1.2 秒后淡出——让人知道"跳到这了"
  const [highlight, setHighlight] = useState<string | null>(null)

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

  // 侧栏点「AI 回复」→ /auto-reply/settings#ai：先把 Tab 切过去，再滚到容器
  useEffect(() => {
    const hash = location.hash.replace('#', '')
    if (!hash) return
    if (hash === 'ai' || hash === 'keyword') {
      setTab(hash)
    }
    const target = (SCROLL_TARGETS as readonly string[]).includes(hash) ? hash : 'content'
    // 等 Tab 切换完成再滚，否则高度还没变，scrollIntoView 会滚偏
    const timer = setTimeout(() => {
      const el = document.getElementById(target)
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setHighlight(hash)
      setTimeout(() => setHighlight(null), 1200)
    }, 60)
    return () => clearTimeout(timer)
  }, [location.hash])

  const sectionClass = (id: string) =>
    cn(
      'space-y-6 rounded-lg transition-shadow duration-500',
      highlight === id && 'ring-1 ring-brand/50',
    )

  return (
    <div className="container py-8 space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} title="返回">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">自动回复设置</h1>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>自动回复设置</CardTitle>
          <CardDescription>配置自动回复的行为和监听来源</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 平台专属：监听来源 + 该来源对应的专属设置 */}
          <section id="platform" className={sectionClass('platform')}>
            <h3 className="text-sm font-medium">平台专属</h3>
            <ListeningSourceSetting />
            {extraSetting && (
              <>
                <Separator />
                {extraSetting}
              </>
            )}
            <Separator />
            <WebSocketSetting />
          </section>

          <Separator />

          {showMentionSetting && (
            <>
              <section id="mention" className={sectionClass('mention')}>
                <MentionReplySetting />
              </section>
              <Separator />
            </>
          )}

          <section id="content" className={sectionClass('content')}>
            <HideUsernameSetting />
            <Separator />
            <Tabs value={tab} onValueChange={v => setTab(v as 'keyword' | 'ai')}>
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-medium">自动回复评论设置</h3>
                <TabsList>
                  <TabsTrigger value="keyword">关键词回复</TabsTrigger>
                  <TabsTrigger value="ai">AI回复</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="keyword" className="space-y-4">
                <KeywordReplySetting />
              </TabsContent>
              <TabsContent value="ai" className="space-y-4">
                <AIReplySetting />
              </TabsContent>
            </Tabs>
          </section>

          <Separator />

          <section id="filter" className={sectionClass('filter')}>
            <BlocklistManager />
            <Separator />
            <FilterKeywordsManager />
            <Separator />
            <AIFilterSetting />
          </section>
        </CardContent>
        <CardFooter className="flex justify-between">
          <p className="text-xs text-muted-foreground">设置会自动保存</p>
          <div className="flex space-x-2">
            <Button variant="outline" onClick={() => navigate(-1)}>
              返回
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}
