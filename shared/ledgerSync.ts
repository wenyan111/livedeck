/**
 * 「实时同步到本机表格」的配置。
 *
 * 用户 2026-11-05 需求：总表里的数据要能实时写进电脑上的一个表格文件，
 * 不用每次点「导出整表」再自己挪来挪去。
 */
export interface LedgerSyncConfig {
  /** 是否开启实时同步 */
  enabled: boolean
  /** 目标文件的绝对路径（.xlsx） */
  filePath: string
}

export const DEFAULT_LEDGER_SYNC: LedgerSyncConfig = {
  enabled: false,
  filePath: '',
}
