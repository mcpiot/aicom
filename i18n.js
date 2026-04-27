const i18n = {
  zh: {
    appTitle: 'AI串口调试工具',
    // Menu
    menuPortList: '串口列表',
    menuRefresh: '刷新',
    menuPortConfig: '串口配置',
    menuCommandGroup: '指令组发送',
    menuProtocol: '协议解析',
    menuTcpUdp: 'TCP/UDP转发',
    menuAiConfig: 'AI服务配置',
    menuHelp: '帮助',
    menuShop: '买配件',
    menuThemeTitle: '切换界面风格',
    menuLangTitle: '切换语言',
    // Toolbar
    btnClear: '清除窗口',
    btnSendFile: '发送文件',
    chkHexDisplay: 'HEX显示',
    chkSaveData: '保存数据到文件',
    chkTimestamp: '加时间戳',
    chkAlwaysTop: '最前',
    // Welcome
    welcome: '欢迎使用串口调试工具',
    // Multi-string panel
    panelTitle: '多指令组发送',
    chkDragWiden: '拖动加宽',
    chkLoopSend: '循环发送',
    btnMultiHelp: '多条帮助',
    btnImportIni: '导入ini',
    thHexString: 'HEX 字符串(双击注释)',
    thSend: '点击发送',
    thOrder: '顺序',
    thAction: '操作',
    btnAddRow: '+ 添加',
    btnSendAll: '发送全部',
    btnStop: '停止',
    btnPanelHide: '隐藏多条字符串发送面板',
    btnPanelShow: '显示多条字符串发送面板',
    rowSend: '发送',
    rowDelete: '删除',
    rowPlaceholder: '输入HEX字符串或文本',
    // Bottom controls
    labelPort: '端口号:',
    optSelectPort: '请选择端口',
    btnRefreshPort: '刷新',
    btnConnect: '连接',
    btnDisconnect: '断开',
    labelBaudrate: '波特率:',
    labelDatabits: '数据位:',
    labelStopbits: '停止位:',
    labelParity: '校验位:',
    chkHexSend: 'HEX发送',
    chkTimedSend: '定时发送:',
    msPerTime: 'ms/次',
    chkAddCrlf: '加回车换行',
    chkAddTimestamp: '加时间戳和分包显示,超时时间:',
    labelMs: 'ms',
    btnClearSend: '清空发送区',
    phSend: '输入要发送的数据...',
    btnSend: '发送',
    // Status bar
    statusSendCount: '发送数据计数:',
    statusReceiveCount: '接收数据计数:',
    // Status texts
    statusReady: '就绪',
    statusNotRunning: '未运行',
    statusRunning: '运行中',
    statusConnected: '已连接',
    statusNotConnected: '未连接',
    // Port config modal
    modalPortConfigTitle: '串口配置',
    // AI config modal
    modalAiConfigTitle: 'AI服务配置',
    aiModeBuiltin: 'mcpiot.net内建服务器（默认）',
    aiModeLocal: '本地模型提供方配置',
    labelApiUrl: 'API地址:',
    labelApiKey: 'API密钥:',
    labelModelName: '模型名称:',
    phApiUrl: 'http://localhost:8000/v1/chat/completions',
    phApiKey: 'sk-...（无需认证可留空）',
    phModelName: '例如: qwen2.5, llama3',
    // Protocol modal
    modalProtocolTitle: '协议帧解析器',
    protocolEnable: '启用实时帧解析',
    labelProtocolName: '规则名称:',
    labelProtocolHeader: '帧头 (HEX):',
    labelProtocolMode: '帧判断方式:',
    optFixed: '固定长度',
    optLength: '长度字段',
    optDelimiter: '帧尾标识',
    labelFrameLen: '帧总长度 (字节):',
    labelLenOffset: '长度字节偏移:',
    labelFieldSize: '字段大小:',
    opt1Byte: '1 字节',
    opt2ByteLE: '2 字节LE',
    labelLenScope: '长度含义:',
    optDataOnly: '仅数据段',
    optFromLen: '从长度字段后',
    optFullFrame: '整帧',
    labelProtocolFooter: '帧尾 (HEX):',
    labelProtocolFields: '字段定义 (每行: 名称,偏移,长度,类型):',
    protocolFieldsHint: '类型: hex | uint8 | uint16le | uint16be | ascii  |  偏移/长度为 -1 时表示从末尾/剩余字节',
    btnClearBuf: '清空解析缓冲',
    btnProtocolSave: '保存并应用',
    phProtocolName: '如: 自定义协议',
    phProtocolHeader: '如: AA 55',
    phProtocolFooter: '如: 0D 0A',
    // TCP/UDP modal
    modalTcpUdpTitle: 'TCP / UDP 转发',
    tcpServerTitle: 'TCP 服务器（接受外部连接）',
    labelListenPort: '监听端口:',
    btnStart: '启动',
    btnTcpStop: '停止',
    tcpClientTitle: 'TCP 客户端（主动连接远端）',
    labelTargetAddr: '目标地址:',
    labelPort2: '端口:',
    btnTcpConnect: '连接',
    btnTcpDisconnect: '断开',
    udpTitle: 'UDP 转发',
    labelLocalPort: '本地端口:',
    labelTarget: '目标:',
    // Common modal buttons
    btnConfirm: '确认',
    btnCancel: '取消',
    btnSave: '保存',
    btnClose: '关闭',
    // Alert messages
    alertStartFail: '启动失败: ',
    alertConnFail: '连接失败: ',
    alertEnterAddr: '请输入目标地址',
    // Error messages (passed to showError)
    errGetPorts: '获取串口列表失败: ',
    errSelectPort: '请选择串口',
    errConnect: '连接失败: ',
    errDisconnect: '断开连接失败: ',
    errNotConnected: '串口未连接',
    errSend: '发送失败: ',
    errNoData: '没有可发送的数据',
    errReadFile: '读取文件失败: ',
    errSendFile: '发送文件失败: ',
    errSaveData: '保存数据到文件失败: ',
    errSaveFile: '保存文件失败: ',
    errSaveProtocol: '保存失败: ',
    // Dynamic status messages
    statusConfigUpdatedReconnect: '配置已更新，请重新连接串口以应用新配置',
    statusConfigUpdated: '配置已更新',
    statusProtocolBufCleared: '协议解析缓冲已清空',
    statusAddedFromAI: '已从AI回复添加到发送框',
    statusSaveStopped: '已停止保存数据到文件',
    statusCopied: '已复制到剪贴板',
    statusCut: '已剪切到剪贴板',
    statusPasted: '已粘贴',
    statusPasteFailed: '粘贴失败',
    statusDeleted: '已删除',
    statusSelectAll: '已全选',
    statusSentToAI: '已发送到AI输入框',
    statusCopyFailed: '复制失败',
    statusLoadingPorts: '正在获取串口列表...',
    statusNoPorts: '未检测到串口设备',
    statusDisconnected: '已断开连接',
    statusDataSent: '数据已发送',
    statusSendStopped: '已停止发送',
    statusReadingFile: '正在读取文件...',
    statusFileSent: '文件已发送',
    statusParamsSaved: '参数已保存',
    statusError: '错误: ',
  },
  en: {
    appTitle: 'AI UART Debug Tool',
    // Menu
    menuPortList: 'Port List',
    menuRefresh: 'Refresh',
    menuPortConfig: 'Port Config',
    menuCommandGroup: 'Command Group',
    menuProtocol: 'Protocol',
    menuTcpUdp: 'TCP/UDP',
    menuAiConfig: 'AI Config',
    menuHelp: 'Help',
    menuShop: 'Buy Parts',
    menuThemeTitle: 'Toggle Theme',
    menuLangTitle: 'Toggle Language',
    // Toolbar
    btnClear: 'Clear',
    btnSendFile: 'Send File',
    chkHexDisplay: 'HEX Display',
    chkSaveData: 'Save to File',
    chkTimestamp: 'Timestamp',
    chkAlwaysTop: 'Top',
    // Welcome
    welcome: 'Welcome to UART Debug Tool',
    // Multi-string panel
    panelTitle: 'Multi-Command Send',
    chkDragWiden: 'Drag to Widen',
    chkLoopSend: 'Loop Send',
    btnMultiHelp: 'Help',
    btnImportIni: 'Import ini',
    thHexString: 'HEX String (dbl-click to comment)',
    thSend: 'Send',
    thOrder: 'Order',
    thAction: 'Action',
    btnAddRow: '+ Add',
    btnSendAll: 'Send All',
    btnStop: 'Stop',
    btnPanelHide: 'Hide Panel',
    btnPanelShow: 'Show Panel',
    rowSend: 'Send',
    rowDelete: 'Delete',
    rowPlaceholder: 'Enter HEX or text',
    // Bottom controls
    labelPort: 'Port:',
    optSelectPort: 'Select port',
    btnRefreshPort: 'Refresh',
    btnConnect: 'Connect',
    btnDisconnect: 'Disconnect',
    labelBaudrate: 'Baud Rate:',
    labelDatabits: 'Data Bits:',
    labelStopbits: 'Stop Bits:',
    labelParity: 'Parity:',
    chkHexSend: 'HEX Send',
    chkTimedSend: 'Timed Send:',
    msPerTime: 'ms/time',
    chkAddCrlf: 'Add CR+LF',
    chkAddTimestamp: 'Timestamp & packet split, timeout:',
    labelMs: 'ms',
    btnClearSend: 'Clear Input',
    phSend: 'Enter data to send...',
    btnSend: 'Send',
    // Status bar
    statusSendCount: 'TX:',
    statusReceiveCount: 'RX:',
    // Status texts
    statusReady: 'Ready',
    statusNotRunning: 'Not running',
    statusRunning: 'Running',
    statusConnected: 'Connected',
    statusNotConnected: 'Not connected',
    // Port config modal
    modalPortConfigTitle: 'Port Configuration',
    // AI config modal
    modalAiConfigTitle: 'AI Service Config',
    aiModeBuiltin: 'mcpiot.net Built-in Server (default)',
    aiModeLocal: 'Local Model Provider',
    labelApiUrl: 'API URL:',
    labelApiKey: 'API Key:',
    labelModelName: 'Model Name:',
    phApiUrl: 'http://localhost:8000/v1/chat/completions',
    phApiKey: 'sk-... (leave blank if no auth)',
    phModelName: 'e.g.: qwen2.5, llama3',
    // Protocol modal
    modalProtocolTitle: 'Protocol Frame Parser',
    protocolEnable: 'Enable Real-time Frame Parsing',
    labelProtocolName: 'Rule Name:',
    labelProtocolHeader: 'Frame Header (HEX):',
    labelProtocolMode: 'Frame Detection:',
    optFixed: 'Fixed Length',
    optLength: 'Length Field',
    optDelimiter: 'Frame Footer',
    labelFrameLen: 'Frame Length (bytes):',
    labelLenOffset: 'Length Byte Offset:',
    labelFieldSize: 'Field Size:',
    opt1Byte: '1 Byte',
    opt2ByteLE: '2 Bytes LE',
    labelLenScope: 'Length Scope:',
    optDataOnly: 'Data Only',
    optFromLen: 'After Length Field',
    optFullFrame: 'Full Frame',
    labelProtocolFooter: 'Frame Footer (HEX):',
    labelProtocolFields: 'Field Definition (per line: name,offset,length,type):',
    protocolFieldsHint: 'Types: hex | uint8 | uint16le | uint16be | ascii  |  offset/length -1 = from end/remaining bytes',
    btnClearBuf: 'Clear Buffer',
    btnProtocolSave: 'Save & Apply',
    phProtocolName: 'e.g.: Custom Protocol',
    phProtocolHeader: 'e.g.: AA 55',
    phProtocolFooter: 'e.g.: 0D 0A',
    // TCP/UDP modal
    modalTcpUdpTitle: 'TCP / UDP Forward',
    tcpServerTitle: 'TCP Server (accept incoming)',
    labelListenPort: 'Listen Port:',
    btnStart: 'Start',
    btnTcpStop: 'Stop',
    tcpClientTitle: 'TCP Client (connect to remote)',
    labelTargetAddr: 'Target Host:',
    labelPort2: 'Port:',
    btnTcpConnect: 'Connect',
    btnTcpDisconnect: 'Disconnect',
    udpTitle: 'UDP Forward',
    labelLocalPort: 'Local Port:',
    labelTarget: 'Target:',
    // Common modal buttons
    btnConfirm: 'Confirm',
    btnCancel: 'Cancel',
    btnSave: 'Save',
    btnClose: 'Close',
    // Alert messages
    alertStartFail: 'Start failed: ',
    alertConnFail: 'Connect failed: ',
    alertEnterAddr: 'Please enter target address',
    // Error messages (passed to showError)
    errGetPorts: 'Failed to get port list: ',
    errSelectPort: 'Please select a port',
    errConnect: 'Connect failed: ',
    errDisconnect: 'Disconnect failed: ',
    errNotConnected: 'Serial port not connected',
    errSend: 'Send failed: ',
    errNoData: 'No data to send',
    errReadFile: 'Read file failed: ',
    errSendFile: 'Send file failed: ',
    errSaveData: 'Failed to save data to file: ',
    errSaveFile: 'Save file failed: ',
    errSaveProtocol: 'Save failed: ',
    // Dynamic status messages
    statusConfigUpdatedReconnect: 'Config updated, please reconnect to apply',
    statusConfigUpdated: 'Config updated',
    statusProtocolBufCleared: 'Protocol parse buffer cleared',
    statusAddedFromAI: 'Added AI reply to send box',
    statusSaveStopped: 'Stopped saving data to file',
    statusCopied: 'Copied to clipboard',
    statusCut: 'Cut to clipboard',
    statusPasted: 'Pasted',
    statusPasteFailed: 'Paste failed',
    statusDeleted: 'Deleted',
    statusSelectAll: 'All selected',
    statusSentToAI: 'Sent to AI input',
    statusCopyFailed: 'Copy failed',
    statusLoadingPorts: 'Loading port list...',
    statusNoPorts: 'No serial ports detected',
    statusDisconnected: 'Disconnected',
    statusDataSent: 'Data sent',
    statusSendStopped: 'Send stopped',
    statusReadingFile: 'Reading file...',
    statusFileSent: 'File sent',
    statusParamsSaved: 'Parameters saved',
    statusError: 'Error: ',
  }
};

let currentLang = 'zh';

function t(key) {
  return (i18n[currentLang] && i18n[currentLang][key]) || (i18n.zh[key]) || key;
}

function applyLang(lang) {
  currentLang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-ph'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  document.title = t('appTitle');
  const langIcon = document.getElementById('lang-toggle-icon');
  if (langIcon) langIcon.textContent = lang === 'zh' ? 'EN' : '中';
  // 更新端口下拉框首项（由 JS 动态生成，不含 data-i18n）
  const selectPort = document.getElementById('select-port');
  if (selectPort && selectPort.options.length > 0 && selectPort.options[0].value === '') {
    selectPort.options[0].textContent = t('optSelectPort');
  }
  // 若首项是"未检测到串口设备"（disabled）也同步
  if (selectPort && selectPort.options.length > 1 && selectPort.options[1].disabled && selectPort.options[1].value === '') {
    selectPort.options[1].textContent = t('statusNoPorts');
  }
  try { localStorage.setItem('uart-lang', lang); } catch (e) {}
  // 同步语言到 AI 助手 webview
  try {
    const wv = document.getElementById('sidebar-webview');
    if (wv) {
      try { wv.send('lang-changed', lang); } catch (e) {}
      try { wv.executeJavaScript(`window.setAILang && window.setAILang('${lang}')`); } catch (e) {}
    }
  } catch (e) {}
}

function initLang() {
  let saved;
  try { saved = localStorage.getItem('uart-lang'); } catch (e) {}
  if (!saved) {
    const sysLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
    saved = sysLang.startsWith('zh') ? 'zh' : 'en';
  }
  applyLang(saved);
  const btn = document.getElementById('menu-lang-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      applyLang(currentLang === 'zh' ? 'en' : 'zh');
    });
  }
}
