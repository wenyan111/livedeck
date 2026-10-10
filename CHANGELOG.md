# Changelog

## v1.0.5

### 🐞 Bug Fixes（自动更新检测与版本显示）
- **修复「检测不到新版本」：** 版本探针 `getLatestVersion()` 此前直连 jsDelivr `@main` 分支 CDN，该 URL 边缘缓存长达 12h（`s-maxage=43200`），导致发布后最长 12h 内旧版用户仍判定「已是最新」。现对 `package.json` / `CHANGELOG.md` 请求追加 `?t=<时间戳>` 强制边缘节点回源（GitHub）拉取最新内容。
- **修复「当前版本」显示滞后：** 设置页「当前版本」此前读取渲染层构建时内联的 `package.json` 版本常量，bump 与 `vite build` 次序错位时会冻结在旧版本（如已装 1.0.3 却显示 1.0.2）。现改为运行时通过新增 `app:getVersion` IPC 读取 `app.getVersion()`，始终与标题栏一致。

## v1.0.4

### 🚀 发布：自动更新通道正式上线
- 通过 CI（`release.yml` + `release-windows.yml`）发布 GitHub release，补齐 `latest-mac.yml` / `latest.yml` 与双平台安装包（macOS dmg / Windows NSIS exe），应用内「检查更新 → 下载 → 安装」端到端可用。
- 版本 1.0.3 → 1.0.4。

## v1.0.3

### 🐞 Bug Fixes（本机已验证，随 1.0.4 一并发布）
- 修复多账号环境下关键词自动回复串号：回复改用评论所属账号 `accountId`，不再误用 UI 当前选中账号 `currentAccountId`。
- 修复开价联动监听在页面 reload / 重连后静默失效：触发源账号连上中控台时自动拉起监听，恢复联动通电。

## v1.0.2

### 🐞 Bug Fixes（自动更新链路修复）
- **macOS 自动更新：** 修复 `MacOSUpdater` 只匹配 `${arch()}.dmg` 后缀、而 electron-builder 默认产出 `livedeck-x.y.z.dmg`（无 arch 后缀）导致检测不到更新包的问题。现改为优先匹配 arch 后缀、否则兜底匹配任意 `.dmg`，并修正「已是最新」判定（同版本不再重复下载）。
- **Windows 自动更新：** `WindowsUpdater` 由标准 electron-updater（默认校验 Authenticode 签名，未签名包会失败）改为仿 macOS 的半自动流程——拉 `latest.yml` → 下载 `exe` → 打开并退出手动装，绕过签名校验（未签名 exe 首次安装会被 SmartScreen 拦截，点「仍要运行」即可）。

### 🚀 Features（Windows 自动发布 CI）
- 新增 `.github/workflows/release-windows.yml`：打 `v*` tag 即在 `windows-latest` 原生构建未签名 NSIS 安装包（免 wine），并用默认 `GITHUB_TOKEN` 上传 `exe` + `blockmap` + `latest.yml` 到本仓库 release，供 `WindowsUpdater` 读取实现自动更新。

## v1.0.1

### ✨ 优化：全量去除原作者品牌 + 发布配置就绪
- **去除原作者 oba 品牌**：`package.json` 的 `author` 改为 `wenyan111`、`name` 为 `livedeck`；`electron-builder.json` 的 `appId` 改为 `com.wenyan111.livedeck`；README/CHANGELOG/LICENSE 的原作者仓库链接与署名批量改为 `wenyan111/livedeck`；临时更新文件 `oba-update-setup.dmg` 更名为 `livedeck-update-setup.dmg`。（注意：已装旧 `appId` 版本的用户升级到此版会断更，需重装以回到更新通道。）
- **发布配置就绪**：`electron-builder.json` 增加 `publish: { provider: github, owner: wenyan111, repo: livedeck }`，发版时执行 `electron-builder --mac dmg --publish always`（Windows 需 `--win nsis`）即可自动上传 `latest-mac.yml` / `latest.yml` 并向用户推送更新。

## v1.0.0

### ✨ 优化：自动更新接管为自有发布源 + 软件更名
- **更新源收敛到单一配置**：二进制更新（`UpdateManager.ts`）与平台凭证数据源 `providers.json`（`ProviderService.ts`）、页脚 GitHub/Issues 链接（`OtherSetting.tsx`）统一改从 `shared/updateSource.ts` 的 `UPDATE_SOURCE = { owner, repo, branch }` 读取。以后接管/切换自己的发布源只改这一处。
- **软件更名**：`electron-builder.json` 的 `productName` 改为 `LiveDeck・直播台`（界面/窗口/安装包显示名）；`package.json` 的 `name` 改为 `livedeck`、`electron-builder.json` 的 `appId` 改为 `com.wenyan111.livedeck`，统一品牌标识（已装旧 appId 版本的用户需重装以继续接收更新）。
- **自有发布流程**：bump 版本 + 在 `CHANGELOG.md` 顶上加版本 → 打包 → 把 `vX.Y.Z` 资源与打包自动生成的 `latest-mac.yml` / `latest.yml` 传到自己仓库的 releases，即可向用户推送更新。当前 `UPDATE_SOURCE.owner` 为占位，填自己的 GitHub 用户名后即生效。

## v1.7.16

### ✨ 优化：开价联动「自恢复」——连接即自动通电

- **触发源监听自动拉起:** 联动开关 `enabled` 本就持久化（记在 `open-price-linkage-storage`），但重连 / 重装后联动不跑的根因是**触发源的开价监听没自动重启**——监听没起，主进程就不会广播 `openPriceWarmupTriggered`，整条联动等于「开关亮着却没通电」。现改为：只要联动开启且触发源账号连上中控台，`useOpenPriceLinkageGlobal`（App 层常驻）就自动 `startWatcher` 拉起它自己的监听，无需每次手动点「开启监听」。
- **「停用自身检测」策略自动复跑:** 重连后跟随平台的自身开价监听可能被「一键开启」的「开价话术」拉起，导致一条开价被发两次。自恢复时同步按最新配置重跑 `applySelfWatchPolicy`，把勾选了「停用自身检测」的跟随平台停掉，杜绝双发。
- **只拉起不重复:** 仅在触发源监听「未运行」时拉起；未配置话术时不拉起（避免启动弹「未配置开价话术」报错）。手动停止监听、或关闭联动开关都不会被自动复拉，行为可控。
- **卡片提示文案同步:** 「跨平台开价联动」说明与触发源状态提示改为「连接中控台后会由联动自动拉起」，与实际行为一致。

## v1.7.15

### 🐛 修复：AI回复「提示词配置」输入框高度记忆

- **提示词输入框记住高度:** 自动回复设置 → AI回复 → 「提示词配置」的输入框，手动拖高之后，下次进入（退出设置页再进来、或重启应用）保持同一高度，不用每次重新「拉开」才能看全提示词。用 `ResizeObserver` 捕获拖拽（textarea 拖拽改高不会派发 resize 事件），高度存 localStorage（`ai-reply-prompt-height`）。

## v1.7.14

### 🐛 修复：开价话术面板展开状态记忆 + 自动回复平台说明

- **开价话术面板记住展开状态:** 「跨平台开价联动」里每个账号的「开价话术」折叠面板（内含配置话术），展开后通过 localStorage 按账号持久化，下次进入不再自动收起，不用每次手动拉开才能看全部配置词。
- **使用说明（自动回复平台）改为动态派生:** 中控台「使用说明」第 3 条原本写死「自动回复功能目前仅对抖音小店和巨量百应开放」，已与实际能力脱节（abilities 里 `autoReplyPlatforms` 现覆盖抖音小店、巨量百应、视频号、快手、小红书、淘宝等多平台）。改为从 `abilities.ts` 实时派生，日后新增平台自动同步，不会再次过期。

## v1.7.13

### 🐛 修复：一键开启「账号 × 平台」隔离与代入问题

- **勾选双重隔离:** 「一键开启」的功能勾选从「按平台」升级为「按 账号 × 平台」双重隔离——同一平台下的不同账号（如抖音午场/晚场账号）各记一份，切平台、切账号互不代入。旧数据自动迁移（存储版本 2→3），升级前各平台的勾选原样保留。
- **「连接后自动开启」同样隔离:** 该开关原先全局共用一个值，在小红书关掉抖音也跟着变；现改为每个「账号 × 平台」各自记忆，旧的全局值会复制为各平台初始值。
- **断线恢复不再跨平台代入:** 断线自动恢复的现场现在会记录断线时的平台；切换平台后重连（同一账号），不再把上个平台跑的任务原样恢复到新平台上。
- **界面标明作用对象:** 卡片标题下新增「当前：平台 · 账号」提示，勾选作用对象一目了然。
- **修复 Label 点击目标错位:** 勾选框文字的 `htmlFor` 缺少平台前缀导致点击文字无效，已修正。

## v1.7.12

### 🎨 样式优化（开关「开启」态改绿色）
- **开关（Switch）:** 开启态由原先的 `bg-primary`（深色下是浅灰白）改为绿色 `bg-success`；滑块统一为白点（原先深色主题下是近黑色，在绿底上不够清晰），一眼能区分「开 / 关」。全局 20 个使用 Switch 的页面（开价联动、跟随平台、停用自身检测、自动回复、浏览器设置等）一并统一。
- **设计 token:** 新增 `--success-foreground`（浅色/深色均为纯白）与 `--color-success-foreground`，供绿底上的文字/图标使用。
- **按钮:** 新增 `success` 变体（`bg-success` + 白字 + hover 90%）；「开启 / 开始」类动作统一改用它——首页「一键开启」、各功能页「开始任务」（TaskButton）、开价联动「开启监听」现在都是绿色，与「一键停止 / 停止任务」的红色形成对仗；「停止」「下载」「连接」等仍保持中性色。
- **开价联动:** 触发源未监听时，「开启监听」显示为绿色；监听中变回中性 `secondary` 的「停止监听」。
- **打包:** `electron-builder.json` 的 `files` 增加 `!**/fsevents/**`——fsevents 是 `playwright` 的可选依赖、
  只在 macOS 上被安装，打包 Windows 时会被一并复制进来，现已排除。

## v1.7.11

### 🎨 样式优化（P0 配色清扫）
- 新增设计 token：`--color-success` / `--color-warning`，与 `--color-destructive` 对齐，可在全项目用 `text-success` / `bg-success/10` / `text-warning` / `border-warning/30` 等工具类。
- 清除所有硬编码彩色/灰色类，统一走设计 token：
  - 日志：DEBUG→`text-muted-foreground`、SUCCESS→`text-success`、NOTE→`text-foreground`，去掉蓝/紫。
  - 评论列表：进场/点赞/关注/粉丝团→`text-muted-foreground`，品牌会员→`text-warning`，下单→`text-success`；订单状态 已下单→琥珀、已付款→绿色；高亮行改用 `bg-accent`，进场气泡改用 `bg-muted`。
  - 直播日报：计算字段→`bg-accent/50`、人工→`bg-muted/50`、有值→`bg-success/10`、空值→`bg-destructive/10`、低置信→`ring-warning`；视觉模板提示改用 success/warning。
  - 过滤词标签、预览回复内容、更新弹窗版本号、连接状态点、快捷启动状态点、置顶图标、加载圈、条件编排器、Toast 关闭按钮等全部去硬编码灰/蓝/紫/粉/天蓝。
- 深色模式下此前不可见的 `gray-300/400/600/700` 一律改为 `muted-foreground` / `success` / `destructive`，中性深色真正统一。

## v1.7.10

### 🐞 Bug Fixes（侧边栏列表超出后被裁、无法滚动）

- **侧边栏:** 导航项较多时（当前 9 项）底部「应用设置」被裁掉、点不到，整列也不能滚动。原因是 `aside` 没有滚动容器、被父级 `overflow-hidden` 裁切。改为 `aside` 自身 `overflow-y-auto`，超出时可竖向滚动；底部留白避免最后一项被日志面板压住；加细滚动条样式（深色下更协调）。

## v1.7.9

### ✨ Feature（界面美化）

- **侧边栏:** 导航项重做——统一图标库为 lucide（去掉原先混用的 carbon 图标，「直播日报」也从 lucide 改一致），每个图标包在圆形胶囊里；激活项改为「左侧白条 + 填充底色 + 图标胶囊高亮」，辨识度明显高于旧版的灰底灰字。
- **侧边栏:** 运行/失败状态圆点改用语义色彩 token（`--success` 绿 / `--destructive` 红），明暗主题都协调。
- **头部:** 新增「已连接 / 连接中 / 未连接」状态胶囊（绿/黄/红），一眼看清中控台连接状态；logo 加圆角底，标题下加一行小副标题。
- **日志面板:** 底部固定 180px 日志区改为可交互面板——顶部可拖拽调高度（120–460px），并支持「收起 / 展开」，释放内容区竖空间。
- **页面:** 切换路由时内容淡入（`page-fade`，0.22s）；卡片加 hover 微交互（边框微亮 + 轻微阴影）；页面标题（Title）加左侧强调竖条。
- 整体仍守住中性深色、不引入蓝调的观感。

## v1.7.8

### ✨ Feature（开价话术「置顶首条话术」开关）

- **开价话术:** 设置区新增「置顶首条话术」开关（默认开）。开启时开价变预热会把第一条话术置顶（抖音）/ 上墙（视频号）到直播间公屏；关闭后第一条不置顶，仅按每条右侧的图钉单独控制。
- **开价话术:** 开关按账号独立记忆（`open-price-script-storage` 持久化），升级后旧配置默认视为开启，原行为不变。
- **开价话术:** 置顶决策统一收敛到渲染层（新增 `buildOpenPriceSendMessages`），「自检测」与「跨平台联动」两条发送路径都受该开关控制；主进程不再强制置顶首条，改为原样转发渲染层算好的 pinTop。
- **开价话术:** 运行中实时切换开关/话术会通过 `updateOpenPriceMessages` 同步到监听中的待发送列表，无需停止再开启。

## v1.7.7

### 💄 深色主题重做（对齐 WorkBuddy 的观感）

- **外观:** 深色配色从默认 shadcn 的「蓝黑」换成**中性近黑、低对比、柔和灰**的一套：
  背景 `4%`、卡片/浮层 `8~9%`、边框 `15%`、正文 `90%`、次要文字 `58%`、主色 `82%`（都是中性灰，不带蓝调），不再有纯白、不再刺眼。
- **外观:** 顶部 Header 改为 `bg-background` + 细底边，与主区域同色（去掉独立色块感），整体更扁平、更像 WorkBuddy 的布局观感。
- 浅色主题保持不变。

## v1.7.6

### 🐞 Bug Fixes（深色模式下仍有刺眼白块）

- **外观:** 顶部标题栏（`Header`）原来硬编码 `bg-white`，深色模式下仍是白的 —— 改为跟随主题的 `bg-card` + 底部分隔线，`直播助手` 标题颜色也改为 `text-foreground`。（顺带修好了它上面那个「快手」账号选择框在深色下显得发白的问题：选择框本身是透明的，白是因为底下的白 Header。）
- **外观:** macOS 系统窗口标题栏（带红黄绿圆点那条）在深色模式下仍是浅色。新增主进程 `nativeTheme.themeSource` IPC（`app:setTheme`），切换深色时系统标题栏一起变深，浅色时一起变浅。
- **外观:** 降低深色主题里「纯白」的刺眼程度：主色 `--primary` 由近白 `98%` 降到柔和 `88%`（默认按钮如「开始检测」不再白得晃眼），正文/卡片/浮层文字由 `98%` 降到 `92%`。

## v1.7.5

### ✨ Feature（外观设置：深色背景界面）

- **设置 → 外观设置:** 新增「深色背景」开关（深色模式）。打开后整个界面切换为深色配色，适合暗光环境长时间使用、减少眩光。
- **外观:** 复用已有的 `.dark` CSS 变量主题（`index.css` 里已经定义好完整深色变量），新增简单的 zustand `appearance-storage` 持久化（默认浅色、可切换），切换实时生效并记住选择。
- **外观:** 开机即应用：React 挂载前在 `index.html` 里先读 `localStorage` 给 `<html>` 加 `.dark`，避免启动闪白；App 根组件 `useApplyTheme()` 在挂载与每次切换时同步 `.dark` 类。
- **外观:** 把原先硬编码的浅色背景改为跟随主题——根容器 `bg-gray-50` → `bg-background`、底部日志面板 `bg-white` → `bg-card`、DataEntry 弹窗 `bg-white` → `bg-card`、自动发言/关键词回复编辑器文本框与行号槽 `bg-white/bg-gray-100` → `bg-background/bg-muted`，深色模式不再有刺眼白块。

## v1.7.4

### ✨ Feature（一键开启按平台隔离勾选）

- **一键开启:** 把「自动发言 / 自动弹窗 / 自动回复 / 开价话术」四个勾选项从**全局共用一份**改为**每个平台各自记住自己的勾选**——切到抖音勾的、切到视频号不会变；在快手关掉开价话术，不影响抖音的开价话术仍然勾着。
- **一键开启:** 旧版本（v1.7.3 及之前）的全局勾选会作为「所有平台的初始勾选」自动迁移，升级后已有的勾选习惯不丢；`quick-start-storage` 持久化版本号升到 2，带 migrate 兼容。
- **一键开启:** 「连接后自动开启」开关保持全局（语义是：连接中控台时，自动开启**当前平台**已勾选的功能），不随平台隔离。

## v1.7.3

### 🐞 Bug Fixes（AI 回复把思考过程也发出去、并把答复重复好几遍）

- **自动回复:** 修复 AI 把**思考过程 / 规则复述**写进正文的问题。历史事故：
  `用户问全家能不能用拍的一套，首先看规则：16-70岁、300斤以内都能用，除了脸和胸，辅助减肥塑形。所以要回答：一套全家…`
  —— 冒号前那截是模型的「自言自语」，不该发给观众。
  根因是系统提示写的是「请**分析**所有评论，并**根据以下要求**生成一个回复」，等于邀请模型边想边写。
  现已改为「请只针对最后一条评论写一条回复」，并在输出要求里硬性禁止思考 / 分析 / 规则说明。
- **自动回复:** 输出兜底增强：识别「…所以要回答：」「回复：」「答：」等引导词，只保留其后的正文；
  再按句末标点切句，折叠与上一句完全相同、或高度相似（只差尾字）的句子 ——
  覆盖 `…全家合适呀～` / `…全家合适哒～` 这类复读。
- **自动回复:** 只把**当前这条**评论喂给模型，不再把该观众的历史评论/回复（含被关键词/AI 过滤掉的刷屏弹幕）一并传进去——历史越长越杂，模型越容易试图「回应所有评论」而写得又长又乱。用户已明确：AI 回复只针对当前这一条评论。

## v1.7.2

### 🐞 Bug Fixes（发送评论偶发超时中断）

- **一键评论 / 开价话术:** 修复 `elementHandle.fill: Timeout 5000ms exceeded` 导致回复直接丢失的问题。
  直播间页面（尤其多平台同时跑、机器负载高时）5 秒内完不成元素可编辑性检查，
  填一次失败整个任务就中断。现在单次超时放宽到 10 秒，失败后重新查找元素最多重试 3 次

### 🐞 Bug Fixes（AI 回复把同一句话说了两遍）

- **自动回复:** 修复「一条回复里塞了两句话」的问题——
  例如 `可以的哦，EMS还能舒缓肌肉…～可以的哦，EMS脉冲还能舒缓肌肉…～`，
  或者干脆 `姐妹，给您备注好凝胶+草本贴啦～姐妹，给您备注好凝胶+草本贴啦～`。
  原因是同一位观众在近期窗口里复读同一句话时，喂给模型的 prompt 里同一个问题出现了多条，
  模型就在一次输出里回答多遍。现在按 msg_id + 评论内容双重去重，同一个问题只喂一次
- **自动回复:** 系统提示词补上硬性输出约束：只输出一条回复正文，不要多条备选、不要重复、不要分段
- **自动回复:** 输出兜底清理：整段正好是同一句话重复两遍时自动折叠成一遍（其余情况原样保留，不做猜测性裁剪）
- **自动回复:** 同一条评论（msg_id 相同）重复投递时不再重复入评论列表

## v1.7.1

### 🐞 Bug Fixes（断线重连后「自动回复」静默失联）

- **自动回复:** 修复中控台断开重连后，**自动回复没有恢复、界面却仍显示「监听中」**的问题。
  断线会把所有任务停掉，但只有自动发言 / 自动弹窗会把状态同步回界面，
  自动回复的界面状态一直停在「监听中」——用户以为还在跑，实际一条弹幕都进不来，
  要手动「停止监听」再「开始监听」才恢复
- **连接状态:** 断线时统一复位该账号的运行状态（自动回复 → 已停止、自动发言 / 自动弹窗 / 开价话术 → 未运行），
  界面不再谎报运行中

### 🚀 Features

- **断线自动恢复:** 重连成功后，自动把**断线前正在运行的功能**重新拉起来
  （自动发言 / 自动弹窗 / 自动回复 / 开价话术监听），不用再一个个手动重开。
  与「连接后自动开启」的区别：那个按勾选启动，这个按断线前的实际运行情况恢复现场

## v1.7.0

### 🐞 Bug Fixes（开价话术「一开启就把话术全发一遍」）

- **开价话术:** 修复开启监听后（或页面重载、监听自愈重新注入后）**不等后台点开价就把全部话术发一遍**的问题。
  原因在页面里的跳变判定：只要「上一帧不是预热、这一帧出现预热」就触发，
  而「上一帧啥按钮都没扫到」(页面还没渲染完 / 虚拟列表滚动导致按钮消失) 也被算进了「不是预热」。
  于是页面重载后按钮一渲染出来就是「预热」（上一场还在预热中），直接被当成开价动作
- **开价话术:** 判定收紧为「上一帧必须真的扫到过『开价』按钮，本帧才允许判定为开价」，
  页面没渲染完、按钮被虚拟列表回收时都不会再误触发
- **开价话术:** 监听每秒兜底扫一次状态。MutationObserver 只在 DOM 变动时回调，
  页面长时间静止时状态基线会停在注入那一刻，真开价反而可能漏掉

## v1.6.16

### 🐞 Bug Fixes（抖音「每条弹幕都回复两遍」事故修复）

- **自动回复:** 修复同一条弹幕被处理两遍、自动回复 / 一键评论全部发两份的问题。
  根因是「重复启动」：对同一账号再次点一键开启（或连接后自动开启）时，
  主进程只把新任务塞进任务表**覆盖**旧任务，旧任务并没有被停掉——
  它挂在页面上的评论监听器还在跑，而且再也停不掉（幽灵任务）。
  两个监听器各自去重、互不知情，于是每条弹幕都被处理两次
- **自动回复:** 同类型任务改为「先停旧的再启新的」，保证一个账号同一时刻只有一个实例
- **自动回复:** 评论推送的出口再加一道去重。无论上游挂了几个监听器实例，
  界面和自动回复链路都只会收到一条（订单消息同样受益）
- **自动回复:** 抖音 / 巨量百应的评论监听在新建监听器前先卸掉上一个，作为二次兜底
- **自动回复:** 罗盘监听（CompassListener）停止时清理更彻底，重复停止不会误关页面

## v1.6.15

### 🐞 Bug Fixes（开价话术监听「静默失效」事故修复）

- **开价话术:** 修复监听脚本丢失后软件毫无感知的问题。监听是一次性注入页面的脚本，
  页面重载 / 卡死就静默消失，但界面仍显示「运行中」，点开价完全没反应。
  现在脚本带心跳，主进程每 30 秒检查一次，失效会自动重新注入（自愈）
- **开价话术:** 页面重载（load 事件）时自动重新注入监听，不用等下一次健康检查
- **开价话术:** 连续两次检查都失效且自愈失败时，侧边栏 / 一键开启亮**红点**提示「监听已失效」，
  不再假装运行中；自愈成功会自动恢复绿点
- **开价话术:** 发送锁加 2 分钟兜底。上一次发送若因页面卡住没结束，会导致之后点开价永远不触发
- **开价话术:** 修复「停用自身检测」勾选后**不生效**的问题——策略函数读的是旧的 ref 快照（须读最新 store）

### 🚀 Features

- **开价话术:** 联动卡片内显示触发源的开价监听状态（监听中 / 未开启 / 失败原因），并可直接开启 / 停止，
  不用再切到「开价话术」页顶部（触发源没开监听 = 整条联动都不会跑）
- **开价话术:** 「跟随」「停用自身检测」开关变动即刻生效，不再要等下次重新开关联动

## v1.6.14

### 🚀 Features

- **开价话术:** 开启失败时侧边栏与首页「一键开启」显示**红点**（悬浮可见失败原因），不再和「未运行」一样毫无提示
- **开价话术:** 运行状态改为按账号独立保存。切换账号时不再互相覆盖，
  修掉了「抖音监听正在跑但绿点不亮 / 别的平台反而亮着绿点」的问题

### 🐞 Bug Fixes

- **开价话术:** 状态校正提到 App 层常驻，切换账号、重连后都会回查主进程真实状态
  （原来只挂在「开价话术」页，切走再回来才会更新）
- **开价话术:** 主进程开启监听失败时会复位运行标记，避免失败后回查又把红点刷成绿点
- **开价话术:** 联动停用某平台自身检测时，同步清掉该账号的绿点
- **一键开启:** 一键开启 / 连接后自动开启按平台过滤不支持的功能。
  原来在快手 / 小红书上也会去启动「开价监听」，必然失败还白亮红点
- **一键开启:** 各功能支持的平台列表收敛到 `useQuickStart.ts` 单一来源（页面展示、一键开启、自动开启共用）
- **开价话术:** 首页「一键停止」不再误清其他账号的开价状态

## v1.6.13

### 🐞 Bug Fixes

- **开价话术:** 修复触发源被当成跟随平台、导致自身开价监听被停掉的问题。
  表现为开启联动后触发源（如抖音）点击开价完全不执行，只有「全部平台立即开价」手动按钮能发
  （原因：触发源同时残留在跟随目标里，`disableSelfWatch` 策略把它自己的监听停了）
- **开价话术:** 切换触发源时会把它从跟随目标中移除，避免重复设置时留下脏数据

## v1.6.12

### 🚀 Features

- **开价话术:** 「开价话术」入口对所有能发言的平台开放（快手 / 小红书 / 淘宝等），不再只限抖音 / 巨量百应 / 视频号
- **开价话术:** 没有开价检测能力的平台，页面会说明「话术由跨平台联动触发发送」，并禁用「开始任务」按钮（附原因提示）
- **开价话术:** 首页「一键开启」在不支持自动检测开价的平台上也会显示「开价话术」项，禁用并标注「由跨平台联动触发，无需启动」
- **能力配置:** 平台能力（开价检测 / 发送）与平台中文名统一收敛到 `src/abilities.ts`，避免多处硬编码平台列表

## v1.6.11

### 🚀 Features

- **开价话术:** 跨平台联动卡片内新增每个平台的「开价话术」编辑栏，可直接填写各平台自己的话术，无需切换账号
- **开价话术:** 已勾选跟随但未填话术的平台会提前提示，避免联动时被静默跳过

## v1.6.10

### 🚀 Features

- **开价话术:** 新增跨平台开价联动。触发源（默认巨量百应）检测到开价后，自动带动其他平台发送各自配置的开价话术
- **开价话术:** 联动支持手动按钮「全部平台立即开价」，可强制让所有跟随平台同时开价
- **开价话术:** 跟随平台可按账号单独开关；自身能检测开价的平台（抖音小店 / 视频号 / 巨量百应）可单独停用自身检测，避免重复发送
- **开价话术:** 联动按账号设置发送冷却（默认 30 秒），防止重复下发

## v1.6.9

### 🐞 Bug Fixes

- **自动回复:** 修复一条评论被重复识别成多条的问题（评论接口返回快照而非增量，新增去重器）

## v1.6.3

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.6.1...v1.6.3)

### 🐞 Bug Fixes

- **抖音小店:** 修复抖音小店中控台无法连接的问题 #320 ([#320](https://github.com/wenyan111/livedeck/issues/320))
- **抖音小店:** 修复抖店连接后功能无法正常使用的问题，#322 ([#322](https://github.com/wenyan111/livedeck/issues/322))

## v1.6.2

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.6.1...v1.6.2)

### 🐞 Bug Fixes

- **抖音小店:** 修复抖音小店中控台无法连接的问题 #320 ([#320](https://github.com/wenyan111/livedeck/issues/320))

## v1.6.1

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.6.0...v1.6.1)

### 🚀 Features

- 模型列表更新 DeepSeek-V4，（deepseek-chat 和 deepseek-reasoner 即将弃用）
- 将 AI 提供商的模型列表更新转移到线上 ([5e5ecf1](https://github.com/wenyan111/livedeck/commit/5e5ecf1))

## v1.6.0

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.24...v1.6.0)

### 🚀 Features

- **自动发言:** 增加解除字数限制的开关 ([#301](https://github.com/wenyan111/livedeck/pull/301))
- **自动弹窗:** 新增自动弹窗的单品循环功能（感谢 [@zuowangyan](https://github.com/zuowangyan)）
- **抖店/百应:** 增加发红包功能（感谢 [@zuowangyan](https://github.com/zuowangyan)）

## v1.5.24

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.23...v1.5.24)

### 🚀 Features

- 添加快手小店的自动回复功能 ([a0bfcca](https://github.com/wenyan111/livedeck/commit/a0bfcca))

## v1.5.23

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.22...v1.5.23)

### 🚀 Features

- 分离AI对话和自动回复的AI配置 ([2ec6cc2](https://github.com/wenyan111/livedeck/commit/2ec6cc2))
- 添加无效数据的清理功能 ([6f0e90b](https://github.com/wenyan111/livedeck/commit/6f0e90b))

### 🐞 Bug Fixes

- 修复在自动发言页面切换账号时对应的评论内容无法更新的问题 ([ad67174](https://github.com/wenyan111/livedeck/commit/ad67174))
- **小红书:** 修复小红书无法发送评论的问题 #283 ([#283](https://github.com/wenyan111/livedeck/issues/283))

## v1.5.22

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.21...v1.5.22)

### 🐞 Bug Fixes

- 修复设置页面外部链接无法打开的问题 ([0a176c7](https://github.com/wenyan111/livedeck/commit/0a176c7))

## v1.5.21

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.20...v1.5.21)

### 🚀 Features

- **淘宝:** 新增自动回复功能（仅简单的评论回复） ([450dba1](https://github.com/wenyan111/livedeck/commit/450dba1))

### 🐞 Bug Fixes

- 修正自动弹窗任务中注册快捷键的拼写错误 ([6e48bae](https://github.com/wenyan111/livedeck/commit/6e48bae))
- 修复目录不存在时截屏报错的问题 ([68abdb2](https://github.com/wenyan111/livedeck/commit/68abdb2))
- **淘宝:** 修复淘宝（企业店铺）自动弹窗时找不到商品ID的问题 ([ac10b8b](https://github.com/wenyan111/livedeck/commit/ac10b8b))
- 修复淘宝评论监听的昵称显示问题 ([2b6550a](https://github.com/wenyan111/livedeck/commit/2b6550a))

## v1.5.20

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.19...v1.5.20)

### 🐞 Bug Fixes

- **淘宝**: 修复淘宝初次登录时无法连接中控台的问题 ([0059158](https://github.com/wenyan111/livedeck/commit/0059158))

## v1.5.19

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.18...v1.5.19)

### 🚀 Features

- 大大减轻了应用体积（减少了约 100MB）！

### 🐞 Bug Fixes

- 修改日志的错误堆栈显示信息 ([e3aee11](https://github.com/wenyan111/livedeck/commit/e3aee11))
- **淘宝:** 修复淘宝直播找不到评论框的问题 ([5fb39c1](https://github.com/wenyan111/livedeck/commit/5fb39c1))
- **淘宝:** 修复淘宝无法获取用户名的问题 ([1ddf73e](https://github.com/wenyan111/livedeck/commit/1ddf73e))

## v1.5.18

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.17...v1.5.18)

### 🚀 Features

- **小红书:** 小红书千帆/蒲公英新增自动回复功能 ([3c0bcbc](https://github.com/wenyan111/livedeck/commit/3c0bcbc))

### 🐞 Bug Fixes

- **抖音小店:** 修改判断登录成功的方式 ([8a904c4](https://github.com/wenyan111/livedeck/commit/8a904c4))
- **ui**: 修复点击新版本弹窗通知里的外部链接无法在应用外打开的问题 ([a0fa1f8](https://github.com/wenyan111/livedeck/commit/a0fa1f8))
- 修复 MacOS 的更新问题，减小 MacOS 应用体积 ([#246](https://github.com/wenyan111/livedeck/pull/246))

## v1.5.17

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.16...v1.5.17)

### 🚀 Features

- **视频号:** 新增自动回复功能 ([954c4ec](https://github.com/wenyan111/livedeck/commit/954c4ec))
- **视频号:** 新增评论上墙功能 ([44b3a4a](https://github.com/wenyan111/livedeck/commit/44b3a4a))

### 🐞 Bug Fixes

- 修复因网络原因无法提示手动下载更新的问题 ([fa7f603](https://github.com/wenyan111/livedeck/commit/fa7f603))
- 修复部分类型错误 ([0cc922d](https://github.com/wenyan111/livedeck/commit/0cc922d))
- 修复在特定情况下某些不支持的平台能访问到自动回复页面的问题 ([f56213a](https://github.com/wenyan111/livedeck/commit/f56213a))
- **视频号:** 修复浏览器窗口过窄时视频号仍无法连接中控台的问题 ([977d194](https://github.com/wenyan111/livedeck/commit/977d194))

## v1.5.16

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.15...v1.5.16)

### 🚀 Features

- 使用日志记录 WebSocket 的错误 ([42ce04d](https://github.com/wenyan111/livedeck/commit/42ce04d))
- 在应用启动时使用日志记录相关应用信息 ([e18b83d](https://github.com/wenyan111/livedeck/commit/e18b83d))
- 优化软件更新逻辑及软件更新 UI 界面 ([02660a6](https://github.com/wenyan111/livedeck/commit/02660a6))
- 添加主进程未捕获异常和未处理拒绝的处理逻辑 ([0ef990a](https://github.com/wenyan111/livedeck/commit/0ef990a))

### 🐞 Bug Fixes

- **巨量百应:** 修复巨量百应中控台页面样式错误的问题 ([053cd53](https://github.com/wenyan111/livedeck/commit/053cd53))
- 修复评论监听和WebSocket无法正常关闭的问题 #231 ([#231](https://github.com/wenyan111/livedeck/issues/231))
- 改进错误日志记录以包含堆栈信息 ([c1ba0d3](https://github.com/wenyan111/livedeck/commit/c1ba0d3))
- 优化未捕获异常的错误处理和提示信息 ([c7d5472](https://github.com/wenyan111/livedeck/commit/c7d5472))
- 修复因意外错误导致无法正常停止任务的问题 ([d7aa0d9](https://github.com/wenyan111/livedeck/commit/d7aa0d9))
- 修复自动弹窗任务在手动停止或更新配置时无法及时中止的问题 ([dd32837](https://github.com/wenyan111/livedeck/commit/dd32837))

## v1.5.15

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.14...v1.5.15)

### 🚀 Features

- **ui:** 中控台平台选项持久化 ([80ae047](https://github.com/wenyan111/livedeck/commit/80ae047))
- **中控台:** 优化中控台的连接逻辑，加快连接速度，减少连接错误 ([18f83f5](https://github.com/wenyan111/livedeck/commit/18f83f5))

### 🐞 Bug Fixes

- **视频号:** 修复浏览器窗口过窄时无法获取用户名的问题 #226 ([#226](https://github.com/wenyan111/livedeck/issues/226))
- **ui:** 修复更新提示对话框无法通过右上角的 x 关闭的问题 ([d3ba6bb](https://github.com/wenyan111/livedeck/commit/d3ba6bb))
- **小红书:** 修复因浏览器视口调整导致小红书获取用户名失败的问题 #225 ([#225](https://github.com/wenyan111/livedeck/issues/225))

## v1.5.14

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.13...v1.5.14)

### 🐞 Bug Fixes

- **视频号:** 修复视频号重复弹窗失败的问题 #219 ([#219](https://github.com/wenyan111/livedeck/issues/219))
- 修复浏览器视口固定的问题 #219 ([#219](https://github.com/wenyan111/livedeck/issues/219))
- **小红书千帆&蒲公英:** 修复小红书千帆&蒲公英弹卡可能会失效的问题 #216 ([#216](https://github.com/wenyan111/livedeck/issues/216))

## v1.5.13

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.12...v1.5.13)

### 🚀 Features

- 新增在窗口标题中显示应用版本号 ([5aefaab](https://github.com/wenyan111/livedeck/commit/5aefaab))

### 🐞 Bug Fixes

- **千帆**: 修复小红书千帆登录无法获取用户名的问题 ([d086418](https://github.com/wenyan111/livedeck/commit/d086418))
- **抖音小店&巨量百应**: 修复找不到弹窗按钮的问题 ([48acc28](https://github.com/wenyan111/livedeck/commit/48acc28))

## v1.5.12

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.11...v1.5.12)

### 🚀 Features

- 新增小红书蒲公英平台 ([0e7bf11](https://github.com/wenyan111/livedeck/commit/0e7bf11))

### 🐞 Bug Fixes

- **小红书千帆:** 修复小红书千帆自动弹窗无效的问题 ([3ce60c5](https://github.com/wenyan111/livedeck/commit/3ce60c5))
- 修复部分类型错误以及遗留问题 ([c000776](https://github.com/wenyan111/livedeck/commit/c000776))
- 修复ipc传参缺失 accountId 的问题 ([3e7135c](https://github.com/wenyan111/livedeck/commit/3e7135c))
- 修复更新配置时计时器未重置的问题 ([12150cb](https://github.com/wenyan111/livedeck/commit/12150cb))
- 进一步补充连接中控台的功能 ([bc8f622](https://github.com/wenyan111/livedeck/commit/bc8f622))
- 优化一键发送时的日志提示内容 ([081cf3d](https://github.com/wenyan111/livedeck/commit/081cf3d))
- 修复定时任务的部分错误 ([a214d0d](https://github.com/wenyan111/livedeck/commit/a214d0d))
- 修复中控台连接中断时的部分错误 ([ae3b7d0](https://github.com/wenyan111/livedeck/commit/ae3b7d0))
- 修复无头模式登录报错的问题 ([89396de](https://github.com/wenyan111/livedeck/commit/89396de))

## v1.5.11

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.10...v1.5.11)

### 🐞 Bug Fixes

- **中控台:** 修复抖音小店&小红书打开新页面可能造成的问题 ([dc00ebb](https://github.com/wenyan111/livedeck/commit/dc00ebb))
- **中控台:** 修复巨量百应登录页面样式错误的问题 ([f184e34](https://github.com/wenyan111/livedeck/commit/f184e34))

## v1.5.10

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.9...v1.5.10)

### 🚀 Features

- **自动发言:** 优化自动发言的消息编辑界面 ([6424ef0](https://github.com/wenyan111/livedeck/commit/6424ef0))
- **自动回复:** 添加关键字回复的批量编辑功能 ([7a27d9c](https://github.com/wenyan111/livedeck/commit/7a27d9c))
- **自动发言&自动回复:** 支持在文本中使用形如 {选项A/选项B/选项C} 的变量 ([499d973](https://github.com/wenyan111/livedeck/commit/499d973))
- **中控台:** 添加无头模式开关 ([94587c3](https://github.com/wenyan111/livedeck/commit/94587c3))

### 🐞 Bug Fixes

- 修复抖音小店登录页面样式混乱的问题, fix #158 ([#158](https://github.com/wenyan111/livedeck/issues/158))

## v1.5.9

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.8...v1.5.9)

### 🐞 Bug Fixes

- 修复登录控制台成功以后页面状态更新问题, fix #154 ([#154](https://github.com/wenyan111/livedeck/issues/154))

## v1.5.8

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.7...v1.5.8)

### 🚀 Features

- 新增对淘宝直播平台的支持 ([30a7623](https://github.com/wenyan111/livedeck/commit/30a7623))
- **ui:** 添加连接到淘宝中控台时的提示 ([9ad7645](https://github.com/wenyan111/livedeck/commit/9ad7645))
- **中控台:** 连接中控台失败时自动关闭浏览器 ([996181f](https://github.com/wenyan111/livedeck/commit/996181f))

### 🐞 Bug Fixes

- **中控台:** 修复未直播状态下登录淘宝平台后错误提示异常问题 ([8f89ed2](https://github.com/wenyan111/livedeck/commit/8f89ed2))
- **中控台:** 优化登录逻辑，只要登录成功就保存登录状态 ([f888042](https://github.com/wenyan111/livedeck/commit/f888042))
- 修复账号管理的部分问题 ([887fa19](https://github.com/wenyan111/livedeck/commit/887fa19))
- 优化删除账号的逻辑 ([991a77f](https://github.com/wenyan111/livedeck/commit/991a77f))
- **ui:** 修复在中控台连接中切换到其它页面后连接状态失效的问题 ([75a254e](https://github.com/wenyan111/livedeck/commit/75a254e))
- 修复中控台连接失败后自动断开连接有延时的问题 ([01813fc](https://github.com/wenyan111/livedeck/commit/01813fc))

## v1.5.7

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.6...v1.5.7)

### 🚀 Features

- **ui:** API Key 输入栏添加隐藏/显示功能 ([66269aa](https://github.com/wenyan111/livedeck/commit/66269aa))

### 🐞 Bug Fixes

- **ui:** 修复火山引擎配置中可能会造成歧义的信息 ([10f65f3](https://github.com/wenyan111/livedeck/commit/10f65f3))
- **ai:** 修复 API Key 测试连接的部分问题 ([47a147a](https://github.com/wenyan111/livedeck/commit/47a147a))
- **中控台:** 修复视频号无法登录的问题 fix #149 ([#149](https://github.com/wenyan111/livedeck/issues/149))

## v1.5.6

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.5...v1.5.6)

### 🚀 Features

- **自动回复:** 添加 WebSocket 服务支持 ([46509f0](https://github.com/wenyan111/livedeck/commit/46509f0))

### 🐞 Bug Fixes

- **自动发言:** 修复小红书平台无法正常发送评论的问题 ([6bb4b71](https://github.com/wenyan111/livedeck/commit/6bb4b71))
- **中控台:** 增加小红书连接中控台的容错 ([932640f](https://github.com/wenyan111/livedeck/commit/932640f))
- **中控台:** 优化连接中控台时的提示内容 ([e5f226f](https://github.com/wenyan111/livedeck/commit/e5f226f))

## v1.5.5

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.4...v1.5.5)

### 🚀 Features

- **自动回复:** 添加了过滤器，可以设置满足过滤器条件时的回复信息 ([#130](https://github.com/wenyan111/livedeck/pull/130))

### 🐞 Bug Fixes

- **自动回复:** 修复了自动回复的设置在不同账号间切换导致的异常问题

## v1.5.4

[compare changes](https://github.com/wenyan111/livedeck/compare/v1.5.3...v1.5.4)

### 🚀 Features

- 新增快手小店登录 ([fb7d842](https://github.com/wenyan111/livedeck/commit/fb7d842))
- 新增快手小店的自动弹窗和自动发言 ([4bed9d7](https://github.com/wenyan111/livedeck/commit/4bed9d7))
- **自动回复:** 添加新设置-当订单已支付时才自动回复, fix #118 ([#118](https://github.com/wenyan111/livedeck/issues/118))
- **更新器:** 显示新版本的更新内容 #31 ([#31](https://github.com/wenyan111/livedeck/issues/31))

### 🐞 Bug Fixes

- 修复部分错误无法被正确捕捉的问题 ([c08c1e0](https://github.com/wenyan111/livedeck/commit/c08c1e0))
- **自动发言:** 降低随机空格中空格出现的概率，随机发送时不和上一条重复, fix #120 ([#120](https://github.com/wenyan111/livedeck/issues/120))

