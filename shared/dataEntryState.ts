/** 直播日报表单的工作状态：需要持久化，避免 app 重启后用户已填数据丢失 */
export interface DataEntryRow {
  id: string
  values: Record<string, string>
  lowConfidence: string[]
}

export interface DataEntrySavedState {
  rows: DataEntryRow[]
  activeRowId: string
}
