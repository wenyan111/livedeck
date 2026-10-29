import { Result } from '@praha/byethrow'
import type { ElementHandle, Page } from 'playwright'
import { ElementDisabledError, ElementNotFoundError } from '#/errors/PlatformError'
import { commonElementFinder, type IElementFinder } from '../IElementFinder'
import { SELECTORS, TEXTS } from './constant'

export const douyinElementFinder: IElementFinder = {
  async getPinTopLabel(page: Page) {
    const pinTopLabel = await page.$(SELECTORS.commentInput.PIN_TOP_LABEL)
    if (!pinTopLabel) {
      return Result.fail(
        new ElementNotFoundError({
          elementName: '置顶选项',
          selector: SELECTORS.commentInput.PIN_TOP_LABEL,
        }),
      )
    }
    return Result.succeed(pinTopLabel)
  },

  async getClickableSubmitCommentButton(page: Page) {
    const submit_btn = await page.$(SELECTORS.commentInput.SUBMIT_BUTTON)
    if (!submit_btn) {
      return Result.fail(
        new ElementNotFoundError({
          elementName: '提交评论按钮',
          selector: SELECTORS.commentInput.SUBMIT_BUTTON,
        }),
      )
    }
    if (
      (await submit_btn.getAttribute('class'))?.includes(
        SELECTORS.commentInput.SUBMIT_BUTTON_DISABLED,
      )
    ) {
      return Result.fail(
        new ElementDisabledError({
          elementName: '提交评论按钮',
          element: await submit_btn.evaluate(el => el.outerHTML),
        }),
      )
    }
    return Result.succeed(submit_btn)
  },

  async getPopUpButtonFromGoodsItem(item: ElementHandle<SVGElement | HTMLElement>) {
    const goodsAction = await item.$(SELECTORS.goodsItem.ACTION)
    if (!goodsAction) {
      return Result.fail(
        new ElementNotFoundError({
          elementName: '商品操作面板',
          selector: SELECTORS.goodsItem.ACTION,
        }),
      )
    }
    // 2025.11.5 目前第一个按钮被替换成了【更多】，换成获取文本包含“讲解”的按钮
    let button = null
    for (const btn of await goodsAction.$$(SELECTORS.goodsItem.POPUP_BUTTON)) {
      if ((await btn.textContent())?.includes(TEXTS.POPUP_BUTTON)) {
        button = btn
        break
      }
    }
    if (!button) {
      return Result.fail(
        new ElementNotFoundError({
          elementName: '讲解按钮',
          selector: SELECTORS.goodsItem.POPUP_BUTTON,
        }),
      )
    }
    return Result.succeed(button)
  },

  async getGoodsItemsScrollContainer(page: Page) {
    return commonElementFinder.getGoodsItemsScrollContainer(page, SELECTORS.GOODS_ITEMS_WRAPPER)
  },

  async getCurrentGoodsItemsList(page: Page) {
    return commonElementFinder.getCurrentGoodsItemsList(page, SELECTORS.GOODS_ITEM)
  },

  async getIdFromGoodsItem(item: ElementHandle<SVGElement | HTMLElement>) {
    return commonElementFinder.getIdFromGoodsItem(item, SELECTORS.goodsItem.ID)
  },

  async getCommentTextarea(page: Page) {
    return commonElementFinder.getCommentTextarea(page, SELECTORS.commentInput.TEXTAREA)
  },

  /**
   * 真 @ 专用：在互动评论列表里找到与 content 匹配的那条评论节点。
   *
   * 找不到时返回 null（评论已滚出列表 / 超长被截断 / 列表还没渲染出来），
   * 调用方会回退到纯文本发送，保证回复照样发得出去。
   *
   * 按内容匹配而非 msg_id：中控台评论 DOM 上拿不到稳定可读的 msg_id，只能用内容。
   * 去掉了早期的「内容少于 4 字就放弃」门槛——直播间里「好」「在」「想要」这类
   * 短弹幕很常见，卡掉它们等于大部分评论都不真 @。改用下面两条来控制误匹配：
   *   1) 倒序找（新评论追加在列表底部，最后一个匹配项才是刚进来的那条）；
   *   2) 只有内容实在匹配不上时才走截断前缀兜底。
   */
  async findCommentItem(page: Page, content: string) {
    const target = (content ?? '').trim()
    if (!target) return null

    const items = await page.$$(SELECTORS.commentList.ITEM)
    // 必须倒序：评论列表是「新评论追加在底部」。正序找会在短内容 / 重复内容时
    // 命中更早的同名评论，把 @ 安到别人头上——直播间是公开场景，@ 错人很尴尬。
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      const text = ((await item.textContent()) ?? '').trim()
      if (!text) continue
      // 正常情况：节点文本包含整条评论内容
      if (text.includes(target)) {
        return item as ElementHandle<SVGElement | HTMLElement>
      }
      // 兜底：超长评论在列表里可能被截断成「前半段…」，按前缀再比一次
      const clipped = text.replace(/[.。…\s]+$/, '').trim()
      if (clipped.length >= 4 && target.startsWith(clipped)) {
        return item as ElementHandle<SVGElement | HTMLElement>
      }
    }
    return null
  },
}
