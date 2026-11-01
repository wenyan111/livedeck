import { Result } from '@praha/byethrow'
import type { ElementHandle, Page } from 'playwright'
import { ElementDisabledError, ElementNotFoundError } from '#/errors/PlatformError'
import electronLog from '#/logger'
import { hasEmojiShortcode, normalizeCommentText } from '../commentMatch'
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
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
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

/** 悬停后操作栏里「回复」的序号（0-based）：用户确认小红书是**第 1 个** */
const REPLY_ICON_INDEX = 0
/** DOM 快照限流间隔，防直播高峰刷爆日志 */
const DOM_DUMP_INTERVAL_MS = 30_000
let lastDomDumpAt = 0

type XiaohongshuElementFinder = IElementFinder & {
  findCommentItem(
    page: Page,
    content: string,
  ): Promise<ElementHandle<SVGElement | HTMLElement> | null>
  clickMentionEntry(page: Page, item: ElementHandle<SVGElement | HTMLElement>): Promise<void>
  getMentionProbeText(page: Page): Promise<string | null>
}

export const xiaohongshuElementFinder: XiaohongshuElementFinder = {
  async getPopUpButtonFromGoodsItem(item: ElementHandle<SVGElement | HTMLElement>) {
    // 1. 语义 / 新版标记（由 goods-list.ts 打标）
    const marked = await item.$(`[${MARK.POPUP}]`)
    if (marked) {
      if (await marked.evaluate(isDisabledInPage)) {
        return Result.fail(
          new ElementDisabledError({
            elementName: '弹卡按钮',
            element: await marked.evaluate(el => el.outerHTML),
          }),
        )
      }
      return Result.succeed(marked)
    }

    // 2. 新版操作按钮区：按文案匹配「弹卡」（空闲）/「弹卡中 (Ns)」（倒计时中）
    //    （「弹卡」与「讲解」并列、class 相同，只能靠文案区分）
    try {
      const actionRow = await item.$(SELECTORS.GOODS_ITEM_INNER.ACTION_ROW)
      if (actionRow) {
        const buttons = await actionRow.$$(SELECTORS.GOODS_ITEM_INNER.ACTION_BUTTON)
        for (const button of buttons) {
          const text = (await button.textContent())?.trim() ?? ''
          // 空闲态「弹卡」，点击后「弹卡中 (Ns)」倒计时，两者都要能识别
          if (text === TEXTS.POPUP_BUTTON || text.startsWith(TEXTS.POPUP_BUTTON_PENDING)) {
            if (await button.evaluate(isDisabledInPage)) {
              return Result.fail(
                new ElementDisabledError({
                  elementName: '弹卡按钮',
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
              elementName: '弹卡按钮',
              element: await operation.evaluate(el => el.outerHTML),
            }),
          )
        }
        return Result.succeed(operation)
      }
    }
    return Result.fail(
      new ElementNotFoundError({
        elementName: '弹卡按钮',
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
          const items = (await frame.$$(selector)) as ElementHandle<SVGElement | HTMLElement>[]
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
        const items = (await frame.$$(`[${MARK.ROW}]`)) as ElementHandle<SVGElement | HTMLElement>[]
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

  /**
   * 真 @ 专用：按内容在互动评论列表里找到目标那条评论。
   *
   * 小红书/蒲公英的评论区常嵌在 iframe 里（`#redlive-pgy-app`），所以**逐 frame** 尝试。
   * 结构（用户 2026-10-29 DevTools 截图实测）：
   *   `.comments.no-emoji > .comment-list > .comment-list-item`
   * 倒序匹配：新评论追加在列表底部，正序会在重复内容时 @ 到更早的那条。
   */
  async findCommentItem(page: Page, content: string) {
    const target = (content ?? '').trim()
    if (!target) return null

    // ★ 2026-11-01：小红书把 `[笑哭R]` 这类表情短码**渲染成图片**，DOM 文本里没有这串字，
    // 纯文本匹配必然落空（连报三次未命中的三条内容全带表情短码）。所以再加一轮
    // 「去掉表情短码 + 空白」后的匹配。normTarget 为空 = 纯表情评论，无法按文本定位，直接放弃。
    // 只在目标确实带表情短码时才启用规范化（普通评论零额外开销）
    const normTarget = hasEmojiShortcode(target) ? normalizeCommentText(target) : ''
    let scanned = 0
    const tails: string[] = []

    for (const frame of page.frames()) {
      for (const selector of SELECTORS.COMMENT_LIST.ITEM_CANDIDATES) {
        let items: ElementHandle<SVGElement | HTMLElement>[] = []
        try {
          items = (await frame.$$(selector)) as ElementHandle<SVGElement | HTMLElement>[]
        } catch {
          continue
        }
        if (items.length === 0) continue
        scanned += items.length
        for (let i = items.length - 1; i >= 0; i--) {
          const text = ((await items[i].textContent().catch(() => '')) ?? '').trim()
          if (!text) continue
          if (text.includes(target)) return items[i]
          // 去掉表情短码后再比（normTarget 为空时跳过，否则空串包含恒真会 @ 错人）
          if (normTarget.length >= 2) {
            const normText = normalizeCommentText(text)
            if (normText.includes(normTarget)) return items[i]
            // 超长评论在列表里可能被截断成「前半段…」：规范化后按前缀再比一次
            if (normText.length >= 4 && normTarget.startsWith(normText)) return items[i]
          }
        }
        if (tails.length < 3) {
          const t = ((await items[items.length - 1]?.textContent().catch(() => '')) ?? '').trim()
          if (t) tails.push(t.slice(0, 24))
        }
      }
    }
    // 找不到：评论已被刷出可见列表（中控台只保留最近若干条），或纯表情无法定位
    electronLog
      .scope('真@回复')
      .warn(
        `小红书未命中：扫描 ${scanned} 行，末尾 [${tails.join(' | ')}]，目标「${
          target.length > 24 ? `${target.slice(0, 24)}…` : target
        }」${normTarget.length < 2 ? '（纯表情评论，无法按文本定位）' : ''}`,
      )
    return null
  },

  /**
   * 真 @ 专用：悬停评论 → 点操作栏的**第 1 个**按钮（=「回复」）。
   *
   * 用户 2026-10-29 确认：小红书是**悬停**评论后浮出按钮、**第 1 个**是回复
   * （这点和视频号不同——视频号是点击触发）。
   * hover 用「合成事件 + 真实鼠标移动」双保险：合成事件触发 JS 监听，
   * 真实移动触发 CSS :hover（合成事件做不到后者）。
   */
  async clickMentionEntry(page: Page, item: ElementHandle<SVGElement | HTMLElement>) {
    const log = electronLog.scope('真@回复')

    // ① 合成 hover：沿祖先链逐层派发（mouseover 冒泡、mouseenter 不冒泡）
    await item
      .evaluate(el => {
        let cur: HTMLElement | null = el as HTMLElement
        for (let i = 0; i < 5 && cur; i++) {
          for (const type of ['mouseover', 'mouseenter', 'mousemove']) {
            cur.dispatchEvent(
              new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }),
            )
          }
          cur = cur.parentElement
        }
      })
      .catch(() => {})

    // ② 真实鼠标移到评论上（触发 CSS :hover）
    const box = await item.boundingBox().catch(() => null)
    if (box && box.width > 0 && box.height > 0) {
      await page.mouse
        .move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 2 })
        .catch(() => {})
    }

    // ③ 轮询点第 1 个图标
    const deadline = Date.now() + 800
    let lastReport: { count: number; icons: string[] } | null = null
    while (Date.now() < deadline) {
      // 注意：传给 evaluate 的函数会被序列化到页面里执行，不能引用模块作用域变量
      const res = await item
        .evaluate((el, idx) => {
          const row = el as HTMLElement
          const rr = row.getBoundingClientRect()
          // 操作按钮浮在行内右侧；左半区是头像/昵称，排除掉
          const rightHalfX = rr.left + rr.width * 0.55
          const isIcon = (n: HTMLElement) => {
            const r = n.getBoundingClientRect()
            if (r.width === 0 || r.height === 0) return false
            if (r.width > 40 || r.height > 40) return false
            if (r.left + r.width / 2 < rightHalfX) return false
            const cls = typeof n.className === 'string' ? n.className : ''
            return (
              n.tagName === 'BUTTON' ||
              n.getAttribute('role') === 'button' ||
              !!n.querySelector('svg') ||
              /icon|btn|button|action|operat|tool/i.test(cls)
            )
          }
          const collect = (root: HTMLElement) => {
            const all = Array.from(root.querySelectorAll<HTMLElement>('*')).filter(isIcon)
            // 父子同时命中只留最内层
            const list = all.filter(n => !all.some(m => m !== n && n.contains(m)))
            list.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
            return list
          }
          // 先在行内找；不够就放大到行的父容器（防浮动层挂在行外）
          let icons = collect(row)
          if (icons.length <= idx && row.parentElement) {
            icons = collect(row.parentElement)
          }
          if (icons.length > idx) {
            const target = icons[idx]
            const html = target.outerHTML.slice(0, 180)
            target.click()
            return { ok: true, count: icons.length, picked: html, icons: [] as string[] }
          }
          return {
            ok: false,
            count: icons.length,
            picked: '',
            icons: icons.map(n => n.outerHTML.slice(0, 80)),
          }
        }, REPLY_ICON_INDEX)
        .catch(() => null)

      if (res?.ok) return
      if (res) lastReport = { count: res.count, icons: res.icons }
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    // ④ 失败诊断（30s 限流）：把行内右半区的图标和祖先链打出来，便于收敛选择器
    if (Date.now() - lastDomDumpAt > DOM_DUMP_INTERVAL_MS) {
      lastDomDumpAt = Date.now()
      const chain = await item
        .evaluate(el => {
          const out: string[] = []
          let cur: HTMLElement | null = el as HTMLElement
          for (let i = 0; i < 5 && cur; i++) {
            const cls = typeof cur.className === 'string' ? cur.className.trim() : ''
            out.push(`${cur.tagName.toLowerCase()}${cls ? `.${cls.split(/\s+/).join('.')}` : ''}`)
            cur = cur.parentElement
          }
          return out.join(' < ')
        })
        .catch(() => '')
      log.warn(
        `小红书未点到「回复」：右半区图标数=${lastReport?.count ?? 0}` +
          `，图标=${(lastReport?.icons ?? []).join(' || ') || '(无)'}` +
          `，祖先链=${chain || '(读取失败)'}`,
      )
    }
  },

  /**
   * 真 @ 专用：读取输入区是否已有 mention。
   * 小红书回复框是 textarea，平台一般把「@昵称」当纯文本插进 value；
   * 万一渲染成输入框外的 chip，再补读输入容器内以 @ 开头的元素文本。
   */
  async getMentionProbeText(page: Page) {
    try {
      for (const frame of page.frames()) {
        for (const selector of SELECTORS.COMMENT_INPUT.TEXTAREA_CANDIDATES) {
          const el = await frame.$(selector).catch(() => null)
          if (!el) continue
          const value = await el.inputValue().catch(() => '')
          const chip = await frame
            .$$eval('.comment-input *', els =>
              els
                .map(e => (e.textContent ?? '').trim())
                .filter(t => t.startsWith('@'))
                .join(' '),
            )
            .catch(() => '')
          return `${value ?? ''} ${chip ?? ''}`.trim()
        }
      }
      return null
    } catch {
      return null
    }
  },
}
