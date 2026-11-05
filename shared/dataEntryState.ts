/** 直播日报表单的工作状态：需要持久化，避免 app 重启后用户已填数据丢失 */
export interface DataEntryRow {
  id: string
  /**
   * 归属平台：一行数据代表「某平台的某一场直播」，
   * 只使用该平台自己那套列（字段），页面上按平台分区展示。
   */
  platform: LiveControlPlatform
  values: Record<string, string>
  lowConfidence: string[]
}

export interface DataEntrySavedState {
  rows: DataEntryRow[]
  activeRowId: string
}
