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

  /**
   * 真 @ 专用：在互动评论列表里按内容找到目标那条评论的节点。
   *
   * 可选实现——只有抖音/百应的中控台才有该评论列表 DOM；未实现或找不到时
   * 返回 null，调用方会自动回退到纯文本发送，不会丢回复。
   *
   * 返回 ElementHandle 或 Locator 均可：helper 只用它做「点击触发回复」和 DOM 快照。
   */
  findCommentItem?(
    page: Page,
    content: string,
  ): Promise<ElementHandle<SVGElement | HTMLElement> | Locator | null>

  /**
   * 真 @ 专用：找到目标评论后，触发平台的「回复」动作
   * （通常是「点评论唤出悬浮工具栏 → 点工具栏里的回复项」），
   * 让平台把 mention 插进评论输入框。
   *
   * 各平台的评论列表 DOM 与悬浮工具栏结构完全不同，由各平台自行实现；
   * 未实现时 helper 会用内置的默认实现（百应那套），再不行就退化成点评论本体。
   */
  clickMentionEntry?(
    page: Page,
    item: ElementHandle<SVGElement | HTMLElement> | Locator,
  ): Promise<void>

  /**
   * 真 @ 专用：读取「输入区当前是否已插入 mention」的判定文本。
   *
   * 默认用评论输入框的 value 判定，但有些平台（视频号）把 mention 渲染成输入框之外
   * 的 chip——输入框里显示着「回复 昵称」，可 textarea 的 value 是空的，
   * 光读 value 永远判定不到。这种平台应实现本方法，返回整个输入容器的文本
   * （chip 的文本会包含在里面）。返回 null = 用默认判定。
   */
  getMentionProbeText?(page: Page): Promise<string | null>
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
