import { Result } from '@praha/byethrow'
import electronLog from 'electron-log'
import type { ElementHandle, Page } from 'playwright'
import {
  ElementContentMismatchedError,
  ElementDisabledError,
  ElementNotFoundError,
} from '#/errors/PlatformError'
import { sleep } from '#/utils'
import { commonElementFinder, type IElementFinder } from '../IElementFinder'
import { SELECTORS } from './constant'

export const taobaoElementFinder: IElementFinder = {
  async getPopUpButtonFromGoodsItem(item: ElementHandle<SVGElement | HTMLElement>) {
    const button = await item.$(SELECTORS.goodsItem.POPUP_BUTTON)
    if (!button) {
      return Result.fail(
        new ElementNotFoundError({
          elementName: '弹品按钮',
          selector: SELECTORS.goodsItem.POPUP_BUTTON,
        }),
      )
    }
    return Result.succeed(button)
  },

  async getIdFromGoodsItem(item: ElementHandle<SVGElement | HTMLElement>) {
    const idWrapper = await item.$(SELECTORS.goodsItem.ID)
    if (!idWrapper) {
      // 淘宝企业和达人的商品序号位置不同，达人找不到就改成企业的
      return commonElementFinder.getIdFromGoodsItem(item, SELECTORS.goodsItem.ID_ALTER)
    }
    const idText = (await idWrapper.textContent())?.match(/\d+/)?.[0] ?? ''
    const id = Number.parseInt(idText, 10)
    if (Number.isNaN(id)) {
      return Result.fail(
        new ElementContentMismatchedError({
          current: idText,
          target: '数字',
        }),
      )
    }
    return Result.succeed(id)
  },

  async getCurrentGoodsItemsList(page: Page) {
    return commonElementFinder.getCurrentGoodsItemsList(page, SELECTORS.GOODS_ITEM)
  },

  async getGoodsItemsScrollContainer(page: Page) {
    return commonElementFinder.getGoodsItemsScrollContainer(page, SELECTORS.GOODS_ITEMS_WRAPPER)
  },

  async getCommentTextarea(page: Page) {
    return commonElementFinder.getCommentTextarea(page, SELECTORS.commentInput.TEXTAREA)
  },

  async getClickableSubmitCommentButton(page: Page) {
    const button = await page.$(SELECTORS.commentInput.SUBMIT_BUTTON)
    if (!button) {
      return Result.fail(
        new ElementNotFoundError({
          elementName: '发送评论按钮',
          selector: SELECTORS.commentInput.SUBMIT_BUTTON,
        }),
      )
    }
    if (await button.isDisabled()) {
      return Result.fail(
        new ElementDisabledError({
          elementName: '发送评论按钮',
          element: await button.evaluate(el => el.outerHTML),
        }),
      )
    }
    return Result.succeed(button)
  },

  async getPinTopLabel() {
    return commonElementFinder.getEmptyPinTopLabel()
  },

  /**
   * 真 @ 专用：读「当前是否处于回复某人」的状态。
   *
   * 用户 2026-10-30 录屏实证：点了评论行尾的「回复」后，**输入框上方会多出一条引用条**，
   * 文案形如 `回复 那等你呢: 有用吗`，右侧带一个 ×（点它取消）。
   * 它既不在 textarea 的 value 里、也不改占位符，所以之前 `插入值=(空)`、
   * 只能干等满 500ms（实测淘宝「等+输入」531/556ms 全是白等）。
   *
   * 返回规范成 `@昵称` 的形式，让 helper 的「@ 出现即走」立刻命中
   * （昵称在引用条里是完整的，不一定等于 replyTo.nick_name，统一加 @ 最稳）。
   */
  async getMentionProbeText(page: Page) {
    try {
      const text = await page.evaluate(() => {
        // ⚠️ 范围必须收在**输入卡片**里，不能整个 #comment-page：
        // 评论列表里主播自己的回复文案本身就是「回复@某某: 内容」，
        // 全面板搜索会命中那些旧回复，误判成"已进入回复态"。
        const ta = document.querySelector('#comment-page textarea')
        const root =
          ta?.closest('div[class*="comment-reply"]') ??
          ta?.parentElement?.parentElement ??
          document.querySelector('#comment-page') ??
          document.body
        const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
        const cands = Array.from(root.querySelectorAll<HTMLElement>('*')).filter(el => {
          const t = norm(el.textContent ?? '')
          if (!t.startsWith('回复')) return false
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.height > 0
        })
        if (cands.length === 0) return ''
        // 取最内层（后代最少）的那个 —— 就是引用条本身，不是它的容器
        cands.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)
        return norm(cands[0].textContent ?? '')
      })
      if (!text) return ''
      // `回复 那等你呢: 有用吗` → `@那等你呢`
      return `@${text
        .replace(/^回复\s*/, '')
        .split(':')[0]
        .trim()}`
    } catch {
      return null
    }
  },

  /**
   * 真 @ 专用：在淘宝中控台评论区按内容找到目标评论行。
   *
   * DOM 依据（用户 2026-10-30 DevTools 截图实证）：
   *  - 评论区在 `#comment-page` 里；
   *  - 评论行 class 形如 `tbla-comment-item`；
   *  - 行尾浮出的动作条容器是 `tbla-comment-item-action`，其中「回复」按钮带
   *    `data-tblalog-id="huifu"`。
   *
   * ⚠️ `[class*="comment-item"]` 会**同时命中动作条容器**，所以要排除 `comment-item-action`，
   * 否则会把动作条当成评论行。比对时把动作条子树剔除，只比正文（昵称仍在，暂时可接受）。
   */
  async findCommentItem(page: Page, content: string) {
    const target = (content ?? '').trim()
    if (!target) return null
    // ⚠️ 淘宝评论区渲染有延迟：实测「小肚子」那次，去查的时候目标评论还没进 DOM
    // （日志只有一句「未在评论列表找到」，无任何上下文）。所以这里轮询最多 900ms，
    // 并在一路打诊断（列表条数 + 末尾文本），下次失败能直接归因。
    const deadline = Date.now() + 900
    let diag = ''
    while (Date.now() < deadline) {
      const r = await page
        .evaluate((text: string) => {
          for (const el of Array.from(document.querySelectorAll('[data-taobao-mention]'))) {
            el.removeAttribute('data-taobao-mention')
          }
          // 去掉 [笑哭R] 这类表情短码：平台把它渲染成图片，DOM 文本里没有这串字。
          // 只在目标确实带短码时才启用，普通评论走原来的纯空白归一化（零额外开销）。
          const needEmojiStrip = /\[[^[\]]{1,10}\]/.test(text)
          const norm = (s: string | null | undefined) => {
            const base = s ?? ''
            return (needEmojiStrip ? base.replace(/\[[^[\]]{1,10}\]/g, '') : base).replace(
              /\s+/g,
              '',
            )
          }
          const t = norm(text)
          if (!t) return { hit: false, total: 0, tail: [] as string[] }
          const rows = Array.from(
            document.querySelectorAll<HTMLElement>('#comment-page [class*="comment-item"]'),
          ).filter(el => {
            const cls = typeof el.className === 'string' ? el.className : ''
            if (/comment-item-action/.test(cls)) return false
            const r = el.getBoundingClientRect()
            return r.width > 0 && r.height > 0
          })
          // 倒序：新评论追加在列表底部，最后匹配的才是刚进来的那条
          for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i]
            const clone = row.cloneNode(true) as HTMLElement
            for (const a of Array.from(clone.querySelectorAll('[class*="action"]'))) {
              a.remove()
            }
            const body = norm(clone.textContent)
            // 跳过主播自己发的消息：淘宝中控台里主播消息行首有「主播」标签，
            // 命中它会把 @ 插到自己头上（百应出过同样的事故，2026-10-30）。
            if (body.startsWith('主播')) continue
            if (body?.includes(t)) {
              row.setAttribute('data-taobao-mention', '1')
              return { hit: true, total: rows.length, tail: [] as string[] }
            }
          }
          return {
            hit: false,
            total: rows.length,
            tail: rows
              .slice(-3)
              .map(r => (r.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30)),
          }
        }, target)
        .catch(() => null)
      if (r?.hit) {
        const el = await page.$('[data-taobao-mention="1"]').catch(() => null)
        if (el) return el as ElementHandle<SVGElement | HTMLElement>
      }
      if (r) diag = `列表 ${r.total} 条，末尾 [${r.tail.join(' | ')}]`
      await sleep(120)
    }
    electronLog
      .scope('真@回复')
      .warn(
        `淘宝评论列表未命中：${diag || '(没读到列表)'}，目标「${
          target.length > 24 ? `${target.slice(0, 24)}…` : target
        }」`,
      )
    return null
  },

  /**
   * 真 @ 专用：hover 唤出评论行尾的动作条，点其中的「回复」。
   *
   * 淘宝的动作条是**hover 才渲染**的（截图里鼠标停在那个图标上才弹出「回复评论」提示），
   * 所以先沿祖先链合成 mouseover/mouseenter/mousemove，再找 `[data-tblalog-id="huifu"]`。
   * 动作条有可能挂在评论行的**兄弟节点**里，所以先找行内，再退回文档级、按垂直距离取最近的那个。
   */
  async clickMentionEntry(_page: Page, item: ElementHandle<SVGElement | HTMLElement>) {
    // 动作条 hover 后才渲染，一次没出来很正常 → 轮询最多 800ms，
    // 出来就点。否则会掉到下面的真实点击兜底（实测 630~679ms，是淘宝「点回复」慢的原因）。
    let ok = false
    const entryDeadline = Date.now() + 800
    while (!ok && Date.now() < entryDeadline) {
      ok = await item
        .evaluate((el: SVGElement | HTMLElement) => {
          const row = el as HTMLElement
          // 合成 hover
          let cur: HTMLElement | null = row
          for (let i = 0; i < 4 && cur; i++) {
            for (const type of ['mouseover', 'mouseenter', 'mousemove']) {
              cur.dispatchEvent(
                new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }),
              )
            }
            cur = cur.parentElement
          }
          const visible = (b: Element) => {
            const r = b.getBoundingClientRect()
            return r.width > 0 && r.height > 0
          }
          // 1) 行内优先
          const inRow = Array.from(
            row.querySelectorAll<HTMLElement>('[data-tblalog-id="huifu"]'),
          ).filter(visible)
          if (inRow.length > 0) {
            inRow[0].click()
            return true
          }
          // 2) 文档级：按垂直中心离这一行最近的动作条
          const rr = row.getBoundingClientRect()
          const my = (rr.top + rr.bottom) / 2
          const all = Array.from(
            document.querySelectorAll<HTMLElement>('[data-tblalog-id="huifu"]'),
          )
            .filter(visible)
            .sort((a, b) => {
              const ra = a.getBoundingClientRect()
              const rb = b.getBoundingClientRect()
              return (
                Math.abs((ra.top + ra.bottom) / 2 - my) - Math.abs((rb.top + rb.bottom) / 2 - my)
              )
            })
          if (all.length > 0) {
            all[0].click()
            return true
          }
          return false
        })
        .catch(() => false)
      if (!ok) await sleep(80)
    }
    if (ok) return
    // 兜底：按文案/alt 找「回复」
    const alt = await item
      .$('[aria-label*="回复"], [title*="回复"], img[alt="回复"]')
      .catch(() => null)
    if (alt) {
      await alt.click({ timeout: 1200 }).catch(async () => {
        await alt.dispatchEvent('click').catch(() => {})
      })
    }
  },
}
