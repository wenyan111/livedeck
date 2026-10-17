/**
 * 验证脚本：用脱敏样例跑通「罗盘 xlsx → buildReportFields」，并与按分享包公式手算的期望值逐项比对。
 * 仅用于开发联调，不属于 app 运行时代码。
 */
import { parseLuopanXlsxFile } from '../electron/main/services/LuopanXlsxParser'
import { MANUAL_COLUMN_KEYS, REPORT_COLUMNS, validateReportFields } from '../shared/reportColumns'

const SAMPLE = '/Users/a1/.workbuddy/skills/live-data-autofill/samples/罗盘导出样例_脱敏.xlsx'

// 期望（按分享包 build_fields 公式手算，单位已落库为字符串）
const EXPECT: Record<string, string> = {
  weekLabel: '周六',
  anchorName: '示例直播间',
  date: '2026-10-10 00:00:00',
  session: '晚场',
  time: '20:54',
  mainProduct: '示例主品-EMS腰带', // 样例 row5 主品（GMV 149500，最高）
  durationHour: '2小时49分',
  viewersWan: '12.5',
  roomViewsWan: '',
  exposeUsersWan: '46',
  exposeTimesWan: '62.5',
  exposeViewRate: '0.2',
  avgOnline: '950',
  peakOnline: '1800',
  avgStayDuration: '21秒',
  fansRatio: '',
  newFans: '740',
  fanConvertRate: '0.00592',
  fansGroupNew: '',
  joinGroupRate: '',
  comments: '',
  avgCommentsPerMin: '',
  likesWan: '',
  payGmv: '150000',
  payUsers: '600',
  viewDealRate: '0.48%',
  gpm: '1200',
  uvValue: '1.2',
  liveRecommendGpm: '601.85',
  videoRecommendGpm: '14186.05',
  productExposeClickRate: '0.061765',
  productClickDealRate: '0.142857',
  investAmount: '8600',
  roi: '17.4419',
  payChannelRatio: '0.136',
  targetRoi: '',
  videoDealRatio: '0.406667',
  liveRecommend: '0.864',
  videoRecommend: '0.0344',
  searchRatio: '0.0072',
  followRatio: '0.006',
  otherRatio: '',
  viewInteractRate: '0.00784',
  refundAmount: '22000',
  preShipRefundRate: '',
  peerMedianThousand: '',
  peerMedianExposeTimes: '',
  peerMedianExposeViewRate: '',
  productExposeCount: '68000',
  productClickCount: '4200',
  clothingColor: '',
  age50PlusRatio: '',
  maleFansRatio: '',
  viewCoreCity: '',
  dealCoreCity: '',
  oldFans: '',
}

async function main() {
  const fields = await parseLuopanXlsxFile(SAMPLE)

  // 全部字段输出
  console.log('==== 解析产出（仅非 manual 列应非空）====')
  let manualFilled = 0
  for (const col of REPORT_COLUMNS) {
    const v = fields[col.key] ?? ''
    const isManual = MANUAL_COLUMN_KEYS.includes(col.key)
    if (isManual && v !== '') manualFilled++
    console.log(`  ${col.key.padEnd(24)} = ${JSON.stringify(v)}  ${isManual ? '[manual]' : ''}`)
  }
  console.log(`\n⚠️ manual 列被误填：${manualFilled}`)

  // 比对期望值
  console.log('\n==== 与期望值比对 ====')
  let pass = 0
  let fail = 0
  const fails: string[] = []
  for (const col of REPORT_COLUMNS) {
    const got = fields[col.key] ?? ''
    const exp = EXPECT[col.key] ?? ''
    if (got === exp) {
      pass++
    } else {
      fail++
      fails.push(`  ${col.key}: got=${JSON.stringify(got)} exp=${JSON.stringify(exp)}`)
    }
  }
  console.log(`通过 ${pass} | 失败 ${fail}`)
  if (fails.length) {
    console.log('失败项：')
    fails.forEach(f => {
      console.log(f)
    })
  }

  // 合理性校验
  const bad = validateReportFields(fields)
  console.log(`\n==== 合理性校验：${bad.length ? '未通过' : '全部通过'} ====`)
  bad.forEach(b => {
    console.log(`  ${b}`)
  })

  console.log(`\n样本文件：${SAMPLE}`)
  process.exit(fail === 0 && bad.length === 0 && manualFilled === 0 ? 0 : 1)
}

main().catch(e => {
  console.error(e)
  process.exit(2)
})
