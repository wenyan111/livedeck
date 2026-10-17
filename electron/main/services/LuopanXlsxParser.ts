/**
 * 罗盘导出 xlsx 解析器（原生 TS，替代分享包 罗盘自动填表.py 的 parse_xlsx + build_fields）。
 *
 * 只做 L1：罗盘导出 xlsx -> 飞书列值。不碰浏览器 / Chrome CDP。
 * 解析出的 RawLuopanData 交给 shared/reportColumns.buildReportFields 做口径换算，
 * 解析层与口径层分离，便于单元测试。
 */
import ExcelJS from 'exceljs'
import { buildReportFields, type RawLuopanData } from 'shared/reportColumns'

const SHEET_BASIC = '基本信息'
const SHEET_FUNNEL = '流量&转化-转化漏斗'
const SHEET_INTER = '互动&人群&售后'
const SHEET_CHANNEL = '流量分析-渠道分析'
const SHEET_GOODS = '商品'

/** 两行 kv 表（表头在第 1 行，值在第 2 行） */
function kvSheet(ws: ExcelJS.Worksheet | undefined): Record<string, unknown> {
  const map: Record<string, unknown> = {}
  if (!ws) return map
  const headerRow = ws.getRow(1)
  const valueRow = ws.getRow(2)
  headerRow.eachCell((cell, col) => {
    const key = String(cell.value ?? '').trim()
    if (!key) return
    map[key] = valueRow.getCell(col).value
  })
  return map
}

/** 渠道分析：按「渠道名称」行聚合 */
function channelSheet(ws: ExcelJS.Worksheet | undefined): Record<string, Record<string, unknown>> {
  const ch: Record<string, Record<string, unknown>> = {}
  if (!ws) return ch
  const headerRow = ws.getRow(1)
  const headers: string[] = []
  headerRow.eachCell((cell, col) => {
    headers[col] = String(cell.value ?? '').trim()
  })
  for (let r = 2; r <= ws.rowCount; r++) {
    const name = String(ws.getRow(r).getCell(1).value ?? '').trim()
    if (!name) continue
    const row: Record<string, unknown> = {}
    for (let c = 1; c <= headers.length; c++) {
      const h = headers[c]
      if (h) row[h] = ws.getRow(r).getCell(c).value
    }
    ch[name] = row
  }
  return ch
}

/** 商品：取成交金额 > 0 的行，按 GMV 降序。
 *  先定位表头行（首列为「商品名称」），再读其后的数据行，兼容前两行是空隔行的真实导出。 */
function goodsSheet(ws: ExcelJS.Worksheet | undefined): Array<{ name: string; gmv: number }> {
  const goods: Array<{ name: string; gmv: number }> = []
  if (!ws) return goods
  // 定位表头行
  let headerRowIdx = 0
  for (let r = 1; r <= Math.min(ws.rowCount, 12); r++) {
    if (String(ws.getRow(r).getCell(1).value ?? '').trim() === '商品名称') {
      headerRowIdx = r
      break
    }
  }
  if (!headerRowIdx) return goods
  const headerRow = ws.getRow(headerRowIdx)
  const headers: string[] = []
  headerRow.eachCell((cell, col) => {
    headers[col] = String(cell.value ?? '').trim()
  })
  const idx = (h: string) => headers.indexOf(h)
  const nameCol = idx('商品名称')
  const gmvCol = idx('成交金额')
  if (nameCol < 0 || gmvCol < 0) return goods
  for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
    // 表头索引为 1-based（headers[col]，col 来自 eachCell 的 1-based 列号），直接按该列号取，勿再 +1
    const name = String(ws.getRow(r).getCell(nameCol).value ?? '').trim()
    if (!name || name === '商品名称') continue
    const gmvRaw = ws.getRow(r).getCell(gmvCol).value
    const gmv =
      typeof gmvRaw === 'number'
        ? gmvRaw
        : Number.parseFloat(String(gmvRaw ?? '').replace(/[^\d.]/g, ''))
    if (name && gmv > 0) goods.push({ name, gmv })
  }
  goods.sort((a, b) => b.gmv - a.gmv)
  return goods
}

function extractRaw(wb: ExcelJS.Workbook): RawLuopanData {
  return {
    base: kvSheet(wb.getWorksheet(SHEET_BASIC)),
    funnel: kvSheet(wb.getWorksheet(SHEET_FUNNEL)),
    inter: kvSheet(wb.getWorksheet(SHEET_INTER)),
    channels: channelSheet(wb.getWorksheet(SHEET_CHANNEL)),
    goods: goodsSheet(wb.getWorksheet(SHEET_GOODS)),
  }
}

/** 从 Buffer（渲染进程传来的文件内容）解析 */
export async function parseLuopanXlsxBuffer(buffer: Buffer): Promise<Record<string, string>> {
  const wb = new ExcelJS.Workbook()
  // @types/node 新版 Buffer 为泛型，exceljs 4 的类型声明不接受；用参数类型强转规避
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0])
  return buildReportFields(extractRaw(wb))
}

/** 从文件路径解析 */
export async function parseLuopanXlsxFile(filePath: string): Promise<Record<string, string>> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  return buildReportFields(extractRaw(wb))
}

export const luopanXlsxParser = {
  parseLuopanXlsxBuffer,
  parseLuopanXlsxFile,
}
