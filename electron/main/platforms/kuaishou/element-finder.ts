import { Result } from '@praha/byethrow'
import type { ElementHandle, Page } from 'playwright'
import { ElementDisabledError, ElementNotFoundError } from '#/errors/PlatformError'
import electronLog from '#/logger'
import { commonElementFinder, type IElementFinder, queryAcrossFrames } from '../IElementFinder'
import { SELECTORS } from './constant'

/** 悬浮工具条里「回复」图标的序号（0-based）：置顶 0 / 转发 1 / 回复 2 */
const REPLY_ICON_INDEX = 2

/** DOM 快照限流间隔：直播高峰期别把日志刷爆 */
const DOM_DUMP_INTERVAL_MS = 30_000
let lastDomDumpAt = 0

type KuaishouElementFinder = IElementFinder & {
  findCommentItem(
    page: Page,
    content: string,
  ): Promise<ElementHandle<SVGElement | HTMLElement> | null>
  clickMentionEntry(page: Page, item: ElementHandle<SVGElement | HTMLElement>): Promise<void>
  getMentionProbeText(page: Page): Promise<string | null>
}

export const kuaishouElementFinder: KuaishouElementFinder = {
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

  /**
   * 真 @ 专用：按内容在互动评论列表里找到目标那条评论。
   *
   * 快手的中控台 class 是 camelCase 且带构建哈希（如 `live-panel`、`reply-content`），
   * 没有百应 `div[class^=commentItem]` 那样稳定的前缀可依赖，所以这里改走
   * **按文本定位**的通用做法，完全不依赖 class：
   *   1) 收集页面上所有「文本包含目标内容」的可见元素；
   *   2) 取**最内层**（后代元素数最少），避免命中整个列表容器 / 页面根；
   *   3) 取其中 DOM 顺序的**最后一条**——新评论追加在列表底部，正序找会在
   *      重复内容时把 @ 安到更早的同名评论上（直播间是公开场景，@ 错人很尴尬）。
   *
   * 找不到返回 null，调用方自动回退纯文本发送，不会丢回复。
   */
  async findCommentItem(page: Page, content: string) {
    const target = (content ?? '').trim()
    if (!target) return null

    // 快速路径（2026-10-29 实测出的真实评论行容器）：评论行是 `div[class*="list-item"]`
    // （祖先链证据：span.replied-content--UayMH < span.content--Ma9od <
    //  div.comment-items--IoRgD < div.list-item--k4n5Y）。
    // 逐条比对只碰几十个节点，比下面「全文档叶子节点扫描」便宜得多
    // —— 实测「找评论」中位数 244ms，大头就是这个全量扫描。
    // 商品列表也有 list-item，但按评论文本匹配不会误中。
    for (const frame of page.frames()) {
      const texts = await frame
        .$$eval('[class*="list-item"]', nodes => nodes.map(n => (n.textContent ?? '').trim()))
        .catch(() => [] as string[])
      if (texts.length === 0) continue
      let hit = -1
      // 倒序：新评论追加在列表底部
      for (let i = texts.length - 1; i >= 0; i--) {
        if (texts[i]?.includes(target)) {
          hit = i
          break
        }
      }
      if (hit < 0) continue
      const rows = await frame.$$('[class*="list-item"]').catch(() => [])
      if (rows[hit]) return rows[hit] as ElementHandle<SVGElement | HTMLElement>
    }

    // 快速路径 2：抖音同款选择器。
    // ⚠️ 不再放宽（原因见 constant.ts 注释）：实测快手走不通这条，真正起作用的是
    // 下面的「按文本定位 + hover 验证」。放宽会绕过验证、反而可能点错。
    const items = await page.$$(SELECTORS.commentList.ITEM).catch(() => [])
    if (items.length > 0) {
      // 倒序：新评论追加在列表底部，最后一个匹配项才是刚进来的那条
      for (let i = items.length - 1; i >= 0; i--) {
        const text = ((await items[i].textContent()) ?? '').trim()
        if (!text) continue
        if (text.includes(target)) {
          return items[i] as ElementHandle<SVGElement | HTMLElement>
        }
        // 兜底：超长评论在列表里可能被截断成「前半段…」，按前缀再比一次
        const clipped = text.replace(/[.。…\s]+$/, '').trim()
        if (clipped.length >= 4 && target.startsWith(clipped)) {
          return items[i] as ElementHandle<SVGElement | HTMLElement>
        }
      }
    }

    // 兜底：按文本定位 + **hover 验证**。
    //
    // 为什么必须 hover 验证（2026-10-29 实测教训）：只按文本匹配会命中**输入区里的
    // 「被回复内容」引用块**（class 形如 `replied-content--UayMH`）——它的文本和评论
    // 内容一字不差，但它根本不在评论列表里，hover 它永远不会出现工具条，表现就是
    // 「右半区图标数=0」。所以这里对每个候选先合成 hover，只有**能唤出工具条**
    // （右半区出现 ≥3 个小图标）的那个才判定为真正的评论行。
    //
    // 评论区可能在主框架，也可能嵌在 iframe 里
    // （连评论框本身都是用 queryAcrossFrames 找的），所以逐帧尝试。
    let fallback: ElementHandle<SVGElement | HTMLElement> | null = null
    let fallbackMsg = ''
    const frameMsgs: string[] = []
    for (const frame of page.frames()) {
      try {
        // 注意：本函数会被序列化到页面里执行，不能引用模块作用域的任何变量
        const diag = await frame.evaluate(async (text: string) => {
          const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
          const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '')
          const t = norm(text)
          if (!t) return { found: 0, verified: false, diag: [] as string[] }

          for (const el of Array.from(document.querySelectorAll('[data-ks-mention-target]'))) {
            el.removeAttribute('data-ks-mention-target')
          }

          // 性能（2026-10-29 提速）：原来在**整个中控台 DOM** 上对每个元素做
          // `textContent` 归一化、再对命中项算一次后代数——几千个元素要几百毫秒
          // 甚至更久，这是快手回复慢的主因之一。改成：
          //   1) 搜索范围先收到**评论区容器**（public-list-wrap / comment-set / comment-items）；
          //   2) 只保留**叶子节点**（没有子元素）——评论正文本身就是叶子 span，
          //      这样一步同时完成「取最内层」，省掉第二次 O(n) 扫描。
          // ⚠️ 2026-10-30 修正：**不能**把 `comment-set` 当评论区容器。
          // 实测（诊断日志）快手页面上的 `comment-set--H5DfM` 是**回复输入区的快捷回复面板**
          // （其叶子文本是「发送」「设置快捷评论」「可长时间使用…」），
          // 一旦 `public-list-wrap` 不存在就会落到它上面 → 整段评论正文一个都搜不到，
          // 表现就是「快手没成功一条」。
          // 现在只认真正的评论列表容器；都找不到就退回全文档（慢一点但正确），
          // 输入区的引用块由下面的 inReplyArea 排到队尾处理。
          // ★ 评论区容器缓存（2026-10-30 提速）：第一次成功后记住装着这条评论的滚动容器，
          // 之后优先只在小范围里扫叶子节点。否则页面没有 public-list-wrap / comment-items 时
          // 会退到 document.body，几千个元素扫一遍要 600ms 左右（实测离群样本 616ms）。
          // 缓存的元素被卸载就自动失效；范围内找不到候选时，下面的代码还会回退全文档扫描，
          // 所以**正确性不退化**，只是把"能找到"的常见情况变快。
          const w = window as unknown as { __ksCommentScope?: HTMLElement }
          const cached = w.__ksCommentScope?.isConnected ? w.__ksCommentScope : null
          const scope =
            cached ??
            document.querySelector<HTMLElement>(
              '[class*="public-list-wrap"], [class*="comment-items"]',
            ) ??
            document.body
          const visible = (el: HTMLElement) => {
            const r = el.getBoundingClientRect()
            return r.width > 0 && r.height > 0
          }
          const leaves = Array.from(scope.querySelectorAll<HTMLElement>('*')).filter(
            el => el.children.length === 0,
          )
          let all = leaves.filter(el => norm(el.textContent).includes(t) && visible(el))
          if (all.length === 0) {
            // 兜底：正文被拆成多个子节点时叶子匹配不到，退回全量最内层扫描
            const matched = Array.from(document.querySelectorAll<HTMLElement>('*')).filter(
              el => norm(el.textContent).includes(t) && visible(el),
            )
            if (matched.length === 0) {
              // 诊断（2026-10-30）：文本在页面上一个都匹配不到时，把线索带回去。
              // 之前这里直接返回空 diag，外层 `return null` 完全静默 —— 日志里只看得到
              // 「未在评论列表找到」，无法区分是「评论被顶出列表」还是「列表根本不在这个
              // document 里（shadow DOM / 别的 frame）」。
              const sample = leaves
                .slice(-6)
                .map(el => norm(el.textContent).slice(0, 14))
                .filter(Boolean)
              return {
                found: 0,
                verified: false,
                diag: [
                  `scope=${String(scope.className || '(body)').slice(0, 28)}`,
                  `leaves=${leaves.length}`,
                  `listItem=${document.querySelectorAll('[class*="list-item"]').length}`,
                  `末尾=${sample.join('|') || '(空)'}`,
                ],
                hints: [] as string[],
              }
            }
            const minD = Math.min(...matched.map(el => el.querySelectorAll('*').length))
            all = matched.filter(el => el.querySelectorAll('*').length === minD)
          }

          /**
           * 是否落在「回复输入区」内（输入框那一块）。
           * ⚠️ 2026-10-29 修正：`replied-content` **不是**输入区引用块，它就是
           * 评论正文本身（祖先链实测：span.replied-content--UayMH < span.content--Ma9od
           * < div.comment-items--IoRgD < div.list-item--k4n5Y）。之前把它当输入区
           * 排到队尾是错的，会让真正的评论候选被降级。这里只看**祖先**上的
           * `reply-content`（输入框容器）/ `comment-input`。
           */
          const inReplyArea = (el: HTMLElement): boolean => {
            let cur: HTMLElement | null = el.parentElement
            for (let i = 0; i < 8 && cur; i++) {
              const cls = typeof cur.className === 'string' ? cur.className : ''
              if (/reply[-_]?content|comment[-_]?input/i.test(cls)) return true
              cur = cur.parentElement
            }
            return false
          }
          // 输入区的引用块文本和评论一字不差、最容易误命中，排到最后再试；
          // 其余按倒序（新评论追加在列表底部，最后匹配的才是刚进来的那条）
          const candidates = [
            ...all.filter(el => !inReplyArea(el)).reverse(),
            ...all.filter(el => inReplyArea(el)).reverse(),
          ].slice(0, 4) // 最多试 4 个，控制耗时

          /**
           * 悬浮工具条图标个数 = 与候选**同一水平带**、在其**右侧**的
           * 「小尺寸 + 可点击」元素个数。
           *
           * 刻意用**文档级**搜索而不是「评论行内」搜索：工具条也可能是挂到 body 上的
           * 浮动层（视频号的 .action-popover 就是），行内搜索会永远数到 0。
           */
          /** 本条评论行**右半区**的小图标个数（= 悬浮工具条是否已出现） */
          const iconCount = (el: HTMLElement): number => {
            const row =
              (el.closest(
                '[class*="list-item"], [class*="comment--"], [class*="comment-wrap"], [class*="commentItem"], [class*="comment-item"]',
              ) as HTMLElement | null) ?? el.parentElement
            if (!row) return 0
            // 优先用精确结构（btn-group > hand--）：3 个图标 = 工具条已出现
            const group = row.querySelector<HTMLElement>('[class*="btn-group"]')
            if (group) {
              const hands = Array.from(group.querySelectorAll<HTMLElement>('[class*="hand--"]'))
              const uniq = hands.filter(n => !hands.some(m => m !== n && n.contains(m)))
              if (uniq.length > 0) return uniq.length
            }
            const rr = row.getBoundingClientRect()
            const rightHalfX = rr.left + rr.width * 0.55
            let n = 0
            for (const node of Array.from(row.querySelectorAll<HTMLElement>('*'))) {
              const r = node.getBoundingClientRect()
              if (r.width === 0 || r.height === 0) continue
              if (r.width > 44 || r.height > 44) continue
              if (r.left + r.width / 2 < rightHalfX) continue
              const cls = typeof node.className === 'string' ? node.className : ''
              if (
                node.tagName === 'BUTTON' ||
                node.getAttribute('role') === 'button' ||
                node.querySelector('svg') ||
                /icon|btn|button|operat|action|tool/i.test(cls)
              ) {
                n++
              }
            }
            return n
          }
          const hoverChain = (el: HTMLElement) => {
            let cur: HTMLElement | null = el
            for (let i = 0; i < 6 && cur; i++) {
              for (const type of ['mouseover', 'mouseenter', 'mousemove']) {
                cur.dispatchEvent(
                  new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }),
                )
              }
              cur = cur.parentElement
            }
          }
          /**
           * 按**文字**找「回复」按钮——比按几何序号猜靠谱得多。
           *
           * 用户 2026-10-29 截图里 hover 评论后弹出的深色气泡，文字就是「回复」二字，
           * 所以页面上一定存在一个文案为「回复」的元素（气泡本身或按钮的 aria-label）。
           * 之前按「右半区第 3 个小图标」猜，实测点到的并不是回复，mention 没插进去。
           * 判据：与候选同一水平带（±40px）、文案恰为「回复」或 aria-label/title 含「回复」。
           */
          const findReplyButton = (el: HTMLElement): HTMLElement | null => {
            const er = el.getBoundingClientRect()
            const cy = er.top + er.height / 2
            let best: HTMLElement | null = null
            let bestScore = Number.POSITIVE_INFINITY
            for (const n of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
              const r = n.getBoundingClientRect()
              if (r.width === 0 || r.height === 0) continue
              if (Math.abs(r.top + r.height / 2 - cy) > 40) continue
              const txt = (n.textContent ?? '').trim()
              const label = `${n.getAttribute('aria-label') ?? ''} ${n.getAttribute('title') ?? ''}`
              const isReply = txt === '回复' || label.includes('回复')
              if (!isReply) continue
              // 面积越小越具体（气泡本体/按钮本身，而不是外层容器）
              const score = r.width * r.height
              if (score < bestScore) {
                bestScore = score
                best = n
              }
            }
            return best
          }

          const diag: string[] = []
          let winner: HTMLElement | null = null
          let verified = false
          for (const c of candidates) {
            hoverChain(c)
            // 验证窗口 500→120ms、步长 80→40ms（2026-10-29 提速）：
            // 4 个候选串行等 500ms 最多要白花 2 秒，而合成 hover 往往一下就渲染出来；
            // 真正决定成败的 hover 是 clickMentionEntry 里的真实鼠标移动，这里只是初筛。
            const deadline = Date.now() + 120
            let n = 0
            let hasBtn = false
            while (Date.now() < deadline) {
              n = iconCount(c)
              hasBtn = !!findReplyButton(c)
              // 行内右半区出现 ≥3 个小图标 = 工具条已被 hover 唤出
              if (n >= 3 || hasBtn) {
                verified = true
                break
              }
              await sleep(40)
            }
            const cls = typeof c.className === 'string' ? c.className : ''
            diag.push(`[${cls || c.tagName}]图标${n}/回复按钮${hasBtn ? '有' : '无'}`)
            if (verified) {
              winner = c
              break
            }
          }
          // 都没唤出工具条：退而求其次用最新的那个候选，
          // 让 clickMentionEntry 走完并输出 DOM 快照，便于下轮收敛
          if (!winner) winner = candidates[0]
          // 验证通过就缓存容器：从命中的那条往上找最近的「有多个子元素且足够高」的祖先，
          // 那就是评论滚动容器；取不到就不缓存（下次照旧全文档扫，不影响正确性）。
          if (verified) {
            let cur: HTMLElement | null = winner
            for (let i = 0; i < 8 && cur && cur !== document.body; i++) {
              const r = cur.getBoundingClientRect()
              if (cur.children.length >= 3 && r.height > 120) break
              cur = cur.parentElement
            }
            w.__ksCommentScope = cur && cur !== document.body ? cur : undefined
          }
          winner.setAttribute('data-ks-mention-target', '1')
          // 找不到真评论时，顺带把「评论/列表/消息」相关 class 名报出来，
          // 下次就能直接写死选择器，不用再猜
          const hints = Array.from(
            new Set(
              Array.from(document.querySelectorAll<HTMLElement>('*'))
                .map(e => (typeof e.className === 'string' ? e.className : ''))
                .filter(c => /comment|message|list|item/i.test(c))
                .map(c => c.trim().split(/\s+/)[0])
                .filter(Boolean),
            ),
          ).slice(0, 14)
          return { found: candidates.length, verified, diag, hints }
        }, target)

        const el = await queryAcrossFrames(page, ['[data-ks-mention-target="1"]'])
        if (el) {
          if (diag.verified) {
            return el as ElementHandle<SVGElement | HTMLElement>
          }
          // 本帧没验到：先记下来当兜底，**继续查其它 frame**——
          // 评论列表很可能嵌在 iframe 里，主 frame 里那个输入区引用块会抢先命中，
          // 一返回就永远看不到真正的评论（2026-10-29 实测：候选恒为 1 个且是引用块）。
          if (!fallback) {
            fallback = el as ElementHandle<SVGElement | HTMLElement>
            fallbackMsg = `候选 ${diag.found} 个：${diag.diag.join(' | ')}`
          }
          frameMsgs.push(
            `${frame.url().slice(0, 60)}→候选${diag.found}/验到${diag.verified ? '是' : '否'} hints[${(diag.hints ?? []).join(',')}]`,
          )
          // 清掉本帧标记，避免下一帧查到的是上一帧的元素
          await frame
            .evaluate(() => {
              for (const e of Array.from(document.querySelectorAll('[data-ks-mention-target]'))) {
                e.removeAttribute('data-ks-mention-target')
              }
            })
            .catch(() => {})
        } else {
          // 本帧一个文本都没匹配到：把诊断带回去，继续查其它 frame
          frameMsgs.push(`${frame.url().slice(0, 40)}→未匹配 ${diag.diag.join(',')}`)
        }
      } catch {
        // 跨域 / 已销毁的 frame 跳过
      }
    }

    if (fallback) {
      electronLog
        .scope('真@回复')
        .warn(
          `快手 hover 未唤出工具条（全部 ${page.frames().length} 个 frame 都没验到）：${fallbackMsg} || ${frameMsgs.join(' ## ')}`,
        )
      return fallback
    }
    // 文本在页面上都找不到：把每个 frame 的线索打出来。
    // 之前这里是**静默** return null，日志里只剩一句「未在评论列表找到」，
    // 完全无法归因 —— 2026-10-30 用户截图证明评论明明在列表里，却一直接不到。
    electronLog
      .scope('真@回复')
      .warn(
        `快手评论列表未命中（${page.frames().length} 个 frame 均无匹配文本）：${
          frameMsgs.join(' ## ') || '(无诊断)'
        }，目标「${target.length > 24 ? `${target.slice(0, 24)}…` : target}」`,
      )
    return null
  },

  /**
   * 真 @ 专用：hover 评论 → 点悬浮工具条的**第 3 个**图标（=「回复」）。
   *
   * 用户 2026-10-29 截图确认：hover 评论后右侧出现 3 个圆形图标，从左到右是
   * 置顶(灰↑) / 转发(灰↻) / **回复(蓝色气泡)**，深色气泡提示「回复」指向第 3 个。
   * 只有点它，平台才会把「回复 @昵称」结构插进评论输入框。
   *
   * 两段关键设计：
   * 1) hover 必须**合成**——直播中评论列表不断重渲染，Playwright 的 hover() 带
   *    actionability 检查会超时（百应实测：合成 hover 100% vs hover() 21%）。
   *    且要沿祖先链**逐层**派发：mouseover 会冒泡、mouseenter 不会，而「行」级
   *    监听可能挂在任一层，只派发最内层元素会漏掉。
   * 2) 工具条是 hover 后才渲染的，且**可能挂在评论行外**（浮动层）。所以用文档级
   *    搜索：取与评论**同一水平带**、在其**右侧**的「小尺寸 + 可点击」元素，
   *    按屏幕 x 从左到右排序取第 3 个。右侧过滤是为了排除左侧的头像/昵称/标签，
   *    否则「取第 3 个」会被头像顶偏、点到「转发」。
   */
  async clickMentionEntry(page: Page, item: ElementHandle<SVGElement | HTMLElement>) {
    const log = electronLog.scope('真@回复')

    // ① 合成 hover（逐层派发，原因见上方注释）
    await item
      .evaluate(el => {
        let cur: HTMLElement | null = el as HTMLElement
        for (let i = 0; i < 6 && cur; i++) {
          for (const type of ['mouseover', 'mouseenter', 'mousemove']) {
            cur.dispatchEvent(
              new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }),
            )
          }
          cur = cur.parentElement
        }
      })
      .catch(() => {})

    // ①-b **真实鼠标移动** —— 这是快手真 @ 之前一直失败的死结所在。
    // 用户 2026-10-29 的 DevTools 截图证明：工具条的显隐是 **CSS :hover** 驱动的
    //   .list-item--k4n5Y .comment-items--IoRgD .comment-content--sRfGW
    //     .btn-group--cN3h4 .hand--CHGlZ:hover .background--kfw7v { fill:#326bfb }
    // 而合成 `dispatchEvent('mouseover')` **不会**改变 CSS `:hover` 状态，
    // 所以之前图标数恒为 0、永远点不到。
    // 用 boundingBox 拿坐标后 page.mouse.move——不走 actionability 检查，不会像
    // Playwright 的 hover() 那样在直播列表里超时。
    const rowBox = await item
      .evaluate(el => {
        const row =
          ((el as HTMLElement).closest('[class*="list-item"]') as HTMLElement | null) ??
          (el as HTMLElement).parentElement
        const r = (row ?? (el as HTMLElement)).getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height }
      })
      .catch(() => null)
    if (rowBox && rowBox.w > 0 && rowBox.h > 0) {
      // 先落在评论文字上（激活整行的 hover 态），再移到行右端（工具条那一侧）
      await page.mouse
        .move(rowBox.x + rowBox.w * 0.35, rowBox.y + rowBox.h / 2, { steps: 2 })
        .catch(() => {})
      await page.mouse
        .move(rowBox.x + rowBox.w * 0.8, rowBox.y + rowBox.h / 2, { steps: 2 })
        .catch(() => {})
    }

    // ② 轮询等工具条渲染出来，然后点第 3 个图标
    //    窗口 1200→800ms、步长 80→50ms（2026-10-29 提速）：工具条通常 100~300ms 就出来
    const deadline = Date.now() + 800
    let lastReport: { count: number; icons: string[] } | null = null
    while (Date.now() < deadline) {
      // 快速路径：DOM 与抖音/百应同构时，操作栏是
      // `div[class^=operationWrapper] div[class^=iconWrapper]`，直接按序号点第 3 个。
      // 只有真的凑够 3 个图标才走这条路，避免只有 1 个图标时点偏。
      const precise = await page
        .$$('div[class^="operationWrapper"] div[class^="iconWrapper"]')
        .catch(() => [])
      if (precise.length > REPLY_ICON_INDEX) {
        await precise[REPLY_ICON_INDEX].dispatchEvent('click').catch(() => {})
        return
      }

      // 说明：曾试过「按文字找『回复』气泡」这条路，已移除——
      // 从没命中过（合成 hover 不会触发 tooltip），而一旦气泡真的出现，
      // 它会先点气泡然后 return，反而挡住下面正确的图标点击。

      // 主路径：在评论行内按 x 取第 3 个图标（用户确认 置顶/转发/回复 里第 3 个是回复）
      // 注意：传给 evaluate 的函数会被序列化到页面里执行，
      // 不能引用本模块作用域的任何变量，工具函数必须内联。
      const res = await item
        .evaluate((el, idx) => {
          // **文档级**搜索（而不是「评论行内」搜索）：工具条也可能是挂到 body 上的
          // 浮动层（视频号的 .action-popover 就挂在行外），行内搜索会永远数到 0。
          // 判据：与候选**同一水平带**（±30px）、在其**右侧**、小尺寸（≤56px）、可点击。
          // 只在**本条评论行内**找图标。
          // 文档级搜索实测会捞到 8 个干扰项（别的评论、输入区、工具栏全混进来），
          // 按 x 排序取第 3 个必然点错——之前「点了但没插 @」就是这个原因。
          // 快手评论行 class 形如 comment--uWMGz / comment-wrap--Eneqq，
          // 哈希随构建变化，所以用 *= 前缀匹配。
          // 真实层级（2026-10-29 日志实测，别再猜）：
          //   span.replied-content--UayMH < span.content--Ma9od
          //     < div.comment-items--IoRgD < div.list-item--k4n5Y ← **评论行**
          //     < div.ReactVirtualized__Grid__innerScrollContainer
          // 之前写成 `comment--`/`comment-wrap--` 不在祖先链上，closest() 返回 null，
          // 退化到只有文字那个 span → 图标恒为 0，这就是一直点不中的原因。
          const row =
            ((el as HTMLElement).closest(
              '[class*="list-item"], [class*="comment--"], [class*="comment-wrap"], [class*="commentItem"], [class*="comment-item"]',
            ) as HTMLElement | null) ?? (el as HTMLElement).parentElement
          if (!row) return { ok: false, count: 0, picked: '', icons: [] as string[] }

          /**
           * 精确路径（2026-10-29 DevTools 实测，与抖音同源思路）：
           * 评论行里有工具条容器，里面的图标是 `div.hand--XXXXX`，3 个依次是
           * 置顶 / 转发 / 回复。Styles 面板里看到的层级：
           *   .list-item--k4n5Y .comment-items--IoRgD .comment-content--sRfGW
           *     .btn-group--cN3h4 .hand--CHGlZ:hover .background--kfw7v
           * 快手 class 一律带构建哈希（--XXXXX），所以用 *= 前缀匹配。
           */
          const collectByStructure = (): HTMLElement[] => {
            const group =
              row.querySelector<HTMLElement>('[class*="btn-group"]') ??
              row.querySelector<HTMLElement>('[class*="operation"]')
            if (!group) return []
            const hands = Array.from(group.querySelectorAll<HTMLElement>('[class*="hand--"]'))
            return hands.filter(n => !hands.some(m => m !== n && n.contains(m)))
          }

          const rr = row.getBoundingClientRect()
          const rightHalfX = rr.left + rr.width * 0.55

          const isIconLike = (n: HTMLElement): boolean => {
            const r = n.getBoundingClientRect()
            if (r.width === 0 || r.height === 0) return false
            if (r.width > 44 || r.height > 44) return false
            // 只看行**右半区**：左侧是头像/昵称/标签，工具条在右边
            if (r.left + r.width / 2 < rightHalfX) return false
            const cls = typeof n.className === 'string' ? n.className : ''
            return (
              n.tagName === 'BUTTON' ||
              n.getAttribute('role') === 'button' ||
              !!n.querySelector('svg') ||
              /icon|btn|button|operat|action|tool/i.test(cls)
            )
          }

          const collect = (root: HTMLElement): HTMLElement[] => {
            const all = Array.from(root.querySelectorAll<HTMLElement>('*')).filter(isIconLike)
            // 父子同时命中时只保留最内层
            const list = all.filter(n => !all.some(m => m !== n && n.contains(m)))
            list.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
            return list
          }
          // ① 精确结构（btn-group > hand--）；② 行内几何；③ 行的父容器（防浮动层）
          let icons = collectByStructure()
          if (icons.length <= idx) {
            icons = collect(row)
          }
          if (icons.length <= idx && row.parentElement) {
            icons = collect(row.parentElement)
          }

          if (icons.length > idx) {
            const target = icons[idx]
            const html = target.outerHTML.slice(0, 200)
            target.click()
            return { ok: true, count: icons.length, picked: html, icons: [] as string[] }
          }
          return {
            ok: false,
            count: icons.length,
            picked: '',
            icons: icons.map(n => n.outerHTML.slice(0, 90)),
          }
        }, REPLY_ICON_INDEX)
        .catch(() => null)

      if (res?.ok) {
        return
      }
      if (res) {
        lastReport = { count: res.count, icons: res.icons }
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    // ③ 没点到「回复」：把工具条的真实结构写进日志（30s 限流，防刷爆）。
    //    拿到这份快照后，把确认过的精确选择器补进 constant.ts 的
    //    commentList.HOVER_TOOLBAR，就能从「几何启发式」收敛成「精确命中」。
    if (Date.now() - lastDomDumpAt > DOM_DUMP_INTERVAL_MS) {
      lastDomDumpAt = Date.now()
      const rowHtml = await item.evaluate(el => (el.outerHTML ?? '').slice(0, 420)).catch(() => '')
      // 祖先链：评论列表的真实层级结构就看这个。
      // 上次失败只看到最内层的 `<span class="replied-content--UayMH">`，
      // 无法判断它到底是列表条目还是输入区的引用块，加上链就能一眼分清。
      const chain = await item
        .evaluate(el => {
          const out: string[] = []
          let cur: HTMLElement | null = el as HTMLElement
          for (let i = 0; i < 6 && cur; i++) {
            const cls = typeof cur.className === 'string' ? cur.className.trim() : ''
            out.push(`${cur.tagName.toLowerCase()}${cls ? `.${cls.split(/\s+/).join('.')}` : ''}`)
            cur = cur.parentElement
          }
          return out.join(' < ')
        })
        .catch(() => '')
      // 顺带探测 constant.ts 里登记的候选工具条选择器有没有命中。
      // 只用于诊断、不用于点击——猜错的选择器点了会点偏，命中信息留给我们收敛。
      const hits = await page
        .evaluate(
          selectors =>
            selectors
              .map(s => {
                const el = document.querySelector(s)
                return el ? `${s}→${el.children.length}个子节点` : null
              })
              .filter((s): s is string => !!s),
          [...SELECTORS.commentList.HOVER_TOOLBAR],
        )
        .catch(() => [])
      log.warn(
        `快手未点到「回复」：右半区图标数=${lastReport?.count ?? 0}` +
          `，图标=${(lastReport?.icons ?? []).join(' || ') || '(无)'}` +
          `，候选命中=${hits.join(' | ') || '(无)'}` +
          `，祖先链=${chain || '(读取失败)'}` +
          `，评论行=${rowHtml || '(读取失败)'}`,
      )
    }
  },

  /**
   * 真 @ 专用：读取输入区当前是否已有 mention，供日志归因。
   *
   * ⚠️ 千万别回整个回复区的文本（2026-10-29 假成功的根因）：快手回复区里永远有
   * 「智能快捷回复」「一键回复观众或直接发评论」这些**固定文案**，helper 判定
   * mention 时又认 `includes('回复')`，于是**永远**判定成功——明明一条 @ 都没插上，
   * 日志却刷「真 @ 成功」，把真实失败完全掩盖了。
   *
   * 正确做法：只回两处**真正会随 mention 变化**的内容
   *   1) 输入框 value（平台可能把「@昵称」当纯文本插进这里）；
   *   2) 「被回复内容」引用块 `[class*=replied-content]`——只有处于回复态才会出现，
   *      且里面带对方昵称（用户截图：输入框上方灰框「生椰粙子yoga: …」）。
   */
  async getMentionProbeText(page: Page) {
    try {
      const input = await queryAcrossFrames(page, [
        SELECTORS.commentInput.TEXTAREA,
        'div[class*=reply-content] input[type=text]',
        'div[class*=reply-content] textarea',
      ])
      const value = input ? await input.inputValue().catch(() => '') : ''
      // 只认「回复输入区里以 @ 开头的那个元素」（= mention chip，形如「@生椰粙子yoga」）。
      // 不能取全页的 replied-content —— 评论列表里每条评论正文本身就是 replied-content，
      // 全取会把别人的评论文本混进来，导致 timing 轮询误判「已有 @」提前结束。
      const mentionText = await page
        .$$eval('[class*=reply-content] *', els =>
          els
            .map(e => (e.textContent ?? '').trim())
            .filter(t => t.startsWith('@'))
            .join(' '),
        )
        .catch(() => '')
      return `${value ?? ''} ${mentionText ?? ''}`.trim()
    } catch {
      return null
    }
  },
}
