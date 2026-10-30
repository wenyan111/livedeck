import type playwright from 'playwright'
import { chromium } from 'playwright-extra'
import stealth from 'puppeteer-extra-plugin-stealth'
import { findChromium } from '#/utils/checkChrome'

export interface BrowserSession {
  browser: playwright.Browser
  context: playwright.BrowserContext
  page: playwright.Page
}

export interface BrowserConfig {
  headless?: boolean
  storageState?: string
}

export type StorageState = playwright.BrowserContextOptions['storageState']

chromium.use(stealth())

class BrowserSessionManager {
  private chromePath: string | null = null

  public setChromePath(path: string) {
    this.chromePath = path
  }

  private async getChromePathOrDefault() {
    if (!this.chromePath) {
      this.chromePath = await findChromium()
    }
    return this.chromePath
  }

  private async createBrowser(headless = true) {
    const path = await this.getChromePathOrDefault()
    // ⚠️ 2026-10-30 教训：这里**不要**再自己加反节流参数。
    // Playwright 的默认 chromiumSwitches 里已经包含
    //   --disable-background-timer-throttling
    //   --disable-backgrounding-occluded-windows
    //   --disable-renderer-backgrounding
    //   --disable-features=<它自己的一串>
    // 我一度又加了一遍，其中 `--disable-features=CalculateNativeWinOcclusion` 会和
    // Playwright 的 `--disable-features` **冲突覆盖**（Chromium 后写的生效），
    // 可能把 Playwright 自己禁用的特性重新打开 —— 既无效又有风险，已移除。
    // 窗口在后台导致的「页面不刷新」改由 createSession 里的 CDP 焦点模拟解决。
    return chromium.launch({
      headless,
      executablePath: path,
    })
  }

  public async createSession(
    headless = true,
    storageState?: StorageState,
    options: { focusEmulation?: boolean } = {},
  ): Promise<BrowserSession> {
    const browser = await this.createBrowser(headless)
    const context = await browser.newContext({
      viewport: null, // 显式设置 null，关闭固定视口
      storageState,
    })
    const page = await context.newPage()

    // ★ 让页面**自己**以为它是被聚焦、被激活的（用户 2026-10-30 定位：中控台在后台时
    // 刷新慢、容易失败）。Chromium 的定时器节流 Playwright 已经默认关掉了，所以剩下
    // 的病根是**页面自身的可见性/焦点逻辑**：很多 SPA 在 document.hidden 或
    // document.hasFocus() === false 时会暂停轮询、停止刷新列表。
    // 窗口被别的窗口遮挡时这两个值可能变成 hidden/blur，于是中控台停在旧数据。
    //
    // ⚠️ **百应（buyin / douyin）必须关掉**（2026-10-30 事故）：
    // 百应的评论「回复」按钮是靠 **hover** 唤出的，强行改掉页面 focus 语义后，
    // 出现「点到了别的行」——把 @ 插到了主播自己头上
    //   「@亲爱的黎子（瘦身版）姐妹，给您备注好凝胶+加急咯」
    // 该现象在装上焦点模拟之前从未出现过，所以按平台开关：默认开，百应关。
    const focusEmulation = options.focusEmulation ?? true
    if (focusEmulation) {
      try {
        const cdp = await context.newCDPSession(page)
        await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
        await cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {})
      } catch {
        // 拿不到 CDP 会话就算了，行为回到改动前
      }
    }

    return { browser, context, page }
  }
}

export const browserManager = new BrowserSessionManager()
