/**
 * 更新源 / 数据源仓库配置（接管原作者自动更新后，只改这里）。
 *
 * - owner：你的 GitHub 用户名
 * - repo：你的仓库名
 * - branch：默认 main（UpdateManager 会读该分支的 package.json 版本号与 CHANGELOG.md 来判断是否有更新）
 *
 * 二进制更新（UpdateManager）与平台凭证配置（ProviderService 的 providers.json）都从这里取仓库信息，
 * 页脚「GitHub / Issues」链接也用这里拼接，改一处即可全局生效。
 *
 * ⚠️ 不要改 package.json 的 name 与 electron-builder.json 的 appId：
 * 它们是与已安装用户绑定的身份，改了会导致现有安装断更或变成两个 App。
 * 想换界面上看到的名字，用 electron-builder.json 的 productName。
 */
export const UPDATE_SOURCE = {
  owner: 'wenyan111',
  repo: 'livedeck',
  branch: 'main',
} as const
