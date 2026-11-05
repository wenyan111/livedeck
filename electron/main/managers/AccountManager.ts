import { Result } from '@praha/byethrow'
import { ErrorFactory } from '@praha/error-factory'
import { STREAM_END_SIGNALS } from 'shared/streamEnd'
import { emitter } from '#/event/eventBus'
import { createLogger } from '#/logger'
import { AccountSession } from '#/services/AccountSession'

class AccountNotFoundError extends ErrorFactory({
  name: 'AccountNotFoundError',
  message: '账号不存在，请先连接中控台',
}) {}

/** 探测间隔：20 秒一次，够快又不至于频繁读 DOM */
const STREAM_END_PROBE_INTERVAL_MS = 20_000

export class AccountManager {
  accountSessions: Map<string, AccountSession> = new Map()
  accountNames: Map<string, string> = new Map()
  private logger = createLogger('账号管理')
  private streamEndTimer: NodeJS.Timeout | null = null

  constructor() {
    emitter.on('page-closed', ({ accountId }) => {
      this.closeSession(accountId)
    })
    this.startStreamEndWatch()
  }

  /** 启动下播探测（幂等，多次调用只启一个定时器） */
  private startStreamEndWatch() {
    if (this.streamEndTimer) return
    this.streamEndTimer = setInterval(() => {
      void this.checkStreamEnd()
    }, STREAM_END_PROBE_INTERVAL_MS)
  }

  /**
   * 逐个在线账号检查页面上是否出现「已下播」文案，出现就断开。
   * 只处理 STREAM_END_TEXTS 里配置了文案的平台（目前仅快手）。
   */
  private async checkStreamEnd() {
    for (const [accountId, session] of [...this.accountSessions]) {
      const signals = STREAM_END_SIGNALS[session.platformName]
      if (!signals || signals.length === 0) continue
      const ended = await session.hasStreamEndSignal(signals).catch(() => false)
      if (!ended) continue
      this.logger.warn(
        `检测到「${signals[0].text}」，判定已下播，自动断开「${this.getAccountName(accountId)}」`,
      )
      this.closeSession(accountId)
    }
  }

  createSession(platformName: LiveControlPlatform, account: Account) {
    this.setAccountName(account.id, account.name)
    const existSession = this.accountSessions.get(account.id)
    if (existSession) {
      this.logger.warn('检测到已存在建立的连接，将关闭已建立的连接')
      existSession.disconnect()
    }

    const accountSession = new AccountSession(platformName, account)
    this.accountSessions.set(account.id, accountSession)
    return accountSession
  }

  getSession(accountId: string): Result.Result<AccountSession, Error> {
    const accountSession = this.accountSessions.get(accountId)
    if (!accountSession) {
      return Result.fail(new AccountNotFoundError())
    }
    return Result.succeed(accountSession)
  }

  setAccountName(accountId: string, accountName: string) {
    this.accountNames.set(accountId, accountName)
  }

  getAccountName(accountId: string) {
    return this.accountNames.get(accountId) ?? '未定义账号'
  }

  closeSession(accountId: string) {
    const accountSession = this.accountSessions.get(accountId)
    if (!accountSession) return

    accountSession.disconnect()
    this.accountSessions.delete(accountId)
  }

  cleanup() {
    if (this.streamEndTimer) {
      clearInterval(this.streamEndTimer)
      this.streamEndTimer = null
    }
    this.accountSessions.values().forEach(session => {
      session.disconnect()
    })
  }
}

export const accountManager = new AccountManager()
