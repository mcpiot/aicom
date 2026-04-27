const { ipcRenderer } = require('electron');

// 全局变量
let isConnected = false;
let sendCount = 0; // 发送字节数
let receiveCount = 0; // 接收字节数
let timedSendInterval = null;
let isSendingMultiStrings = false;
let multiStringQueue = [];
let currentPort = null;
let serialLogContent = ''; // 保存串口接收的日志内容
let saveDataFilePath = null; // 保存数据到文件的路径

// 协议帧解析器状态
let protocolRule = null;
let protocolEnabled = false;
let parseBuffer = []; // 原始字节累积缓冲（用于帧检测）

// ── 协议帧解析引擎 ───────────────────────────────────────────

function hexStrToBytes(hexStr) {
  const clean = hexStr.replace(/\s+/g, '');
  const result = [];
  for (let i = 0; i < clean.length - 1; i += 2) {
    result.push(parseInt(clean.substring(i, i + 2), 16));
  }
  return result;
}

function parseFrameFields(frame, rule) {
  const fields = [];
  if (!rule || !rule.fields) return fields;
  const lines = rule.fields.split('\n').map(l => l.trim()).filter(l => l);
  for (const line of lines) {
    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 3) continue;
    const [name, offsetStr, lengthStr, type = 'hex'] = parts;
    let offset = parseInt(offsetStr);
    let length = parseInt(lengthStr);
    const start = offset < 0 ? frame.length + offset : offset;
    const end = length < 0 ? frame.length : start + length;
    if (start < 0 || start >= frame.length) continue;
    const slice = frame.slice(Math.max(0, start), Math.min(end, frame.length));
    let value;
    switch ((type || 'hex').toLowerCase()) {
      case 'uint8':   value = `${slice[0]} (0x${slice[0].toString(16).toUpperCase()})`; break;
      case 'uint16le': value = slice.length >= 2 ? String((slice[1] << 8) | slice[0]) : '?'; break;
      case 'uint16be': value = slice.length >= 2 ? String((slice[0] << 8) | slice[1]) : '?'; break;
      case 'ascii':   value = slice.map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join(''); break;
      default:        value = slice.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    }
    fields.push({ name, value });
  }
  return fields;
}

function displayParsedFrame(frame, fields) {
  const hexStr = frame.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  const line = document.createElement('div');
  line.className = 'data-line protocol-frame';
  let html = `<span style="color:#7c3aed;font-weight:600;">[协议帧]</span> <span style="font-family:monospace;">${hexStr}</span>`;
  if (fields.length > 0) {
    html += '<table style="margin-top:2px;margin-left:16px;font-size:11px;border-collapse:collapse;">';
    for (const f of fields) {
      html += `<tr><td style="color:#6b7280;padding-right:8px;white-space:nowrap;">${f.name}</td><td style="font-family:monospace;color:#1d4ed8;">${f.value}</td></tr>`;
    }
    html += '</table>';
  }
  line.innerHTML = html;
  elements.displayContent.appendChild(line);
  elements.displayContent.scrollTop = elements.displayContent.scrollHeight;
}

function processRawBytes(bytesArray) {
  if (!protocolEnabled || !protocolRule || !protocolRule.header) return;

  parseBuffer = parseBuffer.concat(Array.from(bytesArray));
  if (parseBuffer.length > 65536) parseBuffer = parseBuffer.slice(-65536);

  const header = hexStrToBytes(protocolRule.header);
  if (!header.length) return;

  let i = 0;
  while (i <= parseBuffer.length - header.length) {
    // 查找帧头
    let headerAt = -1;
    for (let j = i; j <= parseBuffer.length - header.length; j++) {
      let match = true;
      for (let h = 0; h < header.length; h++) {
        if (parseBuffer[j + h] !== header[h]) { match = false; break; }
      }
      if (match) { headerAt = j; break; }
    }
    if (headerAt < 0) { i = Math.max(0, parseBuffer.length - header.length + 1); break; }
    i = headerAt;

    let frameEnd = -1;
    const mode = protocolRule.mode || 'fixed';

    if (mode === 'fixed') {
      const frameLen = parseInt(protocolRule.frameLength) || 8;
      if (i + frameLen <= parseBuffer.length) frameEnd = i + frameLen;
      else break;

    } else if (mode === 'length') {
      const lenOff = parseInt(protocolRule.lengthOffset) || 2;
      const lenSz  = parseInt(protocolRule.lengthSize) || 1;
      if (i + lenOff + lenSz > parseBuffer.length) break;
      let dataLen = lenSz === 2
        ? (parseBuffer[i + lenOff] | (parseBuffer[i + lenOff + 1] << 8))
        : parseBuffer[i + lenOff];
      const maxFrame = parseInt(protocolRule.maxFrameLen) || 512;
      if (dataLen > maxFrame) { i++; continue; }
      const scope = protocolRule.lengthScope || 'data';
      let total;
      if (scope === 'full') total = dataLen;
      else total = lenOff + lenSz + dataLen; // 'data' or 'from_length'
      if (i + total <= parseBuffer.length) frameEnd = i + total;
      else break;

    } else if (mode === 'delimiter') {
      const footer = hexStrToBytes(protocolRule.footer || '');
      if (!footer.length) { i++; continue; }
      let found = false;
      for (let j = i + header.length; j <= parseBuffer.length - footer.length; j++) {
        let fm = true;
        for (let f = 0; f < footer.length; f++) {
          if (parseBuffer[j + f] !== footer[f]) { fm = false; break; }
        }
        if (fm) { frameEnd = j + footer.length; found = true; break; }
      }
      if (!found) {
        const maxFrame = parseInt(protocolRule.maxFrameLen) || 512;
        if (parseBuffer.length - i > maxFrame) { i++; continue; }
        break;
      }
    }

    if (frameEnd < 0) break;
    const frame = parseBuffer.slice(i, frameEnd);
    const fields = parseFrameFields(frame, protocolRule);
    displayParsedFrame(frame, fields);
    i = frameEnd;
  }
  parseBuffer = parseBuffer.slice(i);
}

// DOM 元素
const elements = {
  // 窗口控制
  btnClose: document.getElementById('btn-close'),
  btnMinimize: document.getElementById('btn-minimize'),
  btnMaximize: document.getElementById('btn-maximize'),
  
  // 串口控制
  selectPort: document.getElementById('select-port'),
  btnConnect: document.getElementById('btn-connect'),
  btnDisconnect: document.getElementById('btn-disconnect'),
  selectBaudrate: document.getElementById('select-baudrate'),
  selectDatabits: document.getElementById('select-databits'),
  selectStopbits: document.getElementById('select-stopbits'),
  selectParity: document.getElementById('select-parity'),
  
  // 显示区域
  displayContent: document.getElementById('display-content'),
  btnClear: document.getElementById('btn-clear'),
  chkHexDisplay: document.getElementById('chk-hex-display'),
  chkSaveData: document.getElementById('chk-save-data'),
  chkReceiveToFile: document.getElementById('chk-receive-to-file'),
  
  // 发送控制
  inputSend: document.getElementById('input-send'),
  btnSend: document.getElementById('btn-send'),
  chkHexSend: document.getElementById('chk-hex-send'),
  chkTimedSend: document.getElementById('chk-timed-send'),
  inputTimedInterval: document.getElementById('input-timed-interval'),
  chkAddCrlf: document.getElementById('chk-add-crlf'),
  chkAddTimestamp: document.getElementById('chk-add-timestamp'),
  inputTimeout: document.getElementById('input-timeout'),
  
  // 多条字符串
  multiStringPanel: document.getElementById('multi-string-panel'),
  btnPanelDockLeft: document.getElementById('btn-panel-dock-left'),
  btnPanelDockRight: document.getElementById('btn-panel-dock-right'),
  multiStringTbody: document.getElementById('multi-string-tbody'),
  btnAddRow: document.getElementById('btn-add-row'),
  btnSendAll: document.getElementById('btn-send-all'),
  btnStopSend: document.getElementById('btn-stop-send'),
  chkLoopSend: document.getElementById('chk-loop-send'),
  
  // 状态
  statusText: document.getElementById('status-text'),
  sendCount: document.getElementById('send-count'),
  receiveCount: document.getElementById('receive-count'),
  
  // 其他
  btnSendFile: document.getElementById('btn-send-file'),
  btnClearSend: document.getElementById('btn-clear-send'),
  chkAlwaysTop: document.getElementById('chk-always-top')
};

// ── 主题管理 ────────────────────────────────────────────────────
const THEME_KEY = 'uart-theme';
const THEME_ICONS = { dark: '☀️', light: '🌙' };

function applyTheme(theme) {
  document.body.classList.remove('theme-dark', 'theme-light');
  document.body.classList.add('theme-' + theme);
  const icon = document.getElementById('theme-toggle-icon');
  if (icon) icon.textContent = THEME_ICONS[theme] || '🌙';
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  sendThemeToWebview(theme);
}

function sendThemeToWebview(theme) {
  const wv = document.getElementById('sidebar-webview');
  if (!wv) return;
  // IPC send（适用于 nodeIntegration webview）
  try { wv.send('theme-changed', theme); } catch (e) {}
  // executeJavaScript 直接设置（最可靠，适用于所有 webview）
  try {
    wv.executeJavaScript(
      `document.body.classList.remove('theme-dark','theme-light');` +
      `document.body.classList.add('theme-${theme}');`
    );
  } catch (e) {}
}

function initTheme() {
  let saved = 'dark';
  try { saved = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) {}
  applyTheme(saved);
  const btn = document.getElementById('menu-theme-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      const isDark = document.body.classList.contains('theme-dark');
      applyTheme(isDark ? 'light' : 'dark');
    });
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initLang();
  initEventListeners();
  loadSavedParams();
  addDefaultMultiStringRows();
  
  // 默认隐藏多条字符串面板
  if (elements.multiStringPanel) {
    elements.multiStringPanel.style.display = 'none';
    if (elements.btnPanelDockLeft) {
      elements.btnPanelDockLeft.style.display = 'none';
    }
    if (elements.btnPanelDockRight) {
      elements.btnPanelDockRight.style.display = 'flex';
    }
  }
  
  // 延迟获取串口列表，确保窗口完全加载
  setTimeout(() => {
    refreshPortList();
  }, 500);

  // 加载已保存的帧规则
  ipcRenderer.invoke('get-frame-rule').then(rule => {
    if (rule) {
      protocolRule = rule;
      protocolEnabled = rule.enabled !== false;
    }
  }).catch(() => {});
});

// 初始化事件监听器
function initEventListeners() {
  // 窗口控制
  elements.btnClose.addEventListener('click', () => {
    ipcRenderer.send('window-close');
  });
  
  elements.btnMinimize.addEventListener('click', () => {
    ipcRenderer.send('window-minimize');
  });
  
  elements.btnMaximize.addEventListener('click', () => {
    ipcRenderer.send('window-maximize');
  });
  
  // 串口列表菜单
  const menuPortList = document.getElementById('menu-port-list');
  const dropdownPortList = document.getElementById('dropdown-port-list');
  const menuRefreshPorts = document.getElementById('menu-refresh-ports');
  const dropdownPortItems = document.getElementById('dropdown-port-items');
  
  // 点击刷新
  menuRefreshPorts.addEventListener('click', async (e) => {
    e.stopPropagation();
    await refreshPortList();
    updatePortListMenu();
  });
  
  // 更新菜单中的串口列表
  async function updatePortListMenu() {
    try {
      const result = await ipcRenderer.invoke('get-serial-ports');
      dropdownPortItems.innerHTML = '';
      
      if (result && result.success !== false) {
        const ports = result.ports || result;
        ports.forEach(port => {
          const item = document.createElement('div');
          item.className = 'dropdown-port-item';
          const isCurrentPort = currentPort === port.path;
          
          const displayName = port.friendlyName || port.displayName || port.manufacturer || '';
          item.innerHTML = `
            <span class="port-check">${isCurrentPort ? '✓' : ''}</span>
            <span class="port-name">${port.path}${displayName ? ' - ' + displayName : ''}</span>
          `;
          
          item.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (isCurrentPort && isConnected) {
              // 如果点击的是当前打开的串口，断开连接
              await disconnectPort();
            } else if (!isConnected) {
              // 如果未连接，选择该串口
              elements.selectPort.value = port.path;
              await connectPort();
            } else {
              // 如果已连接其他串口，先断开再连接
              await disconnectPort();
              setTimeout(async () => {
                elements.selectPort.value = port.path;
                await connectPort();
              }, 300);
            }
            updatePortListMenu();
          });
          
          dropdownPortItems.appendChild(item);
        });
      }
    } catch (error) {
      console.error('更新菜单串口列表失败:', error);
    }
  }
  
  // 点击菜单项时显示/隐藏下拉菜单
  menuPortList.addEventListener('click', (e) => {
    // 如果点击的是下拉菜单内部，不处理（让内部元素自己处理）
    if (dropdownPortList.contains(e.target) && e.target !== menuPortList) {
      return;
    }
    
    e.stopPropagation();
    const isActive = menuPortList.classList.contains('active');
    if (isActive) {
      menuPortList.classList.remove('active');
      dropdownPortList.style.display = 'none';
    } else {
      menuPortList.classList.add('active');
      dropdownPortList.style.display = 'block';
      updatePortListMenu();
    }
  });
  
  // 点击下拉菜单内部时，阻止事件冒泡（但不关闭菜单）
  dropdownPortList.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  
  // 点击其他地方关闭菜单
  document.addEventListener('click', (e) => {
    if (!menuPortList.contains(e.target)) {
      menuPortList.classList.remove('active');
      dropdownPortList.style.display = 'none';
    }
  });
  
  // 保存更新函数到全局，供其他地方调用
  window.updatePortListMenu = updatePortListMenu;
  
  // 串口配置菜单
  const menuPortConfig = document.getElementById('menu-port-config');
  const portConfigModal = document.getElementById('port-config-modal');
  const modalBaudrate = document.getElementById('modal-baudrate');
  const modalDatabits = document.getElementById('modal-databits');
  const modalStopbits = document.getElementById('modal-stopbits');
  const modalParity = document.getElementById('modal-parity');
  const modalConfirm = document.getElementById('modal-confirm');
  const modalCancel = document.getElementById('modal-cancel');
  
  // 打开串口配置对话框
  if (menuPortConfig && portConfigModal) {
    menuPortConfig.addEventListener('click', () => {
      // 设置默认值为当前界面配置值
      modalBaudrate.value = elements.selectBaudrate.value;
      modalDatabits.value = elements.selectDatabits.value;
      modalStopbits.value = elements.selectStopbits.value;
      modalParity.value = elements.selectParity.value;
      
      portConfigModal.style.display = 'flex';
    });
    
    // 确认配置
    modalConfirm.addEventListener('click', () => {
      // 更新界面配置
      elements.selectBaudrate.value = modalBaudrate.value;
      elements.selectDatabits.value = modalDatabits.value;
      elements.selectStopbits.value = modalStopbits.value;
      elements.selectParity.value = modalParity.value;
      
      // 如果当前已连接，需要重新连接以应用新配置
      if (isConnected) {
        updateStatus(t('statusConfigUpdatedReconnect'));
      } else {
        updateStatus(t('statusConfigUpdated'));
      }
      
      portConfigModal.style.display = 'none';
    });
    
    // 取消配置
    modalCancel.addEventListener('click', () => {
      portConfigModal.style.display = 'none';
    });
    
    // 点击遮罩层关闭对话框
    portConfigModal.addEventListener('click', (e) => {
      if (e.target === portConfigModal) {
        portConfigModal.style.display = 'none';
      }
    });
  }
  
  // 指令组发送菜单
  const menuCommandGroup = document.getElementById('menu-command-group');
  if (menuCommandGroup) {
    menuCommandGroup.addEventListener('click', () => {
      // 显示面板
      if (elements.multiStringPanel) {
        elements.multiStringPanel.style.display = 'flex';
        if (elements.btnPanelDockRight) {
          elements.btnPanelDockRight.style.display = 'none';
        }
        if (elements.btnPanelDockLeft) {
          elements.btnPanelDockLeft.style.display = 'flex';
        }
      }
    });
  }
  
  // AI服务配置菜单
  const menuAiConfig = document.getElementById('menu-ai-config');
  const aiConfigModal = document.getElementById('ai-config-modal');

  if (menuAiConfig && aiConfigModal) {
    const aiModeBuiltin = document.getElementById('ai-mode-builtin');
    const aiModeLocal = document.getElementById('ai-mode-local');
    const aiLocalConfig = document.getElementById('ai-local-config');
    const aiApiUrl = document.getElementById('ai-api-url');
    const aiApiKey = document.getElementById('ai-api-key');
    const aiModelName = document.getElementById('ai-model-name');

    menuAiConfig.addEventListener('click', async () => {
      const config = await ipcRenderer.invoke('get-ai-config');
      if (config.ai_mode === 'local') {
        aiModeLocal.checked = true;
        aiLocalConfig.style.display = 'block';
      } else {
        aiModeBuiltin.checked = true;
        aiLocalConfig.style.display = 'none';
      }
      aiApiUrl.value = config.ai_api_url || '';
      aiApiKey.value = config.ai_api_key || '';
      aiModelName.value = config.ai_model || '';
      aiConfigModal.style.display = 'flex';
    });

    aiModeBuiltin.addEventListener('change', () => {
      aiLocalConfig.style.display = 'none';
    });

    aiModeLocal.addEventListener('change', () => {
      aiLocalConfig.style.display = 'block';
    });

    document.getElementById('ai-config-cancel').addEventListener('click', () => {
      aiConfigModal.style.display = 'none';
    });

    document.getElementById('ai-config-save').addEventListener('click', async () => {
      const config = {
        ai_mode: aiModeLocal.checked ? 'local' : 'builtin',
        ai_api_url: aiApiUrl.value.trim(),
        ai_api_key: aiApiKey.value.trim(),
        ai_model: aiModelName.value.trim()
      };
      const result = await ipcRenderer.invoke('save-ai-config', config);
      if (result.success) {
        aiConfigModal.style.display = 'none';
      } else {
        alert(t('errSaveProtocol') + result.error);
      }
    });
  }

  // ── 协议帧解析器模态框 ────────────────────────────────────────
  const menuProtocolParser = document.getElementById('menu-protocol-parser');
  const protocolModal = document.getElementById('protocol-modal');

  if (menuProtocolParser && protocolModal) {
    function updateProtocolModeUI(mode) {
      document.getElementById('protocol-fixed-config').style.display  = mode === 'fixed'     ? 'flex'  : 'none';
      document.getElementById('protocol-length-config').style.display = mode === 'length'    ? 'block' : 'none';
      document.getElementById('protocol-delimiter-config').style.display = mode === 'delimiter' ? 'flex' : 'none';
    }

    menuProtocolParser.addEventListener('click', async () => {
      const rule = await ipcRenderer.invoke('get-frame-rule');
      if (rule) {
        document.getElementById('protocol-name').value           = rule.name         || '';
        document.getElementById('protocol-header').value         = rule.header       || '';
        document.getElementById('protocol-mode').value           = rule.mode         || 'fixed';
        document.getElementById('protocol-frame-length').value   = rule.frameLength  || 8;
        document.getElementById('protocol-length-offset').value  = rule.lengthOffset !== undefined ? rule.lengthOffset : 2;
        document.getElementById('protocol-length-size').value    = rule.lengthSize   || 1;
        document.getElementById('protocol-length-scope').value   = rule.lengthScope  || 'data';
        document.getElementById('protocol-footer').value         = rule.footer       || '';
        document.getElementById('protocol-fields').value         = rule.fields       || '';
        document.getElementById('protocol-enable').checked       = rule.enabled !== false;
        updateProtocolModeUI(rule.mode || 'fixed');
      }
      protocolModal.style.display = 'flex';
    });

    document.getElementById('protocol-mode').addEventListener('change', e => {
      updateProtocolModeUI(e.target.value);
    });

    document.getElementById('protocol-cancel').addEventListener('click', () => {
      protocolModal.style.display = 'none';
    });

    document.getElementById('protocol-clear-buf').addEventListener('click', () => {
      parseBuffer = [];
      updateStatus(t('statusProtocolBufCleared'));
    });

    document.getElementById('protocol-save').addEventListener('click', async () => {
      const rule = {
        name:         document.getElementById('protocol-name').value.trim() || '自定义协议',
        header:       document.getElementById('protocol-header').value.trim(),
        mode:         document.getElementById('protocol-mode').value,
        frameLength:  parseInt(document.getElementById('protocol-frame-length').value) || 8,
        lengthOffset: parseInt(document.getElementById('protocol-length-offset').value) || 2,
        lengthSize:   parseInt(document.getElementById('protocol-length-size').value) || 1,
        lengthScope:  document.getElementById('protocol-length-scope').value || 'data',
        footer:       document.getElementById('protocol-footer').value.trim(),
        maxFrameLen:  512,
        fields:       document.getElementById('protocol-fields').value,
        enabled:      document.getElementById('protocol-enable').checked
      };
      const result = await ipcRenderer.invoke('save-frame-rule', rule);
      if (result.success) {
        protocolRule = rule;
        protocolEnabled = rule.enabled;
        parseBuffer = [];
        updateStatus(`${currentLang === 'zh' ? `帧规则 "${rule.name}" 已保存` : `Rule "${rule.name}" saved`}${rule.enabled ? (currentLang === 'zh' ? '，实时解析已启用' : ', parsing enabled') : ''}`);
        protocolModal.style.display = 'none';
      } else {
        alert((currentLang === 'zh' ? '保存失败: ' : 'Save failed: ') + result.error);
      }
    });

    protocolModal.addEventListener('click', e => {
      if (e.target === protocolModal) protocolModal.style.display = 'none';
    });
  }

  // ── TCP/UDP 转发模态框 ───────────────────────────────────────
  const menuTcpUdp = document.getElementById('menu-tcp-udp');
  const tcpudpModal = document.getElementById('tcpudp-modal');

  if (menuTcpUdp && tcpudpModal) {
    menuTcpUdp.addEventListener('click', () => { tcpudpModal.style.display = 'flex'; });
    document.getElementById('tcpudp-close').addEventListener('click', () => { tcpudpModal.style.display = 'none'; });

    document.getElementById('btn-tcp-server-start').addEventListener('click', async () => {
      const port = parseInt(document.getElementById('tcp-server-port').value);
      try {
        const r = await ipcRenderer.invoke('start-tcp-server', { port });
        if (r.success) {
          document.getElementById('tcp-server-status').textContent = `${t('statusRunning')} (${port})`;
          document.getElementById('tcp-server-status').style.color = '#16a34a';
          document.getElementById('btn-tcp-server-start').disabled = true;
          document.getElementById('btn-tcp-server-stop').disabled = false;
        } else { alert(t('alertStartFail') + r.error); }
      } catch (e) { alert(t('alertStartFail') + e.message); }
    });

    document.getElementById('btn-tcp-server-stop').addEventListener('click', async () => {
      await ipcRenderer.invoke('stop-tcp-server');
      document.getElementById('tcp-server-status').textContent = t('statusNotRunning');
      document.getElementById('tcp-server-status').style.color = '#888';
      document.getElementById('btn-tcp-server-start').disabled = false;
      document.getElementById('btn-tcp-server-stop').disabled = true;
    });

    document.getElementById('btn-tcp-client-connect').addEventListener('click', async () => {
      const host = document.getElementById('tcp-client-host').value.trim();
      const port = parseInt(document.getElementById('tcp-client-port').value);
      if (!host) { alert(t('alertEnterAddr')); return; }
      try {
        const r = await ipcRenderer.invoke('start-tcp-client', { host, port });
        if (r.success) {
          document.getElementById('tcp-client-status').textContent = t('statusConnected');
          document.getElementById('tcp-client-status').style.color = '#16a34a';
          document.getElementById('btn-tcp-client-connect').disabled = true;
          document.getElementById('btn-tcp-client-disconnect').disabled = false;
        } else { alert(t('alertConnFail') + r.error); }
      } catch (e) { alert(t('alertConnFail') + e.message); }
    });

    document.getElementById('btn-tcp-client-disconnect').addEventListener('click', async () => {
      await ipcRenderer.invoke('stop-tcp-client');
      document.getElementById('tcp-client-status').textContent = t('statusNotConnected');
      document.getElementById('tcp-client-status').style.color = '#888';
      document.getElementById('btn-tcp-client-connect').disabled = false;
      document.getElementById('btn-tcp-client-disconnect').disabled = true;
    });

    document.getElementById('btn-udp-start').addEventListener('click', async () => {
      const localPort  = parseInt(document.getElementById('udp-local-port').value);
      const remoteHost = document.getElementById('udp-remote-host').value.trim();
      const remotePort = parseInt(document.getElementById('udp-remote-port').value);
      if (!remoteHost) { alert(t('alertEnterAddr')); return; }
      try {
        const r = await ipcRenderer.invoke('start-udp', { localPort, remoteHost, remotePort });
        if (r.success) {
          document.getElementById('udp-status').textContent = t('statusRunning');
          document.getElementById('udp-status').style.color = '#16a34a';
          document.getElementById('btn-udp-start').disabled = true;
          document.getElementById('btn-udp-stop').disabled = false;
        } else { alert(t('alertStartFail') + r.error); }
      } catch (e) { alert(t('alertStartFail') + e.message); }
    });

    document.getElementById('btn-udp-stop').addEventListener('click', async () => {
      await ipcRenderer.invoke('stop-udp');
      document.getElementById('udp-status').textContent = t('statusNotRunning');
      document.getElementById('udp-status').style.color = '#888';
      document.getElementById('btn-udp-start').disabled = false;
      document.getElementById('btn-udp-stop').disabled = true;
    });

    tcpudpModal.addEventListener('click', e => {
      if (e.target === tcpudpModal) tcpudpModal.style.display = 'none';
    });
  }

  // 帮助菜单 - 在程序内部窗口打开 help.html
  const menuHelp = document.getElementById('menu-help');
  if (menuHelp) {
    menuHelp.addEventListener('click', async () => {
      try {
        await ipcRenderer.invoke('open-help');
      } catch (e) {
        console.error('打开帮助页面失败:', e);
      }
    });
  }

  // 买配件按钮 - 外部浏览器打开淘宝店
  const menuShop = document.getElementById('menu-shop');
  if (menuShop) {
    menuShop.addEventListener('click', () => {
      const { shell } = require('electron');
      shell.openExternal('https://mcpiot.taobao.com');
    });
  }

  // MCPIOT 菜单 - 显示/隐藏右侧侧边栏
  const menuMcpiot = document.getElementById('menu-mcpiot');
  const sidebar = document.getElementById('sidebar');
  const sidebarWebview = document.getElementById('sidebar-webview');
  const mainContainer = document.querySelector('.main-container');

  if (menuMcpiot && sidebar) {
    menuMcpiot.addEventListener('click', async () => {
      const isVisible = sidebar.style.display !== 'none';
      const bottomPanel = document.querySelector('.bottom-panel');

      if (isVisible) {
        sidebar.style.display = 'none';
        if (mainContainer) mainContainer.classList.remove('sidebar-open');
        if (bottomPanel) bottomPanel.style.marginRight = '';
      } else {
        // 根据AI服务配置决定加载哪个页面
        const aiConfig = await ipcRenderer.invoke('get-ai-config');
        const nodePath = require('path');
        let targetUrl;
        if (aiConfig.ai_mode === 'local') {
          const currentDir = await ipcRenderer.invoke('get-current-directory');
          targetUrl = 'file:///' + nodePath.join(currentDir, 'AILocal', 'index.html').replace(/\\/g, '/');
        } else {
          targetUrl = 'https://www.mcpiot.net/ai/index.html';
        }
        if (sidebarWebview && sidebarWebview.src !== targetUrl) {
          sidebarWebview.src = targetUrl;
        }
        sidebar.style.display = 'block';
        if (mainContainer) mainContainer.classList.add('sidebar-open');
        if (bottomPanel) bottomPanel.style.marginRight = '400px';
      }
    });
  }

  // 监听 webview 的消息，用于获取串口日志
  if (sidebarWebview) {
    // 禁用 webview 缓存并设置缩放
    sidebarWebview.addEventListener('dom-ready', () => {
      console.log('Webview 已加载完成');

      // 向 webview 同步当前主题和语言
      const currentTheme = document.body.classList.contains('theme-light') ? 'light' : 'dark';
      sendThemeToWebview(currentTheme);
      try { sidebarWebview.send('lang-changed', currentLang); } catch (e) {}
      try { sidebarWebview.executeJavaScript(`window.setAILang && window.setAILang('${currentLang}')`); } catch (e) {}

      // 设置 webview 缩放级别
      try {
        sidebarWebview.setZoomFactor(1.0);
      } catch (e) {
        console.warn('无法设置 webview 缩放:', e);
      }

      // 清除 webview 缓存
      try {
        sidebarWebview.clearData({}, { cache: true }, () => {
          console.log('Webview 缓存已清除');
        });
      } catch (e) {
        console.warn('无法清除 webview 缓存:', e);
      }

      // 监听导航事件，在每次加载时清除缓存
      sidebarWebview.addEventListener('did-navigate', () => {
        try {
          sidebarWebview.clearData({}, { cache: true }, () => {
            console.log('导航后缓存已清除');
          });
        } catch (e) {
          console.warn('导航后清除缓存失败:', e);
        }
      });
    });

    // 监听来自 webview 的 postMessage
    window.addEventListener('message', (event) => {
      // 检查消息是否来自 webview（通过 source 判断）
      if (event.data && event.data.type === 'get-serial-log') {
        console.log('收到获取串口日志请求');
        // 通过 postMessage 发送串口日志内容到 webview
        if (sidebarWebview && sidebarWebview.contentWindow) {
          sidebarWebview.contentWindow.postMessage({
            type: 'serial-log-content',
            content: serialLogContent || ''
          }, '*');
        }
      } else if (event.data && event.data.type === 'add-to-send-box') {
        // 处理从AI页面发送来的内容，添加到发送框（通过postMessage）
        const textToAdd = event.data.text || '';
        const enableHex = event.data.enableHex || false;
        
        console.log('收到add-to-send-box postMessage消息:', textToAdd, 'enableHex:', enableHex);
        
        if (textToAdd) {
          // 如果要求启用HEX发送，先选中
          if (enableHex && elements.chkHexSend) {
            elements.chkHexSend.checked = true;
            console.log('已启用HEX发送');
          }
          
          // 清空并设置发送框内容
          if (elements.inputSend) {
            // 先清空原内容，再设置新内容
            elements.inputSend.value = textToAdd;
            // 聚焦发送框
            elements.inputSend.focus();
            updateStatus(t('statusAddedFromAI'));
            console.log('已添加到发送框:', elements.inputSend.value);
          } else {
            console.error('elements.inputSend 不存在');
          }
        } else {
          console.warn('textToAdd 为空');
        }
      }
    });
  }
  
  // 串口控制
  elements.btnConnect.addEventListener('click', connectPort);
  elements.btnDisconnect.addEventListener('click', disconnectPort);
  elements.selectPort.addEventListener('dblclick', refreshPortList);
  
  // 刷新按钮
  const btnRefreshPort = document.getElementById('btn-refresh-port');
  if (btnRefreshPort) {
    btnRefreshPort.addEventListener('click', refreshPortList);
  }
  
  // 显示控制
  elements.btnClear.addEventListener('click', clearDisplay);
  elements.btnSendFile.addEventListener('click', sendFile);
  
  // 发送控制
  elements.btnSend.addEventListener('click', sendData);
  elements.inputSend.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      sendData();
    }
  });
  
  elements.chkTimedSend.addEventListener('change', (e) => {
    if (e.target.checked) {
      startTimedSend();
    } else {
      stopTimedSend();
    }
  });
  
  // HEX发送切换
  elements.chkHexSend.addEventListener('change', (e) => {
    const isHex = e.target.checked;
    // HEX发送时禁用回车换行
    elements.chkAddCrlf.disabled = isHex;
    
    // 如果切换到HEX模式，转换当前内容
    if (isHex && elements.inputSend.value) {
      const text = elements.inputSend.value;
      try {
        // 将文本转换为HEX字符串（去掉空格，每两个字符一组）
        const hexString = Array.from(Buffer.from(text, 'utf8'))
          .map(b => b.toString(16).padStart(2, '0').toUpperCase())
          .join(' ');
        elements.inputSend.value = hexString;
      } catch (error) {
        console.error('转换HEX失败:', error);
      }
    } else if (!isHex && elements.inputSend.value) {
      // 如果切换到文本模式，尝试将HEX转换回文本
      try {
        const hexString = elements.inputSend.value.replace(/\s+/g, '');
        if (/^[0-9A-Fa-f]+$/.test(hexString) && hexString.length % 2 === 0) {
          const text = Buffer.from(hexString, 'hex').toString('utf8');
          elements.inputSend.value = text;
        }
      } catch (error) {
        // 如果转换失败，保持原样
        console.error('转换文本失败:', error);
      }
    }
  });
  
  // 多条字符串
  elements.btnAddRow.addEventListener('click', addMultiStringRow);
  elements.btnSendAll.addEventListener('click', sendAllMultiStrings);
  elements.btnStopSend.addEventListener('click', stopMultiStringSend);
  
  // 面板停靠按钮 - 右侧按钮（显示面板）
  elements.btnPanelDockRight.addEventListener('click', () => {
    const panel = elements.multiStringPanel;
    panel.style.display = 'flex';
    elements.btnPanelDockRight.style.display = 'none';
    elements.btnPanelDockLeft.style.display = 'flex';
  });
  
  // 面板停靠按钮 - 左侧按钮（隐藏面板）
  elements.btnPanelDockLeft.addEventListener('click', () => {
    const panel = elements.multiStringPanel;
    panel.style.display = 'none';
    elements.btnPanelDockLeft.style.display = 'none';
    elements.btnPanelDockRight.style.display = 'flex';
  });
  
  // 其他按钮
  elements.btnClearSend.addEventListener('click', () => {
    elements.inputSend.value = '';
  });
  
  // 最前checkbox
  elements.chkAlwaysTop.addEventListener('change', (e) => {
    ipcRenderer.send('set-always-on-top', e.target.checked);
  });
  
  // 保存数据到文件
  elements.chkSaveData.addEventListener('change', async (e) => {
    if (e.target.checked) {
      // 选中时，弹出保存对话框选择文件
      setTimeout(async () => {
        const success = await openSaveDataFileDialog();
        if (!success) {
          // 如果用户取消或失败，取消勾选
          e.target.checked = false;
        }
      }, 0);
    } else {
      // 取消勾选时，停止保存
      saveDataFilePath = null;
      updateStatus(t('statusSaveStopped'));
    }
  });
  
  // IPC 消息监听
  ipcRenderer.on('serial-data', (event, data) => {
    receiveData(data);
  });
  
  ipcRenderer.on('serial-error', (event, error) => {
    showError((currentLang === 'zh' ? '串口错误: ' : 'Serial error: ') + error);
    disconnectPort();
  });

  // 响应主进程的串口日志请求
  ipcRenderer.on('request-serial-log', () => {
    ipcRenderer.send('serial-log-response', serialLogContent);
  });

  // 响应主进程的多指令组读取请求
  ipcRenderer.on('request-multi-cmds', () => {
    const rows = Array.from(elements.multiStringTbody ? elements.multiStringTbody.children : []);
    const items = rows.map((row, idx) => ({
      data:  row.querySelector('.multi-string-data').value,
      isHex: row.querySelector('.multi-string-hex').checked,
      order: parseInt(row.querySelector('.multi-string-order').value) || idx,
      delay: parseInt(row.querySelector('.multi-string-delay').value) || 1000
    })).filter(item => item.data.trim());
    ipcRenderer.send('multi-cmds-response', items);
  });

  // 响应主进程的多指令组写入请求
  ipcRenderer.on('set-multi-cmds-data', (_event, items) => {
    if (!elements.multiStringTbody) return;
    // 清空现有行
    while (elements.multiStringTbody.firstChild) {
      elements.multiStringTbody.removeChild(elements.multiStringTbody.firstChild);
    }
    // 逐行写入
    items.forEach((item, idx) => {
      addMultiStringRow();
      const rows = elements.multiStringTbody.children;
      const row = rows[rows.length - 1];
      row.querySelector('.multi-string-data').value  = item.data || '';
      row.querySelector('.multi-string-hex').checked = item.isHex || false;
      row.querySelector('.multi-string-order').value = item.order !== undefined ? item.order : idx;
      row.querySelector('.multi-string-delay').value = item.delay !== undefined ? item.delay : 1000;
    });
  });

  // 接收从AI页面发送来的内容，添加到发送框（通过IPC）
  ipcRenderer.on('add-to-send-box', (event, data) => {
    const textToAdd = data.text || '';
    const enableHex = data.enableHex || false;
    
    console.log('收到add-to-send-box IPC消息:', textToAdd, 'enableHex:', enableHex);
    
    if (textToAdd) {
      // 如果要求启用HEX发送，先选中
      if (enableHex && elements.chkHexSend) {
        elements.chkHexSend.checked = true;
        console.log('已启用HEX发送');
      }
      
      // 清空并设置发送框内容
      if (elements.inputSend) {
        // 先清空原内容，再设置新内容
        elements.inputSend.value = textToAdd;
        // 聚焦发送框
        elements.inputSend.focus();
        updateStatus(t('statusAddedFromAI'));
        console.log('已添加到发送框:', elements.inputSend.value);
      }
    }
  });
  
  // 原始字节 → 协议帧解析
  ipcRenderer.on('raw-serial-data', (event, bytesArray) => {
    processRawBytes(bytesArray);
  });

  // 网络数据（TCP/UDP收到后转发给串口时同步显示）
  ipcRenderer.on('network-data', (event, { source, hex }) => {
    const logLine = elements.chkReceiveToFile.checked
      ? `[${getTimestamp()}] ${source} → 串口: ${hex}`
      : `${source} → 串口: ${hex}`;
    addDisplayLine(logLine, 'received');
  });

  // TCP 状态事件
  ipcRenderer.on('tcp-event', (event, { type, info }) => {
    const msgs = currentLang === 'zh' ? {
      'server-started':     `TCP服务器已启动，监听端口 ${info}`,
      'server-stopped':     'TCP服务器已停止',
      'client-connected':   `TCP客户端已连接: ${info}`,
      'client-disconnected':'TCP客户端已断开',
      'error':              `TCP错误: ${info}`
    } : {
      'server-started':     `TCP server started, port ${info}`,
      'server-stopped':     'TCP server stopped',
      'client-connected':   `TCP client connected: ${info}`,
      'client-disconnected':'TCP client disconnected',
      'error':              `TCP error: ${info}`
    };
    if (msgs[type]) addDisplayLine(`[${getTimestamp()}] ${msgs[type]}`, 'timestamp');
    // 同步更新弹窗状态文字
    syncTcpUdpStatus(type, info);
  });

  // UDP 状态事件
  ipcRenderer.on('udp-event', (event, { type, info }) => {
    const msgs = currentLang === 'zh' ? {
      'started': `UDP已启动: ${info}`,
      'stopped': 'UDP已停止',
      'error':   `UDP错误: ${info}`
    } : {
      'started': `UDP started: ${info}`,
      'stopped': 'UDP stopped',
      'error':   `UDP error: ${info}`
    };
    if (msgs[type]) addDisplayLine(`[${getTimestamp()}] ${msgs[type]}`, 'timestamp');
  });

  // AI 工具通过 save_frame_rule 触发的规则应用
  ipcRenderer.on('apply-frame-rule', (event, rule) => {
    protocolRule = rule;
    protocolEnabled = rule.enabled !== false;
    parseBuffer = [];
    updateStatus(`${currentLang === 'zh' ? `帧规则 "${rule.name}" 已应用` : `Rule "${rule.name}" applied`}${protocolEnabled ? (currentLang === 'zh' ? '，实时解析已启用' : ', parsing enabled') : ''}`);
  });

  ipcRenderer.on('serial-closed', () => {
    // 如果已经断开，不再重复处理
    if (!isConnected) {
      return;
    }
    // 只更新状态，不重复显示消息
    isConnected = false;
    currentPort = null;
    elements.btnConnect.disabled = false;
    elements.btnDisconnect.disabled = true;
    elements.selectPort.disabled = true;
    stopTimedSend();
    setTimeout(() => {
      elements.selectPort.disabled = false;
    }, 500);
  });
  
  // 数据接收区右键菜单
  let contextMenu = null;
  elements.displayContent.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    
    // 移除旧的菜单
    if (contextMenu) {
      contextMenu.remove();
    }
    
    const selectedText = window.getSelection().toString();
    const hasSelection = selectedText.length > 0;
    
    // 创建右键菜单
    contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.style.cssText = `
      position: fixed;
      left: ${e.pageX}px;
      top: ${e.pageY}px;
      background: white;
      border: 1px solid #d0d0d0;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      padding: 4px 0;
      z-index: 10000;
      min-width: 120px;
    `;
    
    const menuItems = [
      { id: 'copy', label: '复制', enabled: hasSelection },
      { id: 'cut', label: '剪切', enabled: hasSelection },
      { id: 'paste', label: '粘贴', enabled: hasSelection },
      { id: 'delete', label: '删除', enabled: hasSelection },
      { id: 'separator' },
      { id: 'ai-send', label: 'AI发送', enabled: hasSelection },
      { id: 'separator2' },
      { id: 'selectall', label: '全选', enabled: true }
    ];
    
    menuItems.forEach(item => {
      if (item.id === 'separator') {
        const separator = document.createElement('div');
        separator.style.cssText = 'height: 1px; background: #e0e0e0; margin: 4px 0;';
        contextMenu.appendChild(separator);
      } else {
        const menuItem = document.createElement('div');
        menuItem.className = 'context-menu-item';
        menuItem.textContent = item.label;
        menuItem.style.cssText = `
          padding: 6px 16px;
          cursor: ${item.enabled ? 'pointer' : 'default'};
          color: ${item.enabled ? '#333' : '#999'};
          background: ${item.enabled ? 'white' : '#f5f5f5'};
          user-select: none;
        `;
        
        if (item.enabled) {
          menuItem.addEventListener('mouseenter', () => {
            menuItem.style.background = '#f0f0f0';
          });
          menuItem.addEventListener('mouseleave', () => {
            menuItem.style.background = 'white';
          });
          
          menuItem.addEventListener('click', () => {
            handleContextMenuAction(item.id, selectedText);
            contextMenu.remove();
            contextMenu = null;
          });
        }
        
        contextMenu.appendChild(menuItem);
      }
    });
    
    document.body.appendChild(contextMenu);
    
    // 点击其他地方关闭菜单
    const closeMenu = (event) => {
      if (contextMenu && !contextMenu.contains(event.target)) {
        contextMenu.remove();
        contextMenu = null;
        document.removeEventListener('click', closeMenu);
      }
    };
    
    setTimeout(() => {
      document.addEventListener('click', closeMenu);
    }, 0);
  });
  
  // 处理右键菜单操作
  function handleContextMenuAction(action, selectedText) {
    switch (action) {
      case 'copy':
        if (selectedText) {
          navigator.clipboard.writeText(selectedText).then(() => {
            updateStatus(t('statusCopied'));
          }).catch(err => {
            copyToClipboardFallback(selectedText);
          });
        }
        break;
        
      case 'cut':
        if (selectedText) {
          navigator.clipboard.writeText(selectedText).then(() => {
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
              const range = selection.getRangeAt(0);
              range.deleteContents();
              updateStatus(t('statusCut'));
            }
          }).catch(err => {
            copyToClipboardFallback(selectedText);
          });
        }
        break;
        
      case 'paste':
        navigator.clipboard.readText().then(text => {
          const selection = window.getSelection();
          if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(document.createTextNode(text));
            updateStatus(t('statusPasted'));
          }
        }).catch(err => {
          updateStatus(t('statusPasteFailed'));
        });
        break;
        
      case 'delete':
        if (selectedText) {
          const selection = window.getSelection();
          if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            updateStatus(t('statusDeleted'));
          }
        }
        break;
        
      case 'selectall':
        const range = document.createRange();
        range.selectNodeContents(elements.displayContent);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        updateStatus(t('statusSelectAll'));
        break;
        
      case 'ai-send':
        if (selectedText && sidebarWebview) {
          // 确保侧边栏显示
          const sidebar = document.getElementById('sidebar');
          if (sidebar && sidebar.style.display === 'none') {
            sidebar.style.display = 'block';
            const mainContainer = document.querySelector('.main-container');
            if (mainContainer) {
              mainContainer.classList.add('sidebar-open');
            }
          }
          
          // 等待webview加载完成，然后发送消息
          if (sidebarWebview.contentWindow) {
            sidebarWebview.contentWindow.postMessage({
              type: 'append-to-input',
              text: selectedText
            }, '*');
            updateStatus(t('statusSentToAI'));
          } else {
            // 如果webview还没加载完成，等待dom-ready事件
            sidebarWebview.addEventListener('dom-ready', () => {
              if (sidebarWebview.contentWindow) {
                sidebarWebview.contentWindow.postMessage({
                  type: 'append-to-input',
                  text: selectedText
                }, '*');
                updateStatus(t('statusSentToAI'));
              }
            }, { once: true });
          }
        }
        break;
    }
  }
  
  // 复制到剪贴板的降级方案
  function copyToClipboardFallback(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      updateStatus(t('statusCopied'));
    } catch (err) {
      updateStatus(t('statusCopyFailed'));
    }
    document.body.removeChild(textArea);
  }
}

// 刷新串口列表
async function refreshPortList() {
  try {
    // 保存当前选中的串口
    const selectedPort = elements.selectPort.value;
    
    updateStatus(t('statusLoadingPorts'));
    const result = await ipcRenderer.invoke('get-serial-ports');
    
    elements.selectPort.innerHTML = `<option value="">${t('optSelectPort')}</option>`;
    
    if (result && result.success !== false) {
      const ports = result.ports || result; // 兼容新旧格式
      
      if (ports.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = t('statusNoPorts');
        option.disabled = true;
        elements.selectPort.appendChild(option);
        updateStatus(t('statusNoPorts'));
      } else {
        ports.forEach(port => {
          const option = document.createElement('option');
          option.value = port.path;
          const displayName = port.friendlyName || port.displayName || port.manufacturer || '';
          const label = displayName 
            ? `${port.path} - ${displayName}`
            : port.path;
          option.textContent = label;
          elements.selectPort.appendChild(option);
        });
        
        // 恢复之前选中的串口（如果还存在）
        if (selectedPort) {
          const portExists = Array.from(elements.selectPort.options).some(
            opt => opt.value === selectedPort
          );
          if (portExists) {
            elements.selectPort.value = selectedPort;
          }
        }
        
        updateStatus(currentLang === 'zh' ? `已检测到 ${ports.length} 个串口设备` : `${ports.length} port(s) detected`);
      }
    } else {
      const errorMsg = result.error || '未知错误';
      showError(t('errGetPorts') + errorMsg);
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '获取串口列表失败';
      option.disabled = true;
      elements.selectPort.appendChild(option);
    }
  } catch (error) {
    console.error('刷新串口列表异常:', error);
    showError(t('errGetPorts') + (error.message || String(error)));
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '获取串口列表失败';
    option.disabled = true;
    elements.selectPort.appendChild(option);
  }
}

// 连接串口
async function connectPort() {
  const port = elements.selectPort.value;
  if (!port) {
    showError(t('errSelectPort'));
    return;
  }
  
  try {
    const options = {
      path: port,
      baudRate: parseInt(elements.selectBaudrate.value),
      dataBits: parseInt(elements.selectDatabits.value),
      stopBits: parseInt(elements.selectStopbits.value),
      parity: elements.selectParity.value
    };
    
    await ipcRenderer.invoke('open-serial-port', options);
    isConnected = true;
    currentPort = port;
    
    elements.btnConnect.disabled = true;
    elements.btnDisconnect.disabled = false;
    elements.selectPort.disabled = true;
    
    updateStatus(currentLang === 'zh' ? `已连接到 ${port}` : `Connected to ${port}`);
    addDisplayLine(`[${getTimestamp()}] 已连接到 ${port}`, 'timestamp');
    
    // 更新菜单中的串口列表
    if (window.updatePortListMenu) {
      window.updatePortListMenu();
    }
  } catch (error) {
    showError(t('errConnect') + error.message);
  }
}

// 断开串口
async function disconnectPort() {
  // 如果已经断开，不再重复处理
  if (!isConnected) {
    return;
  }
  
  try {
    isConnected = false; // 先设置标志，防止重复调用
    await ipcRenderer.invoke('close-serial-port');
    currentPort = null;
    
    elements.btnConnect.disabled = false;
    elements.btnDisconnect.disabled = true;
    elements.selectPort.disabled = true;
    
    stopTimedSend();
    updateStatus(t('statusDisconnected'));
    addDisplayLine(`[${getTimestamp()}] 已断开连接`, 'timestamp');
    
    // 重新启用端口选择
    setTimeout(() => {
      elements.selectPort.disabled = false;
    }, 500);
    
    // 更新菜单中的串口列表
    if (window.updatePortListMenu) {
      window.updatePortListMenu();
    }
  } catch (error) {
    showError(t('errDisconnect') + error.message);
    // 如果断开失败，恢复连接状态
    isConnected = true;
  }
}

// 发送数据
async function sendData() {
  if (!isConnected) {
    showError(t('errNotConnected'));
    return;
  }
  
  let data = elements.inputSend.value;
  if (!data) {
    return;
  }
  
  const isHex = elements.chkHexSend.checked;
  const addCrlf = elements.chkAddCrlf.checked;
  
  try {
    // 添加回车换行
    if (addCrlf && !isHex) {
      data += '\r\n';
    }
    
    await ipcRenderer.invoke('write-serial-port', data, isHex);
    
    // 计算发送的字节数
    let byteCount = 0;
    if (isHex) {
      // HEX模式下，计算十六进制字符串的字节数
      const hexString = data.replace(/\s+/g, '');
      byteCount = hexString.length / 2;
    } else {
      // 文本模式下，计算UTF-8编码的字节数
      byteCount = Buffer.byteLength(data, 'utf8');
    }
    sendCount += byteCount;
    elements.sendCount.textContent = sendCount;
    
    // 显示发送的数据
    const displayData = isHex ? data : data.replace(/\r\n/g, '\\r\\n');
    // 根据"加时间戳"checkbox决定是否显示时间戳和"发送: "前缀
    let logLine = '';
    if (elements.chkReceiveToFile.checked) {
      logLine = `[${getTimestamp()}] 发送: ${displayData}`;
    } else {
      logLine = displayData;
    }
    addDisplayLine(logLine, 'sent');
    
    // 如果不自动清除，可以选择清除输入框
    // elements.inputSend.value = '';
    
    updateStatus(t('statusDataSent'));
  } catch (error) {
    showError(t('errSend') + error.message);
  }
}

// 接收数据
function receiveData(data) {
  // 计算接收的字节数（UTF-8编码）
  const byteCount = Buffer.byteLength(data, 'utf8');
  receiveCount += byteCount;
  elements.receiveCount.textContent = receiveCount;
  
  let displayData = data;
  if (elements.chkHexDisplay.checked) {
    // 转换为十六进制显示
    displayData = Array.from(Buffer.from(data, 'utf8'))
      .map(b => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
  }
  
  // 根据"加时间戳"checkbox决定是否显示时间戳和"接收: "前缀
  let logLine = '';
  if (elements.chkReceiveToFile.checked) {
    const timestamp = `[${getTimestamp()}] `;
    logLine = timestamp + '接收: ' + displayData;
  } else {
    logLine = displayData;
  }
  addDisplayLine(logLine, 'received');
  
  // 保存到串口日志内容（保留原始数据，不包含时间戳前缀）
  serialLogContent += data + '\n';
  
  // 如果启用了保存数据到文件，追加数据到文件
  if (saveDataFilePath && elements.chkSaveData.checked) {
    appendDataToFile(saveDataFilePath, data);
  }
  
  // 限制日志长度，避免内存过大（保留最近10000行）
  const lines = serialLogContent.split('\n');
  if (lines.length > 10000) {
    serialLogContent = lines.slice(-10000).join('\n');
  }
  
  // 保存数据到文件
  if (elements.chkReceiveToFile.checked) {
    // 这里可以实现保存到文件的功能
  }
}

// 添加显示行
function addDisplayLine(text, className = '') {
  const line = document.createElement('div');
  line.className = `data-line ${className}`;
  line.textContent = text;
  elements.displayContent.appendChild(line);
  
  // 自动滚动到底部
  elements.displayContent.scrollTop = elements.displayContent.scrollHeight;
}

// 清除显示
function clearDisplay() {
  elements.displayContent.innerHTML = '<div class="welcome-text">欢迎使用串口调试工具</div>';
  receiveCount = 0;
  sendCount = 0;
  serialLogContent = ''; // 清空串口日志内容
  elements.receiveCount.textContent = '0';
  elements.sendCount.textContent = '0';
}

// 定时发送
function startTimedSend() {
  if (timedSendInterval) {
    clearInterval(timedSendInterval);
  }
  
  const interval = parseInt(elements.inputTimedInterval.value) || 100;
  timedSendInterval = setInterval(() => {
    if (isConnected && elements.inputSend.value) {
      sendData();
    }
  }, interval);
}

function stopTimedSend() {
  if (timedSendInterval) {
    clearInterval(timedSendInterval);
    timedSendInterval = null;
  }
  elements.chkTimedSend.checked = false;
}

// 多条字符串功能
function addDefaultMultiStringRows() {
  // 添加几行示例数据
  for (let i = 0; i < 3; i++) {
    addMultiStringRow();
  }
}

function addMultiStringRow() {
  const row = document.createElement('tr');
  const rowIndex = elements.multiStringTbody.children.length;
  
  row.innerHTML = `
    <td style="text-align: center;">
      <input type="checkbox" class="multi-string-hex" title="HEX发送">
    </td>
    <td>
      <textarea class="multi-string-data" data-i18n-ph="rowPlaceholder" placeholder="${t('rowPlaceholder')}" rows="1"></textarea>
    </td>
    <td>
      <button class="btn-small btn-send-row" data-i18n="rowSend">${t('rowSend')}</button>
    </td>
    <td>
      <input type="number" class="multi-string-order" value="${rowIndex}" min="0">
    </td>
    <td>
      <input type="number" class="multi-string-delay" value="1000" min="0">
    </td>
    <td>
      <button class="btn-small btn-delete-row" data-i18n="rowDelete">${t('rowDelete')}</button>
    </td>
  `;
  
  elements.multiStringTbody.appendChild(row);
  
  // 绑定事件
  const sendBtn = row.querySelector('.btn-send-row');
  const deleteBtn = row.querySelector('.btn-delete-row');
  const dataTextarea = row.querySelector('.multi-string-data');
  const hexCheckbox = row.querySelector('.multi-string-hex');
  
  sendBtn.addEventListener('click', () => {
    sendMultiStringRow(row);
  });
  
  deleteBtn.addEventListener('click', () => {
    row.remove();
  });
  
  // HEX checkbox切换时，转换内容
  hexCheckbox.addEventListener('change', (e) => {
    const isHex = e.target.checked;
    const text = dataTextarea.value;
    if (!text) return;
    
    if (isHex) {
      // 转换为HEX
      try {
        const hexString = Array.from(Buffer.from(text, 'utf8'))
          .map(b => b.toString(16).padStart(2, '0').toUpperCase())
          .join(' ');
        dataTextarea.value = hexString;
      } catch (error) {
        console.error('转换HEX失败:', error);
      }
    } else {
      // 转换为文本
      try {
        const hexString = text.replace(/\s+/g, '');
        if (/^[0-9A-Fa-f]+$/.test(hexString) && hexString.length % 2 === 0) {
          const textContent = Buffer.from(hexString, 'hex').toString('utf8');
          dataTextarea.value = textContent;
        }
      } catch (error) {
        console.error('转换文本失败:', error);
      }
    }
  });
  
  // 双击编辑注释（这里简化处理，可以扩展）
  dataTextarea.addEventListener('dblclick', () => {
    const comment = prompt('输入注释:');
    if (comment) {
      dataTextarea.title = comment;
    }
  });
}

async function sendMultiStringRow(row) {
  if (!isConnected) {
    showError(t('errNotConnected'));
    return;
  }
  
  const data = row.querySelector('.multi-string-data').value;
  if (!data) {
    return;
  }
  
  const isHex = row.querySelector('.multi-string-hex').checked;
  
  try {
    await ipcRenderer.invoke('write-serial-port', data, isHex);
    // 计算发送的字节数
    let byteCount = 0;
    if (isHex) {
      // HEX模式下，计算十六进制字符串的字节数
      const hexString = data.replace(/\s+/g, '');
      byteCount = hexString.length / 2;
    } else {
      // 文本模式下，计算UTF-8编码的字节数
      byteCount = Buffer.byteLength(data, 'utf8');
    }
    sendCount += byteCount;
    elements.sendCount.textContent = sendCount;
    
    // 根据"加时间戳"checkbox决定是否显示时间戳和"发送: "前缀
    let logLine = '';
    if (elements.chkReceiveToFile.checked) {
      logLine = `[${getTimestamp()}] 发送: ${data}`;
    } else {
      logLine = data;
    }
    addDisplayLine(logLine, 'sent');
  } catch (error) {
    showError(t('errSend') + error.message);
  }
}

async function sendAllMultiStrings() {
  if (!isConnected) {
    showError(t('errNotConnected'));
    return;
  }
  
  if (isSendingMultiStrings) {
    return;
  }
  
  // 收集所有行
  const rows = Array.from(elements.multiStringTbody.children);
  const items = rows.map(row => ({
    data: row.querySelector('.multi-string-data').value,
    isHex: row.querySelector('.multi-string-hex').checked,
    order: parseInt(row.querySelector('.multi-string-order').value) || 0,
    delay: parseInt(row.querySelector('.multi-string-delay').value) || 0
  })).filter(item => item.data); // 过滤空数据
  
  if (items.length === 0) {
    showError(t('errNoData'));
    return;
  }
  
  // 按顺序排序
  items.sort((a, b) => a.order - b.order);
  
  isSendingMultiStrings = true;
  elements.btnSendAll.disabled = true;
  elements.btnStopSend.disabled = false;
  
  // 发送队列
  multiStringQueue = items;
  await processMultiStringQueue();
}

async function processMultiStringQueue() {
  if (!isSendingMultiStrings || multiStringQueue.length === 0) {
    isSendingMultiStrings = false;
    elements.btnSendAll.disabled = false;
    elements.btnStopSend.disabled = true;
    
    if (elements.chkLoopSend.checked && isConnected) {
      // 重新开始循环发送
      setTimeout(() => {
        if (isConnected) {
          sendAllMultiStrings();
        }
      }, 1000);
    }
    return;
  }
  
  const item = multiStringQueue.shift();
  
  try {
    await ipcRenderer.invoke('write-serial-port', item.data, item.isHex);
    // 计算发送的字节数
    let byteCount = 0;
    if (item.isHex) {
      // HEX模式下，计算十六进制字符串的字节数
      const hexString = item.data.replace(/\s+/g, '');
      byteCount = hexString.length / 2;
    } else {
      // 文本模式下，计算UTF-8编码的字节数
      byteCount = Buffer.byteLength(item.data, 'utf8');
    }
    sendCount += byteCount;
    elements.sendCount.textContent = sendCount;
    
    addDisplayLine(`[${getTimestamp()}] 发送: ${item.data}`, 'sent');
    
    // 延时后发送下一个
    setTimeout(() => {
      if (isSendingMultiStrings) {
        processMultiStringQueue();
      }
    }, item.delay);
  } catch (error) {
    showError(t('errSend') + error.message);
    isSendingMultiStrings = false;
    elements.btnSendAll.disabled = false;
    elements.btnStopSend.disabled = true;
  }
}

function stopMultiStringSend() {
  isSendingMultiStrings = false;
  multiStringQueue = [];
  elements.btnSendAll.disabled = false;
  elements.btnStopSend.disabled = true;
  updateStatus(t('statusSendStopped'));
}

// 工具函数
function getTimestamp() {
  const now = new Date();
  return now.toLocaleTimeString('zh-CN', { hour12: false, milliseconds: true });
}

function updateStatus(text) {
  elements.statusText.textContent = text;
}

function showError(message) {
  updateStatus(t('statusError') + message);
  addDisplayLine(`[${getTimestamp()}] ${t('statusError')}${message}`, 'error');
  console.error(message);
}

// 发送文件
async function sendFile() {
  if (!isConnected) {
    showError(t('errNotConnected'));
    return;
  }
  
  try {
    const result = await ipcRenderer.invoke('open-file-dialog');
    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      updateStatus(t('statusReadingFile'));
      
      // 读取文件内容
      const fileResult = await ipcRenderer.invoke('read-file', filePath);
      if (fileResult.success) {
        const content = fileResult.content;
        
        // 发送文件内容
        const isHex = elements.chkHexSend.checked;
        await ipcRenderer.invoke('write-serial-port', content, isHex);
        
        // 计算发送的字节数
        let byteCount = 0;
        if (isHex) {
          // HEX模式下，计算十六进制字符串的字节数
          const hexString = content.replace(/\s+/g, '');
          byteCount = hexString.length / 2;
        } else {
          // 文本模式下，计算UTF-8编码的字节数
          byteCount = Buffer.byteLength(content, 'utf8');
        }
        sendCount += byteCount;
        elements.sendCount.textContent = sendCount;
        
        // 根据"加时间戳"checkbox决定是否显示时间戳和"发送: "前缀
        let logLine = '';
        if (elements.chkReceiveToFile.checked) {
          logLine = `[${getTimestamp()}] 发送文件: ${filePath}`;
        } else {
          logLine = `发送文件: ${filePath}`;
        }
        addDisplayLine(logLine, 'sent');
        
        // 文件内容长度信息也根据时间戳设置
        let lengthLine = '';
        if (elements.chkReceiveToFile.checked) {
          lengthLine = `[${getTimestamp()}] 文件内容长度: ${content.length} 字节`;
        } else {
          lengthLine = `文件内容长度: ${content.length} 字节`;
        }
        addDisplayLine(lengthLine, 'timestamp');
        updateStatus(t('statusFileSent'));
      } else {
        showError(t('errReadFile') + fileResult.error);
      }
    }
  } catch (error) {
    showError(t('errSendFile') + error.message);
  }
}

// 打开保存数据文件对话框
async function openSaveDataFileDialog() {
  try {
    // 生成默认文件名：串口名+日期时间（精确到毫秒）+6位随机串
    let portName = (currentPort || 'unknown').replace(/[<>:"/\\|?*]/g, '_');
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
    const defaultFileName = `${portName}_${year}${month}${day}_${hours}${minutes}${seconds}${milliseconds}_${randomStr}.txt`;
    
    // 获取当前目录
    const currentDir = await ipcRenderer.invoke('get-current-directory');
    const path = require('path');
    const defaultPath = path.join(currentDir, defaultFileName);
    
    // 显示保存文件对话框
    const result = await ipcRenderer.invoke('save-file-dialog', defaultPath);
    
    if (!result.canceled && result.filePath) {
      saveDataFilePath = result.filePath;
      // 如果文件已存在，清空文件；如果不存在，创建新文件
      await ipcRenderer.invoke('write-file', saveDataFilePath, '');
      updateStatus(`开始保存数据到文件: ${path.basename(saveDataFilePath)}`);
      return true;
    } else {
      return false; // 用户取消了对话框
    }
  } catch (error) {
    setTimeout(() => {
      alert((currentLang === 'zh' ? '打开保存文件对话框失败: ' : 'Failed to open save dialog: ') + error.message);
    }, 0);
    showError((currentLang === 'zh' ? '打开保存文件对话框失败: ' : 'Failed to open save dialog: ') + error.message);
    return false;
  }
}

// 追加数据到文件
async function appendDataToFile(filePath, data) {
  try {
    await ipcRenderer.invoke('append-file', filePath, data);
  } catch (error) {
    console.error('追加数据到文件失败:', error);
    // 如果追加失败，取消保存功能
    elements.chkSaveData.checked = false;
    saveDataFilePath = null;
    showError(t('errSaveData') + error.message);
  }
}

// 保存数据到文件（一次性保存，已废弃，保留用于兼容）
async function saveDataToFile() {
  try {
    // 获取接收区所有内容
    const content = elements.displayContent.innerText || elements.displayContent.textContent;
    
    if (!content || content.trim() === '') {
      // 使用setTimeout确保在事件处理完成后显示alert，避免影响输入框
      setTimeout(() => {
        alert(currentLang === 'zh' ? '接收区没有数据可保存' : 'No data to save');
      }, 0);
      return false; // 返回false表示保存失败或取消
    }
    
    // 生成文件名：串口名+日期时间（精确到毫秒）+6位随机串
    // 清理串口名中的特殊字符，确保文件名安全
    let portName = (currentPort || 'unknown').replace(/[<>:"/\\|?*]/g, '_');
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    
    // 生成6位随机串
    const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    const fileName = `${portName}_${year}${month}${day}_${hours}${minutes}${seconds}${milliseconds}_${randomStr}.txt`;
    
    // 获取当前目录
    const currentDir = await ipcRenderer.invoke('get-current-directory');
    const path = require('path');
    const filePath = path.join(currentDir, fileName);
    
    // 保存文件
    const result = await ipcRenderer.invoke('write-file', filePath, content);
    
    if (result.success) {
      // 使用setTimeout确保在事件处理完成后显示alert，避免影响输入框
      setTimeout(() => {
        alert((currentLang === 'zh' ? `接收区所有内容已保存到文件：\n` : `All data saved to:\n`) + filePath);
      }, 0);
      updateStatus(currentLang === 'zh' ? `数据已保存到: ${fileName}` : `Data saved to: ${fileName}`);
      return true; // 返回true表示保存成功
    } else {
      setTimeout(() => {
        alert((currentLang === 'zh' ? '保存文件失败: ' : 'Save failed: ') + result.error);
      }, 0);
      showError(t('errSaveFile') + result.error);
      return false;
    }
  } catch (error) {
    setTimeout(() => {
      alert(t('errSaveFile') + error.message);
    }, 0);
    showError(t('errSaveFile') + error.message);
    return false;
  }
}

// 保存和加载参数
function saveParams() {
  const params = {
    port: elements.selectPort.value,
    baudrate: elements.selectBaudrate.value,
    databits: elements.selectDatabits.value,
    stopbits: elements.selectStopbits.value,
    parity: elements.selectParity.value,
    hexDisplay: elements.chkHexDisplay.checked,
    hexSend: elements.chkHexSend.checked,
    addCrlf: elements.chkAddCrlf.checked,
    addTimestamp: elements.chkAddTimestamp.checked
  };
  
  localStorage.setItem('uartParams', JSON.stringify(params));
  updateStatus(t('statusParamsSaved'));
}

function loadSavedParams() {
  try {
    const saved = localStorage.getItem('uartParams');
    if (saved) {
      const params = JSON.parse(saved);
      if (params.baudrate) elements.selectBaudrate.value = params.baudrate;
      if (params.databits) elements.selectDatabits.value = params.databits;
      if (params.stopbits) elements.selectStopbits.value = params.stopbits;
      if (params.parity) elements.selectParity.value = params.parity;
      if (params.hexDisplay !== undefined) elements.chkHexDisplay.checked = params.hexDisplay;
      if (params.hexSend !== undefined) elements.chkHexSend.checked = params.hexSend;
      if (params.addCrlf !== undefined) elements.chkAddCrlf.checked = params.addCrlf;
      if (params.addTimestamp !== undefined) elements.chkAddTimestamp.checked = params.addTimestamp;
    }
  } catch (error) {
    console.error('加载参数失败:', error);
  }
}


// 同步 TCP/UDP 弹窗状态文字（由 IPC 事件驱动，即使弹窗关闭也保持最新）
function syncTcpUdpStatus(type, info) {
  const el = id => document.getElementById(id);
  switch (type) {
    case 'server-started':
      if (el('tcp-server-status')) { el('tcp-server-status').textContent = `${t('statusRunning')} (${info})`; el('tcp-server-status').style.color = '#16a34a'; }
      if (el('btn-tcp-server-start')) el('btn-tcp-server-start').disabled = true;
      if (el('btn-tcp-server-stop'))  el('btn-tcp-server-stop').disabled  = false;
      break;
    case 'server-stopped':
      if (el('tcp-server-status')) { el('tcp-server-status').textContent = t('statusNotRunning'); el('tcp-server-status').style.color = '#888'; }
      if (el('btn-tcp-server-start')) el('btn-tcp-server-start').disabled = false;
      if (el('btn-tcp-server-stop'))  el('btn-tcp-server-stop').disabled  = true;
      break;
    case 'client-disconnected':
      if (el('tcp-client-status')) { el('tcp-client-status').textContent = t('statusNotConnected'); el('tcp-client-status').style.color = '#888'; }
      if (el('btn-tcp-client-connect'))    el('btn-tcp-client-connect').disabled    = false;
      if (el('btn-tcp-client-disconnect')) el('btn-tcp-client-disconnect').disabled = true;
      break;
  }
}

// 定期刷新串口列表
setInterval(() => {
  if (!isConnected) {
    refreshPortList();
  }
}, 5000);

