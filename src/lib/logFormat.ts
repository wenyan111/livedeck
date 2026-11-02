/** 把日志模块名规整成可读形式：`@小红书 -> 自动弹窗` → `小红书 · 自动弹窗` */
export function prettifyModule(raw: string): string {
  return raw
    .replace(/^@/, '')
    .replace(/\s*->\s*/g, ' · ')
    .trim()
}
