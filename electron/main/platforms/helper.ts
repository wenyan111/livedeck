import { Result } from '@praha/byethrow'
import type { ElementHandle, Frame, Page } from 'playwright'
import { UnexpectedError } from '#/errors/AppError'
import {
  ElementContentMismatchedError,
  ElementDisabledError,
  ElementNotFoundError,
  MaxTryCountExceededError,
  PageNotFoundError,
  type PlatformError,
} from '#/errors/PlatformError'
import { abortableSleep, sleep } from '#/utils'
import type { IElementFinder } from './IElementFinder'

export async function connect(
  page: Page,
  loginConstants: {
    liveControlUrl: string
    loginUrlRegex: RegExp
    isInLiveControlSelector: string
  },
) {
  await page.goto(loginConstants.liveControlUrl, {
    waitUntil: 'domcontentloaded',
  })
  await Promise.race([
    page.waitForURL(loginConstants.loginUrlRegex, {
      timeout: 0,
      waitUntil: 'domcontentloaded',
    }),
    page.waitForSelector(loginConstants.isInLiveControlSelector, {
      timeout: 0,
      state: 'attached',
    }),
  ])

  const isConnected = !loginConstants.loginUrlRegex.test(page.url())
  return isConnected
}

export async function getAccountName(page: Page, accountNameSelector: string) {
  return page.waitForSelector(accountNameSelector).then(el => el.textContent())
}

export async function comment(
  page: Page,
  elementFinder: IElementFinder,
  message: string,
  pinTop?: boolean,
): Result.ResultAsync<boolean, PlatformError> {
  async function clickPinTopButton(page: Page): Result.ResultAsync<boolean, PlatformError> {
    return Result.pipe(
      elementFinder.getPinTopLabel(page),
      Result.inspect(label => label.dispatchEvent('click')),
      Result.map(_ => true),
      // 即使没有 pinTop 也不会中断程序
      Result.orElse(_ => Result.succeed(false)),
    )
  }

  /**
   * 点击「发送」按钮，并**校验评论确实发出去了**。
   *
   * 历史问题（用户反馈的「话术没发出去」）：这里以前只要在按钮上派发一次
   * `dispatchEvent('click')` 就直接返回成功，从不回读校验。但很多平台在
   * 「刚填完内容 / 连续发送 / 按钮短暂禁用 / 只认真实鼠标事件」时，这次 click
   * 会被丢弃，评论其实没提交，日志却记「发送成功」—— 造成「日志全绿、公屏没有」
   * 的假成功。现在改为：点击后回读评论框，确认内容已被清空（= 平台确实提交了），
   * 没有清空就换「真实点击」再试，全都带校验；最后才用回车兜底，同样要校验。
   */
  async function clickSend(page: Page): Result.ResultAsync<boolean, PlatformError> {
    const MAX_TRIES = 4
    /** 点击后等待评论框被清空的最长时间（平台提交 + 清空需要一点时间） */
    const SENT_TIMEOUT_MS = 1500
    const POLL_MS = 200

    /** 回读评论框：内容里已不含待发消息 → 视为已提交（成功发送的平台都会清空输入框） */
    async function isCleared(): Promise<boolean> {
      const taResult = await elementFinder.getCommentTextarea(page)
      if (Result.isFailure(taResult)) {
        // 连输入框都读不到，无法判定，保守地不当作已发送
        return false
      }
      let value = ''
      try {
        value = await taResult.value.inputValue()
      } catch {
        try {
          value = (await taResult.value.textContent()) ?? ''
        } catch {
          return false
        }
      }
      return !value.includes(message)
    }

    /** 轮询等待评论框清空 */
    async function waitUntilCleared(): Promise<boolean> {
      const deadline = Date.now() + SENT_TIMEOUT_MS
      while (Date.now() < deadline) {
        await sleep(POLL_MS)
        if (await isCleared()) {
          return true
        }
      }
      return false
    }

    let lastFailure: Result.Result<boolean, PlatformError> = Result.fail(
      new ElementNotFoundError({ elementName: '发送评论按钮', selector: '' }),
    )

    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      const btnResult = await elementFinder.getClickableSubmitCommentButton(page)
      if (Result.isSuccess(btnResult)) {
        // 前两次沿用各平台验证过的 dispatchEvent；后两次改用真实点击
        // （部分平台只认真实鼠标事件，合成 click 会被吞掉）
        try {
          if (attempt >= 3) {
            await btnResult.value.click({ timeout: 3000 })
          } else {
            await btnResult.value.dispatchEvent('click')
          }
        } catch {
          // 派发/点击本身报错不影响后续校验与重试
        }
        if (await waitUntilCleared()) {
          return Result.succeed(true)
        }
        lastFailure = Result.fail(
          new ElementContentMismatchedError({
            current: '点击发送后评论框未清空（判定未真正发出）',
            target: message,
          }),
        )
      } else {
        lastFailure = btnResult
      }
      // 非最后一次：等待按钮启用/出现后重试
      if (attempt < MAX_TRIES) {
        await sleep(250)
      }
    }

    // 最后兜底：直接按 Enter 发送评论（覆盖「按钮始终找不到/禁用」的情况），同样校验
    const taResult = await elementFinder.getCommentTextarea(page)
    if (Result.isSuccess(taResult)) {
      try {
        await taResult.value.press('Enter')
      } catch {
        // 忽略，走失败返回
      }
      if (await waitUntilCleared()) {
        return Result.succeed(true)
      }
    }
    return lastFailure
  }

  /**
   * 填写评论内容（带重试）。
   * `elementHandle.fill` 要求元素可见、可编辑、可聚焦，直播间页面（尤其是多平台同时跑、
   * 机器负载高时）经常 5 秒内完不成这些前置检查，直接报
   * 「elementHandle.fill: Timeout 5000ms exceeded」并中断整个任务 —— 回复就丢了。
   * 这里放宽单次超时，并在失败后重新查找元素再试（元素可能已被页面重渲染替换）。
   */
  async function fillComment(): Result.ResultAsync<boolean, PlatformError> {
    const MAX_TRIES = 3
    const FILL_TIMEOUT_MS = 10_000
    let lastFailure: Result.Result<boolean, PlatformError> = Result.fail(
      new ElementNotFoundError({ elementName: '评论框', selector: '' }),
    )
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      const taResult = await elementFinder.getCommentTextarea(page)
      if (Result.isFailure(taResult)) {
        lastFailure = taResult
      } else {
        try {
          await taResult.value.fill(message, { timeout: FILL_TIMEOUT_MS })
          return Result.succeed(true)
        } catch (err) {
          lastFailure = Result.fail(new UnexpectedError({ cause: err }))
        }
      }
      // 还有机会就等页面喘口气再重试
      if (attempt < MAX_TRIES) {
        await sleep(1000)
      }
    }
    return lastFailure
  }

  return Result.pipe(
    // 填写评论内容（带重试）
    fillComment(),
    // 点击置顶选项
    Result.andThen(_ => (pinTop ? clickPinTopButton(page) : Result.succeed(false))),
    // 发送评论（含重试与回车兜底）
    Result.andThrough(_ => clickSend(page)),
  )
}

/** 在虚拟列表中找到目标序号的位置 */
export async function getItemFromVirtualScroller(
  page: Page,
  elementFinder: IElementFinder,
  targetId: number,
  maxRetries = 10,
): Result.ResultAsync<ElementHandle<SVGElement | HTMLElement>, PlatformError> {
  const SCROLL_TOLERANCE = 10
  const LOAD_WAIT_MS = 1000

  /**
   * 在当前渲染的DOM节点中查找具有特定ID的商品。
   */
  async function findItemInCurrentView(id: number) {
    const currentGoodsItems = await elementFinder.getCurrentGoodsItemsList(page)
    if (Result.isFailure(currentGoodsItems)) {
      return currentGoodsItems
    }
    try {
      // 并发执行，效率比顺序遍历快了10倍以上
      const foundItem = await Promise.any(
        currentGoodsItems.value.map(async goodsItem => {
          const itemIdResult = await elementFinder.getIdFromGoodsItem(goodsItem)
          if (Result.isSuccess(itemIdResult) && itemIdResult.value === id) {
            return goodsItem
          }
          throw new Error('未匹配')
        }),
      )
      return Result.succeed(foundItem)
    } catch (err) {
      // Promise.any 全部出错抛出的错误为 AggregateError
      // 表示全部都未找到
      if (err instanceof AggregateError) {
        return Result.succeed(null)
      }
      return Result.fail(new UnexpectedError({ cause: err }))
    }
  }

  /**
   * 根据目标ID和当前列表的ID范围，决定下一个滚动的锚点元素（列表的第一个或最后一个）。
   */
  async function determineScrollTarget(
    id: number,
  ): Result.ResultAsync<ElementHandle<SVGElement | HTMLElement>, PlatformError> {
    const currentGoodsItems = await elementFinder.getCurrentGoodsItemsList(page)
    if (Result.isFailure(currentGoodsItems)) {
      return currentGoodsItems
    }

    const firstItem = currentGoodsItems.value[0]
    const lastItem = currentGoodsItems.value[currentGoodsItems.value.length - 1]

    return Result.pipe(
      Result.sequence([
        elementFinder.getIdFromGoodsItem(firstItem),
        elementFinder.getIdFromGoodsItem(lastItem),
      ]),
      Result.andThen(([firstId, lastId]) => {
        // 判断列表是正序还是倒序
        const isReversed = firstId > lastId
        // logger.warn(`商品 ${id} 不在当前范围 [${firstId} ~ ${lastId}]，继续滚动查找...`);
        // 目标ID小于当前范围的起始ID (正序) 或 大于 (倒序)，需要向上滚
        if ((!isReversed && id < firstId) || (isReversed && id > firstId)) {
          return Result.succeed(firstItem)
        }
        // 否则，向下滚
        return Result.succeed(lastItem)
      }),
    )
  }

  /**
   * 等待列表加载新内容。
   */
  async function waitForNewItemsToLoad() {
    // 最后的备选方案：短暂 sleep
    await sleep(LOAD_WAIT_MS)
  }

  let lastScrollTop = Number.NaN
  let retries = 0

  while (retries < maxRetries) {
    // 1. 在当前视图中查找
    const foundItem = await findItemInCurrentView(targetId)
    if (Result.isFailure(foundItem)) {
      return foundItem
    }
    if (foundItem.value) {
      return Result.succeed(foundItem.value)
    }

    // 1. 先找到目标点并滚动
    const scrollTarget = await determineScrollTarget(targetId)
    if (Result.isFailure(scrollTarget)) {
      return scrollTarget
    }
    await scrollTarget.value.scrollIntoViewIfNeeded({ timeout: 5000 })
    await waitForNewItemsToLoad()

    // 2. 获取当前的滚动位置
    const scrollContainer = await elementFinder.getGoodsItemsScrollContainer(page)
    if (Result.isFailure(scrollContainer)) {
      return scrollContainer
    }
    const currentScrollTop = await scrollContainer.value.evaluate(el => el.scrollTop)

    // 3. 检查是否滚动到底了 (终止条件)
    if (
      !Number.isNaN(lastScrollTop) &&
      Math.abs(lastScrollTop - currentScrollTop) <= SCROLL_TOLERANCE
    ) {
      // logger.debug(`滚动位置未改变，无法找到更多内容。ScrollTop: ${currentScrollTop}`);
      return Result.fail(
        new ElementNotFoundError({
          elementName: `id为${targetId}的商品`,
        }),
      )
    }
    lastScrollTop = currentScrollTop

    retries++
  }

  return Result.fail(
    new MaxTryCountExceededError({
      taskName: '查找商品',
      maxTryCount: maxRetries,
    }),
  )
}

const TOGGLE_BUTTON_MAX_TRY_COUNT = 5

/**
 * 「该商品已在讲解中」这类服务端拒绝的提示文案。
 * 小红书实测：点击列表行上的「讲解」后服务端返回「操作失败，该商品已在讲解中（B5218）」，
 * 而该行按钮文案仍然是「讲解」（前端不反映后端状态），于是会一直点到超限。
 */
const ALREADY_POPPING_NOTICE_TEXTS = ['已在讲解中']

/**
 * 在页面内执行：页面上是否存在包含指定文案的可见提示。
 * 只认「最内层命中的元素」—— 父容器同样包含该文案，只看 textContent 会整页误判。
 * 注意：本函数会被序列化到页面里执行，不能引用本模块作用域的任何变量。
 */
export function hasVisibleNoticeInPage(needles: string[]): boolean {
  const hit = (el: Element) => {
    const text = el.textContent ?? ''
    return needles.some(needle => text.includes(needle))
  }
  const isVisible = (el: Element) => {
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }
  const body = document.body
  if (!body || !hit(body)) {
    return false
  }
  for (const el of Array.from(body.querySelectorAll('*'))) {
    if (!hit(el)) continue
    if (Array.from(el.children).some(hit)) continue
    if (isVisible(el)) return true
  }
  return false
}

/** 检查讲解按钮所在页面（含子 frame）上是否出现了指定提示 */
async function hasVisibleNotice(
  button: ElementHandle<SVGElement | HTMLElement>,
  needles: string[],
): Promise<boolean> {
  try {
    const frame = await button.ownerFrame()
    if (!frame) return false
    const frames: Frame[] = [frame]
    for (let i = 0; i < frames.length; i++) {
      const current = frames[i]
      try {
        if (await current.evaluate(hasVisibleNoticeInPage, needles)) return true
      } catch {
        // 跨域 frame / 已销毁，跳过
      }
      frames.push(...current.childFrames())
    }
  } catch {
    // 句柄已脱离 DOM 等情况，按「没有提示」处理，交给原有的重试逻辑
  }
  return false
}

/** 读取按钮文案；句柄脱离 DOM 时返回 null（交给上层重试） */
async function readButtonText(
  button: ElementHandle<SVGElement | HTMLElement>,
): Promise<string | null> {
  try {
    return (await button.textContent())?.trim() ?? ''
  } catch {
    return null
  }
}

export async function toggleButton(
  button: ElementHandle<SVGElement | HTMLElement>,
  sourceContent: string,
  targetContent: string,
  signal?: AbortSignal,
  tryCount = 0,
): Result.ResultAsync<void, Error> {
  if (tryCount > TOGGLE_BUTTON_MAX_TRY_COUNT) {
    return Result.fail(
      new MaxTryCountExceededError({
        taskName: 'toggleButton',
        maxTryCount: TOGGLE_BUTTON_MAX_TRY_COUNT,
      }),
    )
  }
  // 列表在「读文字」与「读禁用态」之间可能重渲染，按钮句柄会脱离 DOM。
  // 这类瞬态异常不应让整个任务永久停掉 —— 转成可重试的 ElementNotFoundError，
  // 上层（runWithRetry）会用全新句柄重新取按钮，下一次通常就能成功。
  const buttonText = await readButtonText(button)
  if (buttonText === null) {
    return Result.fail(new ElementNotFoundError({ elementName: '讲解按钮' }))
  }
  if (buttonText !== sourceContent && buttonText !== targetContent) {
    return Result.fail(
      new ElementContentMismatchedError({
        current: buttonText,
        target: `${targetContent} 或 ${sourceContent}`,
      }),
    )
  }

  // 两种情况：
  // 1. 商品未讲解：buttonText === sourceContent，点击变为 targetContent 即可
  // 2. 商品正在讲解：需要先点击一次取消讲解，变为未讲解状态
  if (buttonText === targetContent && tryCount > 0) {
    return Result.succeed()
  }
  let disabled = false
  try {
    disabled = await button.isDisabled()
  } catch (e) {
    // 同上：按钮脱离 DOM 属瞬态，交给重试；其余异常（如超时）仍上抛
    if (
      /not attached to the (DOM|node)|stale|execution context|detached/i.test(
        String((e as Error)?.message ?? e),
      )
    ) {
      return Result.fail(new ElementNotFoundError({ elementName: '讲解按钮' }))
    }
    throw e
  }
  if (disabled) {
    return Result.fail(
      new ElementDisabledError({
        elementName: '讲解按钮',
        element: await button.evaluate(el => el.outerHTML).catch(() => ''),
      }),
    )
  }
  // button.click() 在抖店&百应的表现很诡异，所以用 dispatchEvent('click')
  await button.dispatchEvent('click')
  const sleepResult = await abortableSleep(1000, signal)
  if (Result.isFailure(sleepResult)) {
    return sleepResult
  }

  // 点击后按钮文案没变化，有两种可能，必须分开处理：
  // 1. 服务端认为该商品「已在讲解中」（小红书 B5218）—— 本任务的目标态就是「讲解中」，
  //    目标已经达成，应判成功；否则会一直点到超限，把整个自动弹窗任务拖停。
  // 2. 点击真的没生效 —— 继续重试。
  // 用「页面上是否出现『已在讲解中』提示」区分这两种情况。
  const afterText = await readButtonText(button)
  if (afterText === buttonText && (await hasVisibleNotice(button, ALREADY_POPPING_NOTICE_TEXTS))) {
    return Result.succeed()
  }

  return toggleButton(button, sourceContent, targetContent, signal, tryCount + 1)
}

/**
 * 一次性动作按钮（非切换型）：点击后按钮文案从 idleText 变为以 successPrefix 开头的状态。
 * 典型场景：小红书「弹卡」——空闲态「弹卡」，点击后变「弹卡中 (15s)」倒计时，
 * 15 秒后自动收回卡片。与 toggleButton 的区别：倒计时文案每次都不同（弹卡中 (15s)/(14s)…），
 * 无法按精确文案判断，故用前缀判断；且只点一次、不做「取消」切换。
 */
export async function clickOnceButton(
  button: ElementHandle<SVGElement | HTMLElement>,
  idleText: string,
  successPrefix: string,
  signal?: AbortSignal,
): Result.ResultAsync<void, Error> {
  const buttonText = await readButtonText(button)
  if (buttonText === null) {
    return Result.fail(new ElementNotFoundError({ elementName: '弹卡按钮' }))
  }
  // 已经是「弹卡中 (Ns)」：卡片正在展示，目标态已达成，无需重复点击
  if (buttonText.startsWith(successPrefix)) {
    return Result.succeed()
  }
  if (buttonText !== idleText) {
    return Result.fail(
      new ElementContentMismatchedError({
        current: buttonText,
        target: `${idleText} 或 ${successPrefix}*`,
      }),
    )
  }
  let disabled = false
  try {
    disabled = await button.isDisabled()
  } catch (e) {
    // 句柄脱离 DOM 属瞬态，交给上层重试
    if (
      /not attached to the (DOM|node)|stale|execution context|detached/i.test(
        String((e as Error)?.message ?? e),
      )
    ) {
      return Result.fail(new ElementNotFoundError({ elementName: '弹卡按钮' }))
    }
    throw e
  }
  if (disabled) {
    return Result.fail(
      new ElementDisabledError({
        elementName: '弹卡按钮',
        element: await button.evaluate(el => el.outerHTML).catch(() => ''),
      }),
    )
  }
  // 小红书「弹卡」是 div（非 button）。dispatchEvent('click') 生成的是非 trusted 事件，
  // 不会触发它的点击处理（实测点击后文案仍停在「弹卡」，报「元素内容不匹配」）。
  // 改用真实鼠标点击（Playwright 经 CDP 派发 mousedown/mouseup/click，事件为 trusted），
  // 可覆盖只认真实指针事件的组件；真实点击失败（被遮挡/不稳定）时再退回 dispatchEvent 兜底。
  try {
    await button.click({ timeout: 3000 })
  } catch {
    await button.dispatchEvent('click').catch(() => {})
  }
  // 点击后「弹卡中 (15s)」文案可能有网络/渲染延迟，轮询最多约 4 秒确认（8 × 500ms）
  for (let i = 0; i < 8; i++) {
    const sleepResult = await abortableSleep(500, signal)
    if (Result.isFailure(sleepResult)) {
      return sleepResult
    }
    const afterText = await readButtonText(button)
    // 点完列表重渲染导致句柄失效时无法判定，但点击已派发，按成功处理避免重复弹卡
    if (afterText === null || afterText.startsWith(successPrefix)) {
      return Result.succeed()
    }
  }
  const finalText = await readButtonText(button)
  return Result.fail(
    new ElementContentMismatchedError({
      current: finalText ?? '(句柄已失效)',
      target: `${successPrefix}*`,
    }),
  )
}

/** 确保 page 非空 */
export function ensurePage(page: Page | null | undefined): Result.Result<Page, PlatformError> {
  if (!page) {
    return Result.fail(new PageNotFoundError())
  }
  return Result.succeed(page)
}

/** 通过 \<a\> 的点击打开新网页，主要是防止部分反爬的行为 */
export async function openUrlByElement(page: Page, url: string) {
  const context = page.context()
  const [newPage] = await Promise.all([
    context.waitForEvent('page'),
    page.evaluate(url => {
      const el = document.createElement('a')
      el.href = url
      el.target = '_blank'
      el.click()
    }, url),
  ])
  return newPage
}
