import { Result } from '@praha/byethrow'
import type { ElementHandle, Locator, Page } from 'playwright'
import {
  ElementContentMismatchedError,
  ElementNotFoundError,
  type PlatformError,
} from '#/errors/PlatformError'

export interface IElementFinder {
  /** 从单个商品详情中获取弹窗按钮 */
  getPopUpButtonFromGoodsItem(
    item: ElementHandle<SVGElement | HTMLElement>,
  ): Result.ResultAsync<ElementHandle<HTMLElement | SVGElement>, PlatformError>

  getIdFromGoodsItem(
    item: ElementHandle<SVGElement | HTMLElement>,
  ): Result.ResultAsync<number, PlatformError>

  /** 能保证商品列表不为空 */
  getCurrentGoodsItemsList(
    page: Page,
  ): Result.ResultAsync<ElementHandle<SVGElement | HTMLElement>[], PlatformError>

  getGoodsItemsScrollContainer(
    page: Page,
  ): Result.ResultAsync<ElementHandle<SVGElement | HTMLElement>, PlatformError>

  getCommentTextarea(
    page: Page,
  ): Result.ResultAsync<ElementHandle<SVGElement | HTMLElement> | Locator, PlatformError>

  getClickableSubmitCommentButton(
    page: Page,
  ): Result.ResultAsync<ElementHandle<SVGElement | HTMLElement>, PlatformError>

  /** 获取评论置顶标签，如果置顶标签不存在返回 Fail */
  getPinTopLabel(
    page: Page,
  ): Result.ResultAsync<ElementHandle<SVGElement | HTMLElement>, PlatformError>
}

/**
 * 跨框架查找元素。小红书直播中控台的评论区常嵌在 iframe 内，
 * 主框架的 page.$(selector) 找不到，需要遍历所有 frame 逐个尝试候选选择器。
 */
export async function queryAcrossFrames(
  page: Page,
  candidates: string[],
): Promise<ElementHandle<SVGElement | HTMLElement> | null> {
  for (const selector of candidates) {
    for (const frame of page.frames()) {
      try {
        const el = await frame.$(selector)
        if (el) {
          return el as ElementHandle<SVGElement | HTMLElement>
        }
      } catch {
        // 某些选择器在当前 frame 下可能抛错，跳过继续尝试下一个
      }
    }
  }
  return null
}

export const commonElementFinder = {
  async getIdFromGoodsItem(
    item: ElementHandle<SVGElement | HTMLElement>,
    idSelector: string,
    textContent = false,
  ) {
    const idInput = textContent
      ? await (await item.$(idSelector))?.textContent()
      : await (await item.$(idSelector))?.inputValue()
    if (!idInput) {
      return Result.fail(
        new ElementNotFoundError({
          elementName: '商品ID',
          selector: idSelector,
        }),
      )
    }
    const id = Number.parseInt(idInput, 10)
    if (Number.isNaN(id)) {
      return Result.fail(
        new ElementContentMismatchedError({
          current: idInput,
          target: '数字',
        }),
      )
    }
    return Result.succeed(id)
  },

  async getCommentTextarea(page: Page, textareaSelector: string | readonly string[]) {
    const candidates = Array.isArray(textareaSelector) ? [...textareaSelector] : [textareaSelector]
    const textarea = await queryAcrossFrames(page, candidates)
    if (!textarea) {
      return Result.fail(
        new ElementNotFoundError({
          elementName: '评论框',
          selector: candidates.join(' | '),
        }),
      )
    }
    return Result.succeed(textarea)
  },

  async getGoodsItemsScrollContainer(page: Page, containerSelector: string) {
    const scrollContainer = await page.$(containerSelector)
    if (!scrollContainer) {
      return Result.fail(
        new ElementNotFoundError({
          elementName: '商品列表滚动容器',
          selector: containerSelector,
        }),
      )
    }
    return Result.succeed(scrollContainer)
  },

  async getCurrentGoodsItemsList(page: Page, itemSelector: string) {
    const items = await page.$$(itemSelector)
    if (items.length === 0) {
      return Result.fail(
        new ElementNotFoundError({
          elementName: '商品列表',
          selector: itemSelector,
        }),
      )
    }
    return Result.succeed(items)
  },

  async getPinTopLabel(page: Page, labelSelector: string) {
    const label = await page.$(labelSelector)
    if (!label) {
      return Result.fail(
        new ElementNotFoundError({
          elementName: '评论置顶标签',
          selector: labelSelector,
        }),
      )
    }
    return Result.succeed(label)
  },

  async getEmptyPinTopLabel() {
    return Result.fail(new ElementNotFoundError({ elementName: '置顶选项' }))
  },
}
