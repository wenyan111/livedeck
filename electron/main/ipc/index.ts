import { setupAIChatIpcHandlers } from './aichat'
import { setupAppIpcHandlers } from './app'
import { setupAutoMessageIpcHandlers } from './autoMessage'
import { setupAutoPopUpIpcHandlers } from './autoPopUp'
import { setupBrowserIpcHandlers } from './browser'
import { setupAutoReplyIpcHandlers } from './commentListener'
import { setupLiveControlIpcHandlers } from './connection'
import { setupPinCommentIpcHandler } from './pinComment'
import { setupRedPacketIpcHandlers } from './redPacket'
import { setupDouyinDashboardIpcHandlers } from './douyinDashboard'
import { setupUpdateIpcHandlers } from './update'
import { setupDataEntryIpcHandlers } from './dataEntry'

setupLiveControlIpcHandlers()
setupAIChatIpcHandlers()
setupAutoPopUpIpcHandlers()
setupAutoReplyIpcHandlers()
setupAutoMessageIpcHandlers()
setupBrowserIpcHandlers()
setupAppIpcHandlers()
setupUpdateIpcHandlers()
setupPinCommentIpcHandler()
setupRedPacketIpcHandlers()
setupDouyinDashboardIpcHandlers()
setupDataEntryIpcHandlers()
