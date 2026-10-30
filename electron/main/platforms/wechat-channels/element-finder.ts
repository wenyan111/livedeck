import { Result } from '@praha/byethrow'
import type { ElementHandle, Locator, Page } from 'playwright'
import {
  ElementDisabledError,
  ElementNotFoundError,
  type PlatformError,
} from '#/errors/PlatformError'
import electronLog from '#/logger'
import { commonElementFinder, type IElementFinder, queryAcrossFrames } from '../IElementFinder'
import { SELECTORS } from './constant'

type WechatChannelElementFinder = IElementFinder & {
  getNewCommentButton(page: Page): Result.ResultAsync<Locator, PlatformError>
  getComments(page: Page): Result.ResultAsync<Locator[], PlatformError>
  getPinCommentActionItem(page: Page): Locator
  /** 真 @ 专用：悬浮工具条里的「回复」项（与 getPinCommentActionItem 同构） */
  getReplyActionItem(page: Page): Locator
}

export const wechatChannelElementFinder: WechatChannelElementFinder = {
  async getPopUpButtonFromGoodsItem(item: ElementHandle<SVGElement | HTMLElement>) {
    const button = await item.$(SELECTORS.goodsItem.POPUP_BUTTON)
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

  async getIdFromGoodsItem(item: ElementHandle<SVGElement | HTMLElement>) {
    // 注：视频号的商品 ID 通过 textContent 获取，其余平台是 InputValue
    return commonElementFinder.getIdFromGoodsItem(item, SELECTORS.goodsItem.ID, true)
  },

  async getCurrentGoodsItemsList(page: Page) {
    const itemsList = await commonElementFinder.getCurrentGoodsItemsList(page, SELECTORS.GOODS_ITEM)
    if (Result.isFailure(itemsList)) {
      return itemsList
    }
    if (itemsList.value.length <= 1) {
      return Result.succeed(itemsList.value)
    }
    return Result.pipe(
      Result.sequence([
        this.getIdFromGoodsItem(itemsList.value[0]),
        this.getIdFromGoodsItem(itemsList.value[itemsList.value.length - 1]),
      ]),
      Result.andThen(([firstIdValue, lastIdValue]) => {
        // 视频号可能是倒序的，需要转成正序
        if (firstIdValue > lastIdValue) {
          itemsList.value.reverse()
        }
        // 暂时不用担心倒序可能会对后面的滚动查找元素有影响，因为视频号似乎没有虚拟列表，能把所有商品全部加载进来
        return Result.succeed(itemsList.value)
      }),
    )
  },

  async getGoodsItemsScrollContainer() {
    // 视频号没有虚拟列表，且直接遍历所有元素，按理说不会触发这个函数
    return Result.fail(new ElementNotFoundError({ elementName: '商品列表' }))
  },

  async getCommentTextarea(page: Page) {
    const iframe = page.locator(SELECTORS.LIVE_CONTROL_IFRAME)
    const textarea = iframe.locator(SELECTORS.commentInput.TEXTAREA)
    return Result.succeed(textarea)
  },

  async getClickableSubmitCommentButton(page: Page) {
    // 视频号中控台整体嵌在 .wujie_iframe 内，评论框和「发送」按钮都在 iframe 里。
    // 之前这里用 page.$(...) 只在**主框架**里找，永远找不到按钮 —— clickSend 的
    // 前几次尝试全部落空，最终只能走「回车兜底」；而 textarea 里回车往往只是换行、
    // 并不提交评论，于是话术根本没发出去却被判为成功（假成功）。
    // 改为跨所有 frame 查找，才能真正点到「发送」按钮。
    const button = await queryAcrossFrames(page, [SELECTORS.commentInput.SUBMIT_BUTTON])
    if (!button) {
      return Result.fail(
        new ElementNotFoundError({
          elementName: '发送按钮',
          selector: SELECTORS.commentInput.SUBMIT_BUTTON,
        }),
      )
    }
    if (
      (await button.getAttribute('class'))?.includes(SELECTORS.commentInput.SUBMIT_BUTTON_DISABLED)
    ) {
      return Result.fail(
        new ElementDisabledError({
          elementName: '发送按钮',
          element: await button.evaluate(el => el.outerHTML),
        }),
      )
    }
    return Result.succeed(button)
  },

  async getPinTopLabel() {
    return commonElementFinder.getEmptyPinTopLabel()
  },

  async getComments(page: Page) {
    const iframe = page.locator(SELECTORS.LIVE_CONTROL_IFRAME)
    const comments = await iframe.locator('.live-message-item-container .message-content').all()
    if (comments.length === 0) {
      return Result.fail(new ElementNotFoundError({ elementName: '评论' }))
    }
    return Result.succeed(comments)
  },

  async getNewCommentButton(page: Page): Result.ResultAsync<Locator, PlatformError> {
    const newCommentButton = page.locator('.comment__load')
    if (await newCommentButton.isVisible()) {
      return Result.succeed(newCommentButton)
    }
    return Result.fail(
      new ElementNotFoundError({
        elementName: '新消息按钮',
        selector: SELECTORS.commentInput.SUBMIT_BUTTON,
      }),
    )
  },

  getPinCommentActionItem(page: Page) {
    return page.locator(
      '.live-message-container .action-popover .action-popover__action-item:text("上墙")',
    )
  },

  getReplyActionItem(page: Page) {
    // ⚠️ 不要依赖 `action-popover__action-item` 这个 class。
    // 2026-10-29 日志实测：工具条文本已经读成「上墙  回复  禁言  拉黑」（说明「回复」
    // 确实在 DOM 里），但按 class 匹配不到 → 报「未点到『回复』」、白降级成纯文本。
    // 改成**纯文字精确匹配**，与 class 脱钩。
    return page.locator('.live-message-container .action-popover :text-is("回复")')
  },

  /**
   * 真 @ 专用：视频号的 mention 是渲染在 textarea **之外**的 chip。
   * 点完「回复」输入框里显示「回复 昵称」，但 `.live-message-input-container textarea`
   * 的 inputValue() 是空的（用户 2026-10-28 截图证实），所以必须回整个输入容器的文本
   * 才能判定 mention 是否已插入。chip 的文本会包含在容器文本里。
   */
  async getMentionProbeText(page: Page) {
    try {
      const iframe = page.locator(SELECTORS.LIVE_CONTROL_IFRAME)
      const container = iframe.locator('.live-message-input-container')
      if ((await container.count()) === 0) return null
      // ★★ 关键（2026-10-29 用户录屏逐帧实证）：视频号的「回复 @昵称」**不是** chip、
      // 也**不在** textarea 的 value 里，而是写在了 textarea 的 **placeholder** 上：
      //   点完工具条「回复」→ <textarea placeholder="回复 牛**">
      // 之前读 `container.textContent()` —— placeholder 不属于 textContent，
      // 于是**永远**判定「未检测到 mention」，把一直成功的真@误报成失败。
      const ta = await queryAcrossFrames(page, [SELECTORS.commentInput.TEXTAREA])
      if (!ta) return null
      const placeholder = ((await ta.getAttribute('placeholder').catch(() => '')) ?? '').trim()
      const value = ((await ta.inputValue().catch(() => '')) ?? '').trim()
      // helper 的判定是 `includes('@') || includes(nick_name)`；昵称可能被打码（「牛**」），
      // 未必等于 replyTo.nick_name，所以把「回复」规范成「@」，
      // 保证「平台已进入回复态」这个事实一定能被识别。
      const probe = placeholder.startsWith('回复')
        ? `@${placeholder.replace(/^回复\s*/, '')}`
        : placeholder
      return `${probe} ${value}`.trim()
    } catch {
      return null
    }
  },

  /**
   * 真 @ 专用：在评论列表里按内容找到目标那条评论。
   *
   * 与 pinComment 保持同构（同样的 iframe 作用域、同样的「新消息」按钮预加载、
   * 同样的倒序文本匹配），只是匹配从「全等」放宽到「包含」——评论内容可能被
   * 平台截断，且我们要容忍前后空白差异。
   */
  async findCommentItem(page: Page, content: string) {
    const target = (content ?? '').trim()
    if (!target) return null

    // 与上墙同款：先点「新消息」按钮把最新评论加载出来，否则列表可能还是旧的。
    // ⚠️ 用 **dispatchEvent（合成 click）** 而不是 Playwright 的 click：
    // 后者带 actionability 等待（可见/稳定/可点击），这个按钮经常「可见但不可点」，
    // 实测视频号「找评论」中位数 608ms 几乎全耗在等它可点上。合成 click 立即返回，
    // 点不动也无所谓——下面照样在现有列表里找。
    const newCommentButton = await this.getNewCommentButton(page)
    if (Result.isSuccess(newCommentButton)) {
      await newCommentButton.value.dispatchEvent('click').catch(() => {})
    }

    const iframe = page.locator(SELECTORS.LIVE_CONTROL_IFRAME)
    const items = iframe.locator('.live-message-item-container .message-content')
    // 一次性取回全部评论文本：原来逐条 `items.nth(i).textContent()` 是 14 次跨进程往返
    // （每次 10~20ms），evaluateAll 只往返一次。
    const texts = await items
      .evaluateAll(nodes => nodes.map(n => (n.textContent ?? '').trim()))
      .catch(() => [] as string[])
    const count = texts.length
    // 必须倒序：新评论追加在列表底部，最后匹配的才是刚进来的那条。
    // 正序会在重复内容时命中更早的同名评论，把 @ 安到别人头上。
    for (let i = count - 1; i >= 0; i--) {
      const text = texts[i]
      if (text && (text === target || text.includes(target))) {
        return items.nth(i)
      }
    }
    // 没找到：把列表规模和末尾几条打出来，用于区分「评论被顶出列表」和「文本匹配不上」
    // （直播间能看到 ≠ 中控台评论列表里还有，这两者经常不一致）
    const tail = texts
      .slice(Math.max(0, count - 3))
      .filter(Boolean)
      .map(t => (t.length > 24 ? `${t.slice(0, 24)}…` : t))
    electronLog
      .scope('真@回复')
      .warn(
        `视频号评论列表未命中：列表共 ${count} 条，末尾 [${tail.join(' | ')}]，目标「${
          target.length > 24 ? `${target.slice(0, 24)}…` : target
        }」`,
      )
    return null
  },

  /**
   * 真 @ 专用：点中评论 → 唤出悬浮工具条 → 点「回复」项，
   * 让平台把「回复 @昵称」结构插进评论输入框（用户 2026-10-28 截图证实该行为）。
   *
   * 工具条的位置有两种可能（现有 getPinCommentActionItem 用的是主框架 locator
   * 且实测可用，但评论本身在 .wujie_iframe 里），所以两条路都试。
   */
  async clickMentionEntry(page: Page, item: ElementHandle<SVGElement | HTMLElement> | Locator) {
    // 1. 唤出工具条并点「回复」——最多试 2 轮。
    //    ⚠️ 视频号是**点击**评论唤出工具条，不是悬停（用户 2026-10-29 明确）。
    //    所以这里**不做**合成 hover、也不移动真实鼠标——多余的 hover 反而可能让
    //    浮动层停留在别的行上（表现为工具条只有「上墙」一项）。
    //    为什么要重试：2026-10-29 实测有些时候浮动层**只渲染出「上墙」一项**
    //    （诊断日志：工具条=「上墙」子项[div.action-popover__wrp]），「回复」还没出来
    //    就被读走了；这时重新悬停一次往往就能拿到完整菜单。
    const candidates = [
      // 文字精确匹配（主路径，与 class 脱钩）
      this.getReplyActionItem(page),
      page
        .locator(SELECTORS.LIVE_CONTROL_IFRAME)
        .locator('.live-message-container .action-popover :text-is("回复")'),
      // 兜底：老版本 class（万一哪天文字被替换成图标）
      page
        .locator(SELECTORS.LIVE_CONTROL_IFRAME)
        .locator(
          '.live-message-container .action-popover .action-popover__action-item:text("回复")',
        ),
    ]
    let picked = false
    for (let attempt = 0; attempt < 2 && !picked; attempt++) {
      // 视频号是**点击**评论唤出工具条（用户 2026-10-29 明确，不是悬停）。
      // 两轮都用真实点击，点不动再退到合成 click。
      try {
        await item.click({ timeout: 1200 })
      } catch {
        await item.dispatchEvent('click').catch(() => {})
      }

      // 轮询窗口 800ms
      const deadline = Date.now() + 800
      while (Date.now() < deadline) {
        for (const locator of candidates) {
          try {
            if ((await locator.count()) > 0) {
              await locator.first().click({ timeout: 1000 })
              picked = true
              break
            }
          } catch {
            // 换下一条路
          }
        }
        if (picked) break
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }
    if (picked) return

    // 轮询完仍没点到「回复」：把工具条的实际状态打出来。
    // action-popover 是浮动层，不在评论节点内部，所以必须在有 page 的地方抓——
    // 否则 main.log 里只有百应专属的 operationWrapper，对视频号毫无诊断价值。
    try {
      // 诊断：除了文案，把工具条**子项的真实 class** 一起打出来。
      // 用户 2026-10-29 的 DevTools 截图显示：上墙/回复 是带 `data-v-xxxx` 的普通 div，
      // **没有** `action-popover__action-item` 这个 class —— 之前按 class 匹配必然落空。
      const popoverInfo = await page
        .locator('.live-message-container .action-popover')
        .first()
        .evaluate(el => {
          const txt = (el.textContent ?? '').trim().slice(0, 48)
          const kids = Array.from(el.children)
            .map(c => {
              const cls = typeof c.className === 'string' ? c.className.trim() : ''
              return `${c.tagName.toLowerCase()}${cls ? `.${cls.split(/\s+/).join('.')}` : ''}`
            })
            .slice(0, 6)
            .join(' , ')
          return `「${txt}」子项[${kids}]`
        })
        .catch(() => null)
      const itemText = ((await item.textContent()) ?? '').trim()
      electronLog
        .scope('真@回复')
        .warn(
          `视频号未点到「回复」：工具条=${popoverInfo ?? '(无 .action-popover)'}，评论「${itemText.slice(0, 30)}」`,
        )
    } catch {
      // 诊断失败不影响主流程
    }
  },
}
