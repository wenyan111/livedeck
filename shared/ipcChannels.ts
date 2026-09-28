export const IPC_CHANNELS = {
  tasks: {
    liveControl: {
      connect: 'tasks:liveControl:connect',
      notifyAccountName: 'tasks:liveControl:notifyAccountName',
      disconnect: 'tasks:liveControl:disconnect',
      disconnectedEvent: 'tasks:liveControl:disconnectedEvent',
    },
    autoMessage: {
      start: 'tasks:autoMessage:start',
      stop: 'tasks:autoMessage:stop',
      stoppedEvent: 'tasks:autoMessage:stoppedEvent',
      updateConfig: 'tasks:autoMessage:updateConfig',
      sendBatchMessages: 'tasks:autoMessage:sendBatchMessages',
      startOpenPriceWatcher: 'tasks:autoMessage:startOpenPriceWatcher',
      stopOpenPriceWatcher: 'tasks:autoMessage:stopOpenPriceWatcher',
      updateOpenPriceMessages: 'tasks:autoMessage:updateOpenPriceMessages',
      getOpenPriceWatcherStatus: 'tasks:autoMessage:getOpenPriceWatcherStatus',
      openPriceWarmupTriggered: 'tasks:autoMessage:openPriceWarmupTriggered',
      /**
       * 开价监听失效：页面里的监听脚本已丢失（页面重载/卡死）且自愈失败。
       * 界面据此显示红点，避免继续假装「运行中」。
       */
      openPriceWatcherLost: 'tasks:autoMessage:openPriceWatcherLost',
      /** 开价监听恢复：脚本失效后已自动重新注入 */
      openPriceWatcherRestored: 'tasks:autoMessage:openPriceWatcherRestored',
      /** 跨平台联动：让指定账号直接发送开价话术（不启动监听） */
      sendOpenPriceMessages: 'tasks:autoMessage:sendOpenPriceMessages',
    },
    autoPopUp: {
      start: 'tasks:autoPopUp:start',
      stop: 'tasks:autoPopUp:stop',
      updateConfig: 'tasks:autoPopUp:updateConfig',
      stoppedEvent: 'tasks:autoPopUp:stoppedEvent',
      registerShortcuts: 'tasks:autoPopup:registerShortcut',
      unregisterShortcuts: 'tasks:autoPopup:unregisterShortcut',
    },
    aiChat: {
      chat: 'tasks:aiChat:chat',
      stream: 'tasks:aiChat:stream',
      error: 'tasks:aiChat:error',
      normalChat: 'tasks:aiChat:normalChat',
      testApiKey: 'tasks:aiChat:testApiKey',
    },
    autoReply: {
      startCommentListener: 'tasks:autoReply:startCommentListener',
      stopCommentListener: 'tasks:autoReply:stopCommentListener',
      listenerStopped: 'tasks:autoReply:listenerStopped',
      showComment: 'tasks:autoReply:showComment',
      startAutoReply: 'tasks:autoReply:startAutoReply',
      stopAutoReply: 'tasks:autoReply:stopAutoReply',
      replyGenerated: 'tasks:autoReply:replyGenerated',
      sendReply: 'tasks:autoReply:sendReply',
    },
    // 视频号上墙
    pinComment: 'tasks:pinComment',
    // 一键发红包
    redPacket: {
      send: 'tasks:redPacket:send',
    },
  },
  config: {
    save: 'config:save',
    load: 'config:load',
  },
  chrome: {
    getPath: 'chrome:getPath',
    setPath: 'chrome:setPath',
    selectPath: 'chrome:selectPath',
    toggleDevTools: 'chrome:toggleDevTools',
    saveState: 'chrome:saveState',
  },
  updater: {
    checkUpdate: 'updater:checkUpdate',
    updateAvailable: 'updater:updateAvailable',
    startDownload: 'updater:startDownload',
    downloadProgress: 'updater:downloadProgress',
    updateError: 'updater:updateError',
    updateDownloaded: 'updater:updateDownloaded',
    quitAndInstall: 'updater:quitAndInstall',
  },
  account: {
    switch: 'account:switch',
  },
  // 抖音直播数据大屏
  dashboard: {
    /** 拉取最新快照（立即返回缓存，必要时触发刷新） */
    getSnapshot: 'dashboard:getSnapshot',
    /** 手动刷新 */
    refresh: 'dashboard:refresh',
    /** 更新接入配置（client_key/secret 等） */
    setConfig: 'dashboard:setConfig',
    /** 读取当前接入配置 */
    getConfig: 'dashboard:getConfig',
    /** 主进程主动推送：快照已更新 */
    updated: 'dashboard:updated',
  },
  // 直播日报（视觉识别 + 本地 Excel 导出）
  dataEntry: {
    recognize: 'dataEntry:recognize',
    selectOutputPath: 'dataEntry:selectOutputPath',
    exportExcel: 'dataEntry:exportExcel',
    generateTemplate: 'dataEntry:generateTemplate',
    getColumns: 'dataEntry:getColumns',
    saveColumns: 'dataEntry:saveColumns',
    // 视觉模板校准
    calibrateTemplate: 'dataEntry:calibrateTemplate',
    getTemplate: 'dataEntry:getTemplate',
    deleteTemplate: 'dataEntry:deleteTemplate',
    // 表单数据持久化（防止 app 重启后已填数据丢失）
    getRows: 'dataEntry:getRows',
    saveRows: 'dataEntry:saveRows',
  },
  log: 'log',
  app: {
    openLogFolder: 'app:openLogFolder',
    notifyUpdate: 'app:notifyUpdate',
    openExternal: 'app:openExternal',
    getProviders: 'app:getProviders',
    providersUpdated: 'app:providersUpdated',
    writeLog: 'app:writeLog',
    setTheme: 'app:setTheme',
  },
} as const
