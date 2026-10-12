import { Result } from '@praha/byethrow'
import type { ElementHandle, Page } from 'playwright'
import { ElementDisabledError, ElementNotFoundError } from '#/errors/PlatformError'
import { commonElementFinder, type IElementFinder, queryAcrossFrames } from '../IElementFinder'
import { SELECTORS } from './constant'

export const kuaishouElementFinder: IElementFinder = {
  async getPopUpButtonFromGoodsItem(item: ElementHandle<SVGElement | HTMLElement>) {
    const button = await item.$(SELECTORS.goodsItem.POPUP_BUTTON)
    if (!button) {
      return Result.fail(
        new ElementNotFoundError({
          elementName: '弹窗按钮',
          selector: SELECTORS.goodsItem.POPUP_BUTTON,
        }),
      )
    }
    return Result.succeed(button)
  },

  async getIdFromGoodsItem(item: ElementHandle<SVGElement | HTMLElement>) {
    return commonElementFinder.getIdFromGoodsItem(item, SELECTORS.goodsItem.ID)
  },

  async getCurrentGoodsItemsList(page: Page) {
    const items = await commonElementFinder.getCurrentGoodsItemsList(page, SELECTORS.GOODS_ITEM)
    if (Result.isFailure(items)) {
      return items
    }
    // 过滤掉置顶的正在弹窗商品（因为没有序号）
    // 每个 item 都有 id，过滤掉以 recording 结尾的 id（如 inner_c1goods-xxxxxxxxxx-recording）
    const filteredItems = []
    for (const item of items.value) {
      if (!(await item.getAttribute('id'))?.endsWith('recording')) {
        filteredItems.push(item)
      }
    }
    return Result.succeed(filteredItems)
  },

  async getGoodsItemsScrollContainer(page: Page) {
    return commonElementFinder.getGoodsItemsScrollContainer(page, SELECTORS.GOODS_ITEMS_WRAPPER)
  },

  getCommentTextarea(page: Page) {
    // 多候选选择器：快手回复框可能是 input[type=text] 也可能是 textarea，
    // 且 class 前缀可能变化，跨候选兜底提高命中率。
    return commonElementFinder.getCommentTextarea(page, [
      SELECTORS.commentInput.TEXTAREA,
      'div[class*=reply-content] input[type=text]',
      'div[class*=reply-content] textarea',
    ])
  },

  async getClickableSubmitCommentButton(page: Page) {
    const candidates = [SELECTORS.commentInput.SUBMIT_BUTTON, 'div[class*=reply-content] button']
    const submitButton = await queryAcrossFrames(page, candidates)
    if (!submitButton) {
      return Result.fail(
        new ElementNotFoundError({
          elementName: '提交评论按钮',
          selector: candidates.join(' | '),
        }),
      )
    }
    if (await submitButton.isDisabled()) {
      return Result.fail(
        new ElementDisabledError({
          elementName: '提交评论按钮',
          element: await submitButton.evaluate(el => el.outerHTML),
        }),
      )
    }
    return Result.succeed(submitButton)
  },

  /**
   * 快手置顶机制：评论框下方有「☐ 置顶评论」复选框，**勾选后再点发送**，该条评论即被置顶。
   * 所以这里要返回那个复选框（或其可点击的 label），由 helper 的 comment() 在「发送前」点击它。
   *
   * 注意顺序：必须先勾选、再发送。原选择器 `div[class^=reply-content] label` 命中不到该复选框
   * （页面上并没有这样的 <label>），导致点击链路一直静默失败（helper 里 orElse 吞掉了错误）。
   * 这里按「精确选择器 → 容器内文本搜索」逐级兜底，原生 checkbox 与自定义复选框都能定位。
   */
  async getPinTopLabel(page: Page) {
    // 1) 快速路径：常见选择器 / 限定回复框容器内按文本匹配
    const quickSelectors = [
      SELECTORS.commentInput.PIN_TOP_LABEL,
      'div[class^=reply-content] label',
      'div[class*=reply-content] label',
    ]
    for (const selector of quickSelectors) {
      const el = await page.$(selector).catch(() => null)
      if (el) {
        return Result.succeed(el as ElementHandle<SVGElement | HTMLElement>)
      }
    }

    // 2) JS 兜底：在回复框容器内按「置顶」文本定位复选框（不依赖是否为 <label>）
    const handle = await page.evaluateHandle(() => {
      const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '')
      // 命中「置顶评论」，排除「取消置顶」「已置顶」等反向/状态文案
      const isPinText = (t: string) =>
        t.includes('置顶') && !t.includes('取消置顶') && !t.includes('已置顶')

      // 先把搜索范围限定在「回复框」容器内，避免命中公屏评论里的「置顶」字样
      const scopeSelectors = [
        'div[class*=reply-content]',
        'div[class*=replyContent]',
        'div[class*=comment-input]',
      ]
      const roots: Element[] = []
      for (const s of scopeSelectors) {
        roots.push(...Array.from(document.querySelectorAll(s)))
      }
      const scopes: (Element | Document)[] = roots.length > 0 ? roots : [document]

      // 文本元素 → 就近的原生 checkbox / 自定义复选框 / 可点击容器
      const isCheckboxish = (n: Element | null | undefined): n is Element =>
        !!n &&
        n.matches('input[type=checkbox], [role=checkbox], [class*=checkbox], [class*=Checkbox]')
      const pickClickable = (el: Element): Element => {
        // 1) 相邻兄弟（自定义复选框常是文本节点的兄弟节点，而非父子）
        const prev = el.previousElementSibling
        const next = el.nextElementSibling
        if (isCheckboxish(prev)) return prev
        if (isCheckboxish(next)) return next
        // 2) 父级 label 内 / 父级子树内的原生 checkbox（会顺带覆盖「兄弟子树里的 input」）
        return (
          (el.closest('label')?.querySelector('input[type=checkbox]') as Element | null) ??
          (el.parentElement?.querySelector('input[type=checkbox]') as Element | null) ??
          (el.closest('[role=checkbox], [class*=checkbox], [class*=Checkbox]') as Element | null) ??
          (el.closest('label') as Element | null) ??
          el.parentElement ??
          el
        )
      }

      for (const scope of scopes) {
        // a) 原生 label 且含「置顶」文本
        for (const lb of Array.from(scope.querySelectorAll('label'))) {
          if (isPinText(norm(lb.textContent))) {
            return (lb.querySelector('input[type=checkbox]') as Element | null) ?? lb
          }
        }
        // b) 含「置顶」文本的最内层元素
        const textEls = Array.from(scope.querySelectorAll<HTMLElement>('*')).filter(el =>
          isPinText(norm(el.textContent)),
        )
        if (textEls.length > 0) {
          textEls.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)
          return pickClickable(textEls[0])
        }
        // c) 兜底：容器内第一个复选框
        const cb = scope.querySelector('input[type=checkbox]')
        if (cb) return cb
      }
      return null
    })

    const pinTopLabel = handle.asElement() as ElementHandle<SVGElement | HTMLElement> | null
    if (!pinTopLabel) {
      return Result.fail(
        new ElementNotFoundError({
          elementName: '置顶选项（置顶评论）',
          selector: SELECTORS.commentInput.PIN_TOP_LABEL,
        }),
      )
    }
    return Result.succeed(pinTopLabel)
  },
}
