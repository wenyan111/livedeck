import { createHashRouter, Navigate } from 'react-router'
import AIChat from '@/pages/AIChat'
import AutoMessage from '@/pages/AutoMessage'
import AutoPopUp from '@/pages/AutoPopUp'
import AutoReply from '@/pages/AutoReply'
import AutoReplySettings from '@/pages/AutoReply/AutoReplySettings'
import AIPage from '@/pages/AutoReply/AutoReplySettings/pages/AIPage'
import FilterPage from '@/pages/AutoReply/AutoReplySettings/pages/FilterPage'
import KeywordPage from '@/pages/AutoReply/AutoReplySettings/pages/KeywordPage'
import MentionPage from '@/pages/AutoReply/AutoReplySettings/pages/MentionPage'
import PlatformPage from '@/pages/AutoReply/AutoReplySettings/pages/PlatformPage'
import ConfigTransfer from '@/pages/ConfigTransferPage'
import DataEntry from '@/pages/DataEntry'
import LiveControl from '@/pages/LiveControl'
import LiveControlManage from '@/pages/LiveControlManage'
import OpenPriceScript from '@/pages/OpenPriceScript'
import RedPacket from '@/pages/RedPacket'
import Settings from '@/pages/SettingsPage'
import App from '../App'

export const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        path: '/',
        element: <LiveControl />,
      },
      {
        path: '/live-control-manage',
        element: <LiveControlManage />,
      },
      {
        path: '/auto-message',
        element: <AutoMessage />,
      },
      {
        path: '/open-price-script',
        element: <OpenPriceScript />,
      },
      {
        path: '/auto-popup',
        element: <AutoPopUp />,
      },
      {
        path: '/settings',
        element: <Settings />,
      },
      {
        path: '/config-transfer',
        element: <ConfigTransfer />,
      },
      {
        path: '/ai-chat',
        element: <AIChat />,
      },
      {
        path: 'auto-reply',
        element: <AutoReply />,
      },
      {
        path: '/auto-reply/settings',
        element: <AutoReplySettings />,
        // 每个分组是独立页面：一页只做一件事，不再把 9 块内容堆在一起
        children: [
          { index: true, element: <Navigate to="keyword" replace /> },
          { path: 'keyword', element: <KeywordPage /> },
          { path: 'ai', element: <AIPage /> },
          { path: 'filter', element: <FilterPage /> },
          { path: 'mention', element: <MentionPage /> },
          { path: 'platform', element: <PlatformPage /> },
        ],
      },
      {
        path: '/red-packet',
        element: <RedPacket />,
      },
      {
        path: '/data-entry',
        element: <DataEntry />,
      },
    ],
  },
])
