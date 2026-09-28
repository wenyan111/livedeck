import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { Frame, Page } from 'playwright'
import { createLogger } from '#/logger'

const logger = createLogger('小红书商品列表')

/**
 * 小红书蒲公英 / 千帆中控台的商品列表在 2026-09 改版，实测（pgy.xiaohongshu.com）新结构为：
 *
 *   div.goods-list
 *     div.goods-card-list                         ← 滚动容器（overflow-y: scroll）
 *       div.goods-card.goods-card--dual-identity  ← 商品行
 *         div.goods-card__info-row
 *           div.goods-card__checkbox input[type=checkbox]
 *           div.goods-card__index > input         ← 商品序号（值在 value / placeholder）
 *           div.goods-card__base                  ← 商品名 + 「商品ID：xxx」
 *         div.goods-card__action-row
 *           .goods-card__action-btn               ← 下架 / 置顶 / 弹卡 / 讲解（弹卡是 div）
 *
 * 与旧版（千帆表格结构）的两个关键差异：
 * 1. 序号不再是「表格第一列的可见文本」，而是 `.goods-card__index` 里的**输入框**，
 *    值在 `value` / `placeholder` 上 —— 只读 textContent 永远读不到；
 * 2.「直播渠道 · 置顶」那一条商品行**没有序号框**，必须排除，否则滚动锚点会算错。
 *
 * 因此定位策略为：先用上面的结构化选择器，失败时退回「以讲解按钮为锚点的语义回溯」，
 * 官方再次改版也能兜住。
 *
 * 注意：下面传给 playwright `evaluate` 的函数会被序列化到页面里执行，
 * 不能引用本模块作用域的任何变量 / 函数，所有辅助逻辑必须写在函数体内。
 */

/** 打标记用的属性名（只在页面内临时使用，用于把元素句柄取回 Playwright） */
export const MARK = {
  ROW: 'data-oba-goods-row',
  INDEX: 'data-oba-goods-index',
  POPUP: 'data-oba-goods-popup',
  CONTAINER: 'data-oba-goods-container',
} as const

export interface GoodsMark {
  ROW: string
  INDEX: string
  POPUP: string
  CONTAINER: string
}

/**
 * 在页面内执行：给商品行、序号输入框、讲解按钮打上临时标记。
 * 返回本次标记到的行数与滚动容器是否命中。
 */
export function tagGoodsRowsInPage(mark: GoodsMark): { rows: number; container: boolean } {
  const POPUP_TEXTS = ['讲解', '结束讲解']
  /** 商品行候选（新版在前，旧版表格兜底） */
  const ROW_SELECTORS = [
    '.goods-list .goods-card',
    '.goods-card-list .goods-card',
    '.goods-card',
    '.goods-list .table-wrap > div > div > table tbody tr',
    '.goods-list table tbody tr',
    '.goods-list tbody tr',
  ]
  /** 商品序号候选（新版 index 输入框在前） */
  const INDEX_SELECTORS = [
    '.goods-card__index input',
    '[class*="index"] input',
    'td:first-child input',
    'input[type="text"]',
    'input:not([type])',
  ]

  const classOf = (el: Element) => (typeof el.className === 'string' ? el.className : '')
  const isField = (el: Element) =>
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
  /** 读取元素“文本”：输入框取 value / placeholder，其余取 textContent */
  const readText = (el: Element) => {
    if (isField(el)) {
      const field = el as HTMLInputElement
      return String(field.value || field.placeholder || '').trim()
    }
    return (el.textContent ?? '').trim()
  }
  const leavesOf = (node: ParentNode) =>
    Array.from(node.querySelectorAll('*')).filter(el => el.children.length === 0)
  const isVisible = (el: Element) => {
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  // 0. 清理上一次的标记（虚拟列表会复用节点）
  for (const name of [mark.ROW, mark.INDEX, mark.POPUP, mark.CONTAINER]) {
    for (const el of Array.from(document.querySelectorAll(`[${name}]`))) {
      el.removeAttribute(name)
    }
  }

  // 1. 行解析工具：商品序号 + 讲解按钮
  //    语义兜底也要靠它判断「上溯到哪一层才是真正的商品行」，所以先定义。
  const resolveIndex = (row: Element): Element | null => {
    for (const selector of INDEX_SELECTORS) {
      let fields: Element[] = []
      try {
        fields = Array.from(row.querySelectorAll(selector))
      } catch {
        fields = []
      }
      for (const field of fields) {
        if (/^\d{1,4}$/.test(readText(field))) {
          return field
        }
      }
    }
    // 兜底：行内靠左的纯数字元素（含输入框的 value / placeholder）
    const rowRect = row.getBoundingClientRect()
    const limit = Math.max(rowRect.width * 0.35, 40)
    let best: { el: Element; left: number } | null = null
    for (const el of leavesOf(row)) {
      if (!/^\d{1,4}$/.test(readText(el))) continue
      if (!isVisible(el)) continue
      const left = el.getBoundingClientRect().left - rowRect.left
      if (left < -4 || left > limit) continue
      if (!best || left < best.left) {
        best = { el, left }
      }
    }
    return best ? best.el : null
  }

  const resolvePopup = (row: Element): Element | null => {
    for (const el of leavesOf(row)) {
      if (!POPUP_TEXTS.includes(readText(el))) continue
      // 「讲解」文本可能被 span 包一层，向上取到真正可点击的按钮 / 操作项
      let clickable: Element = el
      let cur: Element | null = el
      while (cur && cur !== row) {
        if (cur.tagName === 'BUTTON' || cur.tagName === 'A' || /action-btn/.test(classOf(cur))) {
          clickable = cur
        }
        cur = cur.parentElement
      }
      return clickable
    }
    return null
  }

  // 2. 结构化选择器（新版优先，旧版兜底）
  let candidates: Element[] = []
  for (const selector of ROW_SELECTORS) {
    let found: Element[] = []
    try {
      found = Array.from(document.querySelectorAll(selector))
    } catch {
      found = []
    }
    if (found.length > 0) {
      candidates = found
      break
    }
  }

  // 3. 语义兜底：以「讲解 / 结束讲解」为锚点，向上回溯到最小的、既含该按钮又含商品序号的容器
  if (candidates.length === 0) {
    const anchors = leavesOf(document).filter(el => POPUP_TEXTS.includes(readText(el)))
    if (anchors.length === 0) {
      return { rows: 0, container: false }
    }
    const countPopupIn = (node: Element) =>
      leavesOf(node).filter(el => POPUP_TEXTS.includes(readText(el))).length
    const seen = new Set<Element>()
    for (const anchor of anchors) {
      let cur: Element | null = anchor
      while (cur && cur !== document.body && cur !== document.documentElement) {
        const rect = cur.getBoundingClientRect()
        // 真正的商品行需同时满足：宽度够、行内只有一个讲解按钮、且能读到商品序号。
        // 若只看前两条，会停在 `.goods-card__action-row`（按钮行）这一层，
        // 那里没有序号，结果整行被判定为“不可用序号定位”而漏掉。
        if (rect.width >= 240 && countPopupIn(cur) === 1 && resolveIndex(cur) !== null) {
          break
        }
        cur = cur.parentElement
      }
      if (cur && cur !== document.body && cur !== document.documentElement && !seen.has(cur)) {
        seen.add(cur)
        candidates.push(cur)
      }
    }
  }

  // 4. 逐行解析与打标
  const resolved: { row: Element; indexEl: Element; popupEl: Element | null }[] = []
  const seenRows = new Set<Element>()
  for (const row of candidates) {
    if (seenRows.has(row)) continue
    seenRows.add(row)
    if (!isVisible(row)) continue
    const indexEl = resolveIndex(row)
    // 没有序号的行（新版「直播渠道 · 置顶」行）不参与序号定位，直接跳过
    if (!indexEl) continue
    resolved.push({ row, indexEl, popupEl: resolvePopup(row) })
  }

  if (resolved.length === 0) {
    return { rows: 0, container: false }
  }

  for (const item of resolved) {
    item.row.setAttribute(mark.ROW, '1')
    item.indexEl.setAttribute(mark.INDEX, '1')
    if (item.popupEl) {
      item.popupEl.setAttribute(mark.POPUP, '1')
    }
  }

  // 5. 滚动容器：行的最近一个可滚动祖先
  let container: Element | null = null
  let cur: Element | null = resolved[0].row.parentElement
  while (cur && cur !== document.body) {
    const style = getComputedStyle(cur)
    if (/(auto|scroll|overlay)/.test(style.overflowY) && cur.scrollHeight > cur.clientHeight + 4) {
      container = cur
      break
    }
    cur = cur.parentElement
  }
  if (!container) {
    container = resolved[0].row.parentElement
  }
  if (container) {
    container.setAttribute(mark.CONTAINER, '1')
  }

  return { rows: resolved.length, container: container !== null }
}

/** 在页面内执行：判断按钮（或其容器）是否处于禁用态 */
export function isDisabledInPage(el: Element): boolean {
  let cur: Element | null = el
  let depth = 0
  while (cur && cur !== document.body && depth < 6) {
    if (cur.hasAttribute('disabled') || cur.getAttribute('aria-disabled') === 'true') {
      return true
    }
    const cls = typeof cur.className === 'string' ? cur.className : ''
    if (/(^|[\s-])(disabled|is-disabled)/.test(cls)) {
      return true
    }
    cur = cur.parentElement
    depth++
  }
  return false
}

/** 在页面内执行：收集诊断信息，用于官方再次改版时快速定位 */
export function describeGoodsPageInPage(): string {
  const POPUP_TEXTS = ['讲解', '结束讲解']
  const leavesOf = (node: ParentNode) =>
    Array.from(node.querySelectorAll('*')).filter(el => el.children.length === 0)
  const classOf = (el: Element) => (typeof el.className === 'string' ? el.className : '')
  const isField = (el: Element) =>
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
  const ownText = (el: Element) => {
    if (isField(el)) {
      const field = el as HTMLInputElement
      return `[value=${JSON.stringify(field.value)} placeholder=${JSON.stringify(field.placeholder)}]`
    }
    return (el.textContent ?? '').trim()
  }
  const isPopupLeaf = (el: Element) => POPUP_TEXTS.includes((el.textContent ?? '').trim())

  const lines: string[] = []
  const rect = (el: Element) => {
    const r = el.getBoundingClientRect()
    return `w=${Math.round(r.width)} h=${Math.round(r.height)} x=${Math.round(r.left)}`
  }
  const desc = (el: Element) =>
    `<${el.tagName.toLowerCase()} class="${classOf(el)}" id="${el.id || '-'}"> ${rect(el)} children=${el.children.length} text=${JSON.stringify(ownText(el).slice(0, 60))}`

  lines.push(`url: ${location.href}`)
  lines.push(`title: ${document.title}`)
  lines.push(
    `tables=${document.querySelectorAll('table').length} tr=${document.querySelectorAll('tr').length} ` +
      `iframes=${document.querySelectorAll('iframe').length}`,
  )
  lines.push(
    [
      '.goods-list .goods-card',
      '.goods-card-list .goods-card',
      '.goods-card',
      '.goods-list .table-wrap > div > div > table tbody tr',
      '.goods-list tbody tr',
    ]
      .map(selector => {
        let count = -1
        try {
          count = document.querySelectorAll(selector).length
        } catch {
          count = -2
        }
        return `${selector}=${count}`
      })
      .join('  '),
  )

  const anchors = leavesOf(document).filter(isPopupLeaf)
  lines.push(`popupAnchors(${POPUP_TEXTS.join('/')})=${anchors.length}`)
  lines.push('')

  anchors.slice(0, 4).forEach((anchor, i) => {
    lines.push(`===== anchor[${i}] text=${JSON.stringify(ownText(anchor))} =====`)
    let cur: Element | null = anchor
    let depth = 0
    while (cur && cur !== document.body && depth < 10) {
      lines.push(`${'  '.repeat(depth)}${desc(cur)}`)
      cur = cur.parentElement
      depth++
    }
    // 找一个只包含该按钮的最小容器，导出它的 HTML，便于写精确选择器
    let rowCur: Element | null = anchor
    while (rowCur && rowCur !== document.body) {
      if (
        leavesOf(rowCur).filter(isPopupLeaf).length === 1 &&
        rowCur.getBoundingClientRect().width >= 240
      ) {
        break
      }
      rowCur = rowCur.parentElement
    }
    if (rowCur) {
      const html = rowCur.outerHTML ?? ''
      lines.push(`----- row outerHTML (前 6000 字符, 共 ${html.length}) -----`)
      lines.push(html.slice(0, 6000))
      lines.push('')
    }
  })

  return lines.join('\n')
}

/** 定位已完成语义标记的 frame */
export async function findTaggedFrame(page: Page): Promise<Frame | null> {
  for (const frame of page.frames()) {
    try {
      if (await frame.$(`[${MARK.ROW}]`)) {
        return frame
      }
    } catch {
      // frame 可能已销毁，跳过
    }
  }
  return null
}

/** 执行语义标记，返回标记到商品行的 frame */
export async function tagGoodsRows(page: Page): Promise<Frame | null> {
  for (const frame of page.frames()) {
    try {
      const result = await frame.evaluate(tagGoodsRowsInPage, MARK)
      if (result && result.rows > 0) {
        return frame
      }
    } catch {
      // 跨域 iframe 无法执行脚本时跳过
    }
  }
  return null
}

/** 定位失败时把页面结构导出到日志目录，方便下一次直接对照修复 */
export async function dumpGoodsDiagnostics(page: Page): Promise<string | null> {
  try {
    const dir = path.join(app.getPath('logs'), 'goods-diagnostic')
    await fs.mkdir(dir, { recursive: true })
    const stamp = new Date()
      .toISOString()
      .replace('T', '_')
      .replace(/[:.]/g, '-')
      .slice(0, 19)
    const filePath = path.join(dir, `${stamp}-商品列表诊断.txt`)

    const parts: string[] = []
    for (const frame of page.frames()) {
      try {
        const text = await frame.evaluate(describeGoodsPageInPage)
        parts.push(`########## frame: ${frame.url()} ##########`)
        parts.push(text)
        parts.push('')
      } catch {
        parts.push(`########## frame: ${frame.url()} (无法访问) ##########`)
      }
    }
    await fs.writeFile(filePath, parts.join('\n').slice(0, 200_000), 'utf8')
    logger.error(`商品列表定位失败，已导出页面结构：${filePath}`)
    return filePath
  } catch (error) {
    logger.error('导出商品列表诊断文件失败：', error)
    return null
  }
}
