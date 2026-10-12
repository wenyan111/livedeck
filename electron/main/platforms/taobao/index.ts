import { Result } from '@praha/byethrow'
import type { Page } from 'playwright'
import { PageNotFoundError } from '#/errors/PlatformError'
import { createLogger } from '#/logger'
import type { BrowserSession } from '#/managers/BrowserSessionManager'
import { sleep } from '#/utils'
import {
  comment,
  connect,
  ensurePage,
  getAccountName,
  getItemFromVirtualScroller,
  openUrlByElement,
} from '../helper'
import type { ICommentListener, IPerformComment, IPerformPopup, IPlatform } from '../IPlatform'
import { TaobaoCommentListener } from './commentListener'
import { REGEXPS, SELECTORS, URLS } from './constant'
import { taobaoElementFinder as elementFinder } from './element-finder'

const PLATFORM_NAME = '淘宝' as const

/**
 * 等待直播间 ID 出现的总时长。
 * 淘宝直播计划页是重前端页面，接口串行 + 资源多，首屏常要 20~30 秒才渲染出列表，
 * 之前只等 5 秒，页面还没进去就判失败（表现为「刚点连接就提示连接失败」）。
 * 这里给足 60 秒，期间每秒轮询一次。
 */
const LIVE_ID_TIMEOUT_MS = 60_000
const LIVE_ID_POLL_INTERVAL_MS = 1000

/**
 * 在直播计划页里定位直播间 ID，命中不了返回 null（由调用方决定何时放弃）。
 *
 * 淘宝的 class 是构建产物（tblalm-xxx / tui-xxx），改版后命名会变，
 * 只认一条完整 class 链（还要求带 .online）极易永久失效，因此逐级降级：
 * 1. 列表项里指向中控台的链接（`liveId=xxx`）— 最不受改版影响
 * 2. 候选选择器（完整 class 链 → class 片段）
 * 3. 页面文本里的「ID：xxx」文案
 */
async function resolveLiveId(page: Page): Promise<string | null> {
  const candidates = [...SELECTORS.LIVE_ID_CANDIDATES]
  return page
    .evaluate(selectors => {
      const pickNumber = (text?: string | null) => {
        const matched = /\d{5,}/.exec(text ?? '')
        return matched ? matched[0] : null
      }

      const link = document.querySelector<HTMLAnchorElement>('a[href*="liveId="]')
      if (link) {
        const matched = /liveId=(\d+)/.exec(decodeURIComponent(link.href))
        if (matched) {
          return matched[1]
        }
      }

      for (const selector of selectors) {
        const id = pickNumber(document.querySelector(selector)?.textContent)
        if (id) {
          return id
        }
      }

      const fromText = /(?:直播)?ID[：: ]{0,3}(\d{5,})/i.exec(document.body?.innerText ?? '')
      return fromText ? fromText[1] : null
    }, candidates)
    .catch(() => null)
}

/** 找不到直播间 ID 时，把页面结构摘要写进日志，便于事后定位（选择器失效 or 未开播） */
async function dumpLiveListDiagnosis(page: Page, logger: ReturnType<typeof createLogger>) {
  const diagnosis = await page
    .evaluate(() => ({
      url: location.href,
      listContainer: !!document.querySelector('div.tblalm-lm-content'),
      listItems: document.querySelectorAll('[class*="list-item-live"]').length,
      onlineItems: document.querySelectorAll('[class*="list-item-live"][class*="online"]').length,
      text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 500),
    }))
    .catch(err => ({ error: String(err) }))
  logger.error(`找不到直播间 ID，页面诊断：${JSON.stringify(diagnosis)}`)
}

/**
 * 淘宝
 */
export class TaobaoPlatform implements IPlatform, IPerformPopup, IPerformComment, ICommentListener {
  readonly _isCommentListener = true
  readonly _isPerformComment = true
  readonly _isPerformPopup = true
  private mainPage: Page | null = null
  private commentListener: TaobaoCommentListener | null = null
  private readonly logger = createLogger('淘宝')

  async connect(session: BrowserSession): Promise<boolean> {
    const { page } = session
    const isAccessed = await connect(page, {
      liveControlUrl: URLS.LIVE_LIST, // 直播计划页面
      // 主选择器 + 片段兜底，避免改版后一直卡在「连接中」
      isInLiveControlSelector: `${SELECTORS.IN_LIVE_LIST}, ${SELECTORS.IN_LIVE_LIST_FALLBACK}`,
      loginUrlRegex: REGEXPS.LOGIN_PAGE,
    })

    if (!isAccessed) {
      return false
    }

    // 淘宝需要在直播计划中获取到直播间 id，再通过 id 进入中控台
    const deadline = Date.now() + LIVE_ID_TIMEOUT_MS
    let liveId: string | null = null
    while (Date.now() < deadline) {
      liveId = await resolveLiveId(session.page)
      if (liveId) {
        break
      }
      // 页面可能还在渲染（或刚触发导航导致执行上下文被销毁），稍等再试
      await sleep(LIVE_ID_POLL_INTERVAL_MS)
    }

    if (!liveId) {
      await dumpLiveListDiagnosis(session.page, this.logger)
      throw new Error(
        `找不到直播间 ID，请确认是否正在直播（已等待 ${LIVE_ID_TIMEOUT_MS / 1000} 秒）`,
      )
    }

    this.logger.info(`获取到直播间 ID：${liveId}，正在进入中控台`)
    await session.page.goto(`${URLS.LIVE_CONTROL_WITH_ID}${liveId}`, {
      waitUntil: 'domcontentloaded',
    })

    // 淘宝会弹出莫名其妙的引导界面，按 ESC 关闭
    const driverOverlay = SELECTORS.overlays.DRIVER
    await page.waitForSelector(driverOverlay, { timeout: 3000 }).catch(() => null)
    while (await page.$(driverOverlay)) {
      await page.press('body', 'Escape')
      await sleep(500)
    }

    this.mainPage = page

    return true
  }

  async login(session: BrowserSession): Promise<void> {
    if (!REGEXPS.LOGIN_PAGE.test(session.page.url())) {
      await session.page.goto(URLS.LOGIN_PAGE)
    }

    await session.page.waitForSelector(
      `${SELECTORS.IN_LIVE_LIST}, ${SELECTORS.IN_LIVE_LIST_FALLBACK}`,
      {
        timeout: 0,
      },
    )
  }

  async getAccountName(session: BrowserSession): Promise<string> {
    // 需要前往首页获取
    const homePage = await openUrlByElement(session.page, URLS.HOME_PAGE)
    session.page.bringToFront()
    const accountName = (await getAccountName(homePage, SELECTORS.ACCOUNT_NAME)) ?? ''
    homePage.close()
    return accountName
  }

  disconnect(): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async performPopup(id: number) {
    return Result.pipe(
      ensurePage(this.mainPage),
      Result.andThen(page => getItemFromVirtualScroller(page, elementFinder, id)),
      Result.andThen(item => elementFinder.getPopUpButtonFromGoodsItem(item)),
      Result.inspect(btn => btn.dispatchEvent('click')),
      Result.andThen(_ => Result.succeed()),
    )
  }

  async performComment(message: string) {
    return Result.pipe(
      ensurePage(this.mainPage),
      Result.andThen(page => comment(page, elementFinder, message, false)),
    )
  }

  startCommentListener(
    onComment: (comment: LiveMessage) => void,
    source: CommentListenerConfig['source'],
  ): void | Promise<void> {
    if (source !== 'taobao') {
      throw new Error('淘宝评论监听器只能用于淘宝平台')
    }
    if (!this.mainPage) {
      throw new PageNotFoundError()
    }
    this.commentListener = new TaobaoCommentListener(this.mainPage, onComment)
    this.commentListener.start()
  }

  stopCommentListener(): void {
    this.commentListener?.stop()
  }

  getCommentListenerPage(): Page {
    if (!this.commentListener) {
      throw new PageNotFoundError()
    }
    return this.commentListener.getPage()
  }

  getPopupPage() {
    return this.mainPage
  }

  getCommentPage() {
    return this.mainPage
  }

  get platformName() {
    return PLATFORM_NAME
  }
}
