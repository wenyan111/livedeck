import { Result } from '@praha/byethrow'
import type { ElementHandle, Page } from 'playwright'
import { ElementDisabledError, ElementNotFoundError } from '#/errors/PlatformError'
import { commonElementFinder, type IElementFinder } from '../IElementFinder'
import { SELECTORS, TEXTS } from './constant'
import {
  dumpGoodsDiagnostics,
  findTaggedFrame,
  isDisabledInPage,
  MARK,
  tagGoodsRows,
} from './goods-list'

/**
 * 从元素句柄读取「商品序号」。
 * - 新版（蒲公英 2026-09）：序号是 `.goods-card__index` 里的**输入框**，值在 value / placeholder 上
 * - 旧版（千帆）：表格第一列 input 的 value
 * - 语义标记命中时：元素可能是输入框，也可能是纯文本数字
 */
async function readIndexFromHandle(
  el: ElementHandle<SVGElement | HTMLElement>,
): Promise<number | null> {
  try {
    const raw = await el.evaluate(node => {
      const isField = (target: Element) =>
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT'
      if (isField(node)) {
        const field = node as HTMLInputElement
        return String(field.value || field.placeholder || '').trim()
      }
      const inner = node.querySelector('input')
      if (inner) {
        const field = inner as HTMLInputElement
        const value = String(field.value || field.placeholder || '').trim()
        if (/^\d{1,4}$/.test(value)) {
          return value
        }
      }
      return (node.textContent ?? '').trim()
    })
    if (!/^\d{1,4}$/.test(raw)) {
      return null
    }
    const value = Number.parseInt(raw, 10)
    return Number.isNaN(value) ? null : value
  } catch {
    return null
  }
}

/**
 * 读取商品行上的「商品序号」。
 * 优先用 goods-list.ts 打的语义标记，再看新版/旧版的序号输入框。
 */
async function readGoodsIndex(
  item: ElementHandle<SVGElement | HTMLElement>,
): Promise<number | null> {
  const marked = await item.$(`[${MARK.INDEX}]`)
  if (marked) {
    const index = await readIndexFromHandle(marked)
    if (index !== null) {
      return index
    }
  }
  for (const selector of SELECTORS.GOODS_ITEM_INNER.INDEX_CANDIDATES) {
    try {
      const el = await item.$(selector)
      if (!el) {
        continue
      }
      const index = await readIndexFromHandle(el)
      if (index !== null) {
        return index
      }
    } catch {
      // 该选择器在当前结构下不可用，继续尝试下一个
    }
  }
  return null
}

export const xiaohongshuElementFinder: IElementFinder = {
  async getPopUpButtonFromGoodsItem(item: ElementHandle<SVGElement | HTMLElement>) {
    // 1. 语义 / 新版标记（由 goods-list.ts 打标）
    const marked = await item.$(`[${MARK.POPUP}]`)
    if (marked) {
      if (await marked.evaluate(isDisabledInPage)) {
        return Result.fail(
          new ElementDisabledError({
            elementName: '讲解',
            element: await marked.evaluate(el => el.outerHTML),
          }),
        )
      }
      return Result.succeed(marked)
    }

    // 2. 新版操作按钮区：按文案精确匹配「讲解 / 结束讲解」
    //    （「讲解」与「结束讲解」的 class 完全相同，只能靠文案区分）
    try {
      const actionRow = await item.$(SELECTORS.GOODS_ITEM_INNER.ACTION_ROW)
      if (actionRow) {
        const buttons = await actionRow.$$(SELECTORS.GOODS_ITEM_INNER.ACTION_BUTTON)
        for (const button of buttons) {
          const text = (await button.textContent())?.trim() ?? ''
          if (text === TEXTS.POPUP_BUTTON || text === TEXTS.POPUP_BUTTON_CANCLE) {
            if (await button.evaluate(isDisabledInPage)) {
              return Result.fail(
                new ElementDisabledError({
                  elementName: '讲解',
                  element: await button.evaluate(el => el.outerHTML),
                }),
              )
            }
            return Result.succeed(button)
          }
        }
      }
    } catch {
      // 新版结构不存在，继续走旧版逻辑
    }

    // 3. 旧版：行内操作面板中的 .operation-item
    const pannel = await item.$(SELECTORS.GOODS_ITEM_INNER.OPERATION_PANNEL)
    if (!pannel) {
      return Result.fail(
        new ElementNotFoundError({
          elementName: '操作面板',
          selector: `${SELECTORS.GOODS_ITEM_INNER.ACTION_ROW} | ${SELECTORS.GOODS_ITEM_INNER.OPERATION_PANNEL}`,
        }),
      )
    }
    const operations = await pannel.$$(SELECTORS.GOODS_ITEM_INNER.OPERATION_ITEM)
    for (const operation of operations) {
      if ((await operation.textContent())?.includes(TEXTS.POPUP_BUTTON)) {
        if (
          await operation.evaluate(
            (e, SELECTORS) =>
              e.classList.contains(SELECTORS.GOODS_ITEM_INNER.POPUP_BUTTON_DISABLED),
            SELECTORS,
          )
        ) {
          return Result.fail(
            new ElementDisabledError({
              elementName: '讲解',
              element: await operation.evaluate(el => el.outerHTML),
            }),
          )
        }
        return Result.succeed(operation)
      }
    }
    return Result.fail(
      new ElementNotFoundError({
        elementName: '讲解按钮',
      }),
    )
  },

  async getIdFromGoodsItem(item: ElementHandle<SVGElement | HTMLElement>) {
    const id = await readGoodsIndex(item)
    if (id === null) {
      return Result.fail(
        new ElementNotFoundError({
          elementName: '商品序号',
          selector: `${MARK.INDEX} | ${SELECTORS.GOODS_ITEM_INNER.INDEX_CANDIDATES.join(' | ')}`,
        }),
      )
    }
    return Result.succeed(id)
  },

  async getCurrentGoodsItemsList(page: Page) {
    // 1. 结构化选择器（新版 .goods-card 优先，旧版表格兜底），并用「能读出商品序号」做校验
    for (const selector of SELECTORS.GOODS_ITEM_CANDIDATES) {
      for (const frame of page.frames()) {
        try {
          const items = (await frame.$$(selector)) as ElementHandle<
            SVGElement | HTMLElement
          >[]
          if (items.length === 0) {
            continue
          }
          if ((await readIndexFromHandle(items[0])) !== null) {
            return Result.succeed(items)
          }
          // 新版首行是「直播渠道 · 置顶」行，它没有序号框；这类行必须排除，
          // 否则滚动锚点取到的「首个商品序号」是空的，整段滚动查找会失败。
          const valid: ElementHandle<SVGElement | HTMLElement>[] = []
          for (const item of items) {
            if ((await readIndexFromHandle(item)) !== null) {
              valid.push(item)
            }
          }
          if (valid.length > 0) {
            return Result.succeed(valid)
          }
        } catch {
          // 选择器在当前 frame 下不可用，继续尝试
        }
      }
    }

    // 2. 语义定位兜底：不依赖任何 class 名（标记出来的行都已带序号）
    const frame = await tagGoodsRows(page)
    if (frame) {
      try {
        const items = (await frame.$$(`[${MARK.ROW}]`)) as ElementHandle<
          SVGElement | HTMLElement
        >[]
        if (items.length > 0) {
          return Result.succeed(items)
        }
      } catch {
        // 继续走失败分支
      }
    }

    // 3. 失败：导出页面结构，便于官方再次改版时快速对照修复
    const filePath = await dumpGoodsDiagnostics(page)
    return Result.fail(
      new ElementNotFoundError({
        elementName: `商品列表${filePath ? `（已导出诊断文件：${filePath}）` : ''}`,
        selector: SELECTORS.GOODS_ITEM_CANDIDATES.join(' | '),
      }),
    )
  },

  async getGoodsItemsScrollContainer(page: Page) {
    // 1. 结构化选择器快速通道（新版 .goods-card-list 在前）
    for (const selector of SELECTORS.GOODS_ITEMS_WRAPPER_CANDIDATES) {
      for (const frame of page.frames()) {
        try {
          const container = await frame.$(selector)
          if (container) {
            return Result.succeed(container as ElementHandle<SVGElement | HTMLElement>)
          }
        } catch {
          // 继续尝试
        }
      }
    }

    // 2. 语义定位：先用已有标记，没有标记时重新标记一次
    let frame = await findTaggedFrame(page)
    if (!frame) {
      frame = await tagGoodsRows(page)
    }
    if (frame) {
      try {
        const container = await frame.$(`[${MARK.CONTAINER}]`)
        if (container) {
          return Result.succeed(container as ElementHandle<SVGElement | HTMLElement>)
        }
      } catch {
        // 继续走失败分支
      }
    }

    return Result.fail(
      new ElementNotFoundError({
        elementName: '商品列表滚动容器',
        selector: `${SELECTORS.GOODS_ITEMS_WRAPPER_CANDIDATES.join(' | ')} | ${MARK.CONTAINER}`,
      }),
    )
  },

  getCommentTextarea(page: Page) {
    return commonElementFinder.getCommentTextarea(page, SELECTORS.COMMENT_INPUT.TEXTAREA_CANDIDATES)
  },

  async getClickableSubmitCommentButton(page: Page) {
    const candidates = SELECTORS.COMMENT_INPUT.SUBMIT_BUTTON_CANDIDATES
    let submitButton: ElementHandle<SVGElement | HTMLElement> | null = null
    for (const selector of candidates) {
      for (const frame of page.frames()) {
        try {
          const el = await frame.$(selector)
          if (el) {
            submitButton = el as ElementHandle<SVGElement | HTMLElement>
            break
          }
        } catch {
          // 跳过，尝试下一个选择器 / 框架
        }
      }
      if (submitButton) break
    }
    if (!submitButton) {
      return Result.fail(
        new ElementNotFoundError({
          elementName: '发送评论按钮',
          selector: candidates.join(' | '),
        }),
      )
    }
    if (
      await submitButton.evaluate(
        (el, disabledClass) => (el as HTMLElement).className.includes(disabledClass),
        SELECTORS.COMMENT_INPUT.SUBMIT_BUTTON_DISABLED,
      )
    ) {
      return Result.fail(
        new ElementDisabledError({
          elementName: '发送评论按钮',
          element: await submitButton.evaluate(el => el.outerHTML),
        }),
      )
    }
    return Result.succeed(submitButton)
  },

  async getPinTopLabel() {
    return commonElementFinder.getEmptyPinTopLabel()
  },
}
