import { ArrowLeftRight, Download, Eraser, Upload } from 'lucide-react'
import { useState } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { Title } from '@/components/common/Title'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  applyConfig,
  cleanupShellAccounts,
  collectConfig,
  type ImportResult,
} from '@/utils/configSync'

type Status = { kind: 'info' | 'ok' | 'error'; text: string }

export default function ConfigTransfer() {
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  const handleExport = async () => {
    setBusy('export')
    setStatus(null)
    setResult(null)
    try {
      const payload = await collectConfig()
      const filePath = await window.ipcRenderer.invoke(
        IPC_CHANNELS.configTransfer.exportFile,
        payload,
      )
      if (!filePath) {
        setStatus({ kind: 'info', text: '已取消导出。' })
        return
      }
      const names = payload.accounts.map(a => a.name).join('、') || '(无账号)'
      const skipped = payload.skippedShellAccounts ?? 0
      setStatus({
        kind: 'ok',
        text:
          `已导出到：${filePath}\n包含账号：${names}` +
          (skipped > 0 ? `\n已跳过 ${skipped} 个空壳账号（名字为空或是 uuid 串）` : ''),
      })
    } catch (err) {
      setStatus({ kind: 'error', text: `导出失败：${(err as Error).message}` })
    } finally {
      setBusy(null)
    }
  }

  const handleImport = async () => {
    setBusy('import')
    setStatus(null)
    setResult(null)
    try {
      const payload = await window.ipcRenderer.invoke(IPC_CHANNELS.configTransfer.importFile)
      if (!payload) {
        setStatus({ kind: 'info', text: '已取消导入（或文件无法解析）。' })
        return
      }
      const res = await applyConfig(payload)
      setResult(res)
      setStatus({ kind: res.ok ? 'ok' : 'error', text: res.message })
    } catch (err) {
      setStatus({ kind: 'error', text: `导入失败：${(err as Error).message}` })
    } finally {
      setBusy(null)
    }
  }

  const handleCleanup = () => {
    const { removed, orphans } = cleanupShellAccounts()
    setResult(null)
    const parts: string[] = []
    if (removed > 0) parts.push(`清理空壳账号 ${removed} 个`)
    if (orphans > 0) parts.push(`清理孤立数据 ${orphans} 条`)
    setStatus(
      parts.length > 0
        ? { kind: 'ok', text: `${parts.join('，')}，刷新后生效。` }
        : { kind: 'info', text: '没有找到空壳账号或孤立数据。' },
    )
  }

  const reload = () => window.location.reload()

  return (
    <div className="container py-8">
      <div className="mb-6">
        <Title title="数据迁移" description="把账号配置导出成文件，换电脑导入即可继续用" />
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5" />
              导出 / 导入账号配置
            </CardTitle>
            <CardDescription>
              在一台机器上导出，到另一台机器导入即可。<b>不需要先登录</b>——本机没有的账号会
              按导出信息自动建出来（未连接状态），之后点「连接」扫码登录就能直接用上配置。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Button onClick={handleExport} disabled={busy !== null}>
                <Upload className="mr-2 h-4 w-4" />
                {busy === 'export' ? '导出中…' : '导出配置'}
              </Button>
              <Button variant="secondary" onClick={handleImport} disabled={busy !== null}>
                <Download className="mr-2 h-4 w-4" />
                {busy === 'import' ? '导入中…' : '导入配置'}
              </Button>
              <Button variant="outline" onClick={handleCleanup} disabled={busy !== null}>
                <Eraser className="mr-2 h-4 w-4" />
                清理空壳账号
              </Button>
            </div>

            {status && (
              <div
                className={
                  status.kind === 'error'
                    ? 'rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive'
                    : status.kind === 'ok'
                      ? 'rounded-md border border-success/40 bg-success/10 p-3 text-sm'
                      : 'rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground'
                }
              >
                <div className="whitespace-pre-wrap">{status.text}</div>
                {result && (
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <div>沿用本机账号：{result.matched.join('、') || '(无)'}</div>
                    <div>新建的账号：{result.created.join('、') || '(无)'}</div>
                    <div>跳过的账号：{result.unmatched.join('、') || '(无)'}</div>
                  </div>
                )}
                {result?.ok && (
                  <Button size="sm" variant="outline" className="mt-3" onClick={reload}>
                    立即刷新使配置生效
                  </Button>
                )}
              </div>
            )}

            <Separator />

            <div className="space-y-2 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">会带走什么</p>
              <p>
                自动回复（关键词 / AI 提示词 / 黑名单 / @ 回复开关）、开价话术、自动弹窗、批量话术、
                跨平台开价联动、快速开始选中项、AI 助手的模型配置、直播日报的列配置与已填数据。
              </p>
              <p className="font-medium text-foreground pt-2">不会带走什么</p>
              <p>
                <b>平台登录态</b>（cookie）——换电脑需要重新扫码登录，这是刻意的：跨机器复制登录凭据
                有风控风险。另外「这台机器上有哪些账号」也不会覆盖，避免打乱本机账号列表。
              </p>
              <p className="font-medium text-foreground pt-2">注意</p>
              <p>
                导出的是<b>明文 JSON</b>，里面有 AI 的 API Key，请勿外传或放进公开仓库。
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
