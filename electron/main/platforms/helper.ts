import { Result } from '@praha/byethrow'
import type { ElementHandle, Page } from 'playwright'
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
   * 点击「发送」按钮。评论框填充后发送按钮常会短暂处于禁用/未就绪状态，
   * 直接点击容易失败导致「监测到却不回复」。这里加重试：点击失败（禁用或找不到）
   * 时等待片刻再试；穷尽重试仍失败则用「回车」兜底发送。
   */
  async function clickSend(page: Page): Result.ResultAsync<boolean, PlatformError> {
    const MAX_TRIES = 4
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      const btnResult = await elementFinder.getClickableSubmitCommentButton(page)
      if (Result.isSuccess(btnResult)) {
        await btnResult.value.dispatchEvent('click')
        return Result.succeed(true)
      }
      // 非最后一次：等待按钮启用/出现后重试
      if (attempt < MAX_TRIES - 1) {
        await sleep(250)
        continue
      }
      // 最后一次兜底：直接按 Enter 发送评论（覆盖「找不到」与「禁用」两种情况）
      const taResult = await elementFinder.getCommentTextarea(page)
      if (Result.isSuccess(taResult)) {
        await taResult.value.press('Enter')
        return Result.succeed(true)
      }
      return btnResult
    }
    // 理论上不会走到这里；仍做一次回车兜底
    const lastTa = await elementFinder.getCommentTextarea(page)
    if (Result.isSuccess(lastTa)) {
      await lastTa.value.press('Enter')
      return Result.succeed(true)
    }
    return Result.fail(new ElementNotFoundError({ elementName: '发送评论按钮', selector: '' }))
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
  const buttonText = (await button.textContent())?.trim() || ''
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
  if (await button.isDisabled()) {
    return Result.fail(
      new ElementDisabledError({
        elementName: '讲解按钮',
        element: await button.evaluate(el => el.outerHTML),
      }),
    )
  }
  // button.click() 在抖店&百应的表现很诡异，所以用 dispatchEvent('click')
  await button.dispatchEvent('click')
  return Result.pipe(
    abortableSleep(1000, signal),
    Result.andThen(() => toggleButton(button, sourceContent, targetContent, signal, tryCount + 1)),
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
