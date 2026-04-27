const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const net = require('net');
const dgram = require('dgram');
const { Transform } = require('stream');

// 加载 SerialPort 模块
let SerialPort;
let ReadlineParser;
try {
  const serialportModule = require('serialport');
  
  // 在 serialport v12 中，ReadlineParser 可以直接从 serialport 模块获取
  // 或者从 @serialport/parser-readline 包中获取
  try {
    const parserModule = require('@serialport/parser-readline');
    ReadlineParser = parserModule.ReadlineParser || parserModule;
    console.log('ReadlineParser 从 @serialport/parser-readline 加载');
  } catch (parserError) {
    // 如果单独包加载失败，尝试从 serialport 模块获取
    ReadlineParser = serialportModule.ReadlineParser;
    console.log('ReadlineParser 从 serialport 模块加载');
  }
  
  // serialport v12 中，list 是模块的静态方法，SerialPort 是类
  console.log('SerialPort 模块加载成功');
  console.log('SerialPort 类型:', typeof serialportModule);
  console.log('SerialPort.list 类型:', typeof serialportModule.list);
  console.log('ReadlineParser 类型:', typeof ReadlineParser);
  
  // 在 serialport v12 中，list 方法在 SerialPort 类上
  if (serialportModule.SerialPort && typeof serialportModule.SerialPort.list === 'function') {
    SerialPort = serialportModule.SerialPort;
    console.log('使用 SerialPort.list 方法');
  } else if (typeof serialportModule.list === 'function') {
    SerialPort = serialportModule;
    console.log('使用 serialport.list 方法');
  } else if (serialportModule.default && typeof serialportModule.default.list === 'function') {
    SerialPort = serialportModule.default;
    console.log('使用 default.list 方法');
  } else {
    // 保存整个模块，list 方法在 SerialPort 类上
    SerialPort = serialportModule.SerialPort || serialportModule;
    console.log('使用 SerialPort 类');
  }
  
  console.log('最终 SerialPort 类型:', typeof SerialPort);
  console.log('最终 SerialPort.list 类型:', typeof SerialPort?.list);
  console.log('最终 ReadlineParser 类型:', typeof ReadlineParser);
} catch (error) {
  console.error('SerialPort 模块加载失败:', error);
  console.error('错误详情:', error.message);
  console.error('错误堆栈:', error.stack);
  // 创建一个假的 SerialPort 以便应用能启动
  SerialPort = {
    list: async () => {
      throw new Error('SerialPort 模块未正确加载: ' + error.message);
    }
  };
}

let mainWindow;
let serialPort = null;
let parser = null;
let teeStream = null;
let timedSendInterval = null;
let timedSendCount = 0;
let timedSendMax = 0;

// TCP/UDP 状态
let tcpServer = null;
let tcpServerClients = [];
let tcpClient = null;
let udpSocket = null;
let udpRemoteHost = '';
let udpRemotePort = 0;

// 原始字节缓冲区（供协议解析器使用）
let rawBuffer = Buffer.alloc(0);
const RAW_BUFFER_MAX = 65536;

// 将串口原始字节转发到网络
function forwardRawToNetwork(chunk) {
  if (tcpServer) {
    for (const client of tcpServerClients.filter(c => !c.destroyed)) {
      try { client.write(chunk); } catch (e) { /* ignore */ }
    }
  }
  if (tcpClient && !tcpClient.destroyed) {
    try { tcpClient.write(chunk); } catch (e) { /* ignore */ }
  }
  if (udpSocket && udpRemoteHost && udpRemotePort > 0) {
    try { udpSocket.send(chunk, udpRemotePort, udpRemoteHost); } catch (e) { /* ignore */ }
  }
}

// TeeStream: 在不打断管道的前提下侦听原始字节
class TeeStream extends Transform {
  constructor(onChunk) {
    super();
    this.onChunk = onChunk;
  }
  _transform(chunk, encoding, callback) {
    this.onChunk(chunk);
    this.push(chunk);
    callback();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#f5f5f5',
    icon: path.join(__dirname, 'mcpiotLogo_b.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true
    }
  });

  mainWindow.loadFile('index.html');

  // 开发模式下打开开发者工具
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (tcpServer) {
    for (const c of tcpServerClients) { try { c.destroy(); } catch (e) { /* ignore */ } }
    tcpServer.close();
  }
  if (tcpClient) { try { tcpClient.destroy(); } catch (e) { /* ignore */ } }
  if (udpSocket) { try { udpSocket.close(); } catch (e) { /* ignore */ } }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 获取串口列表
ipcMain.handle('get-serial-ports', async () => {
  try {
    console.log('开始获取串口列表...');
    console.log('SerialPort 对象:', SerialPort);
    console.log('SerialPort.list 类型:', typeof SerialPort?.list);
    
    if (!SerialPort) {
      throw new Error('SerialPort 对象不存在');
    }
    
    let ports;
    if (typeof SerialPort.list === 'function') {
      ports = await SerialPort.list();
    } else {
      console.error('SerialPort.list 不是函数，尝试重新加载模块...');
      // 尝试重新加载
      try {
        const serialportModule = require('serialport');
        if (serialportModule.SerialPort && typeof serialportModule.SerialPort.list === 'function') {
          ports = await serialportModule.SerialPort.list();
          console.log('使用 SerialPort.list 成功');
        } else if (typeof serialportModule.list === 'function') {
          ports = await serialportModule.list();
          console.log('使用 serialportModule.list 成功');
        } else {
          throw new Error('SerialPort.list 方法不存在');
        }
      } catch (retryError) {
        throw new Error('SerialPort.list 方法不可用: ' + retryError.message);
      }
    }
    console.log('获取到串口数量:', ports.length);
    
    if (ports && ports.length > 0) {
      console.log('串口列表:', ports.map(p => p.path).join(', '));
    }
    
    const portList = ports.map(port => {
      const portInfo = {
        path: port.path,
        manufacturer: port.manufacturer || '',
        friendlyName: port.friendlyName || port.displayName || '',
        serialNumber: port.serialNumber || '',
        pnpId: port.pnpId || '',
        vendorId: port.vendorId || '',
        productId: port.productId || ''
      };
      return portInfo;
    });
    
    return { success: true, ports: portList };
  } catch (error) {
    console.error('获取串口列表失败:', error);
    console.error('错误堆栈:', error.stack);
    return { 
      success: false, 
      ports: [], 
      error: error.message || String(error) 
    };
  }
});

// 打开串口
ipcMain.handle('open-serial-port', async (event, options) => {
  try {
    if (serialPort && serialPort.isOpen) {
      await closeSerialPort();
    }

    serialPort = new SerialPort({
      path: options.path,
      baudRate: options.baudRate || 9600,
      dataBits: options.dataBits || 8,
      stopBits: options.stopBits || 1,
      parity: options.parity || 'none',
      autoOpen: false
    });

    teeStream = new TeeStream((chunk) => {
      rawBuffer = Buffer.concat([rawBuffer, chunk]);
      if (rawBuffer.length > RAW_BUFFER_MAX) {
        rawBuffer = rawBuffer.slice(rawBuffer.length - RAW_BUFFER_MAX);
      }
      forwardRawToNetwork(chunk);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('raw-serial-data', Array.from(chunk));
      }
    });
    serialPort.pipe(teeStream);
    parser = teeStream.pipe(new ReadlineParser({ delimiter: '\n' }));

    parser.on('data', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('serial-data', data.toString());
      }
    });

    serialPort.on('error', (error) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('serial-error', error.message);
      }
    });

    serialPort.on('close', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('serial-closed');
      }
    });

    return new Promise((resolve, reject) => {
      serialPort.open((error) => {
        if (error) {
          reject(error);
        } else {
          resolve({ success: true });
        }
      });
    });
  } catch (error) {
    throw error;
  }
});

// 关闭串口
async function closeSerialPort() {
  return new Promise((resolve) => {
    if (parser) {
      parser.destroy();
      parser = null;
    }
    if (teeStream) {
      teeStream.destroy();
      teeStream = null;
    }
    if (serialPort) {
      if (serialPort.isOpen) {
        serialPort.close(() => {
          serialPort = null;
          resolve();
        });
      } else {
        serialPort = null;
        resolve();
      }
    } else {
      resolve();
    }
  });
}

ipcMain.handle('close-serial-port', async () => {
  await closeSerialPort();
  return { success: true };
});

// 发送数据
ipcMain.handle('write-serial-port', async (event, data, isHex) => {
  try {
    if (!serialPort || !serialPort.isOpen) {
      throw new Error('串口未打开');
    }

    let buffer;
    if (isHex) {
      // 处理十六进制字符串，移除空格
      const hexString = data.replace(/\s+/g, '');
      if (hexString.length % 2 !== 0) {
        throw new Error('十六进制数据长度必须是偶数');
      }
      buffer = Buffer.from(hexString, 'hex');
    } else {
      buffer = Buffer.from(data, 'utf8');
    }

    return new Promise((resolve, reject) => {
      serialPort.write(buffer, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve({ success: true });
        }
      });
    });
  } catch (error) {
    throw error;
  }
});

// 修改波特率
ipcMain.handle('set-baud-rate', async (_event, baudRate) => {
  if (!serialPort || !serialPort.isOpen) {
    return { success: false, error: '串口未打开' };
  }
  const rate = parseInt(baudRate);
  if (!rate || rate <= 0) {
    return { success: false, error: '无效的波特率' };
  }
  return new Promise((resolve) => {
    serialPort.update({ baudRate: rate }, (err) => {
      if (err) resolve({ success: false, error: err.message });
      else resolve({ success: true });
    });
  });
});

// 定时发送
ipcMain.handle('timed-send', async (_event, { action, data, isHex, intervalMs, count }) => {
  if (action === 'stop') {
    if (timedSendInterval) {
      clearInterval(timedSendInterval);
      timedSendInterval = null;
    }
    return { success: true, message: '定时发送已停止' };
  }

  // action === 'start'
  if (!serialPort || !serialPort.isOpen) {
    return { success: false, error: '串口未打开，请先打开串口' };
  }
  if (!data) {
    return { success: false, error: '未提供发送数据' };
  }

  if (timedSendInterval) {
    clearInterval(timedSendInterval);
    timedSendInterval = null;
  }

  timedSendCount = 0;
  timedSendMax = count || 0;
  const interval = Math.max(100, parseInt(intervalMs) || 1000);

  const doSend = () => {
    if (!serialPort || !serialPort.isOpen) {
      clearInterval(timedSendInterval);
      timedSendInterval = null;
      return;
    }
    try {
      let buffer;
      if (isHex) {
        const hex = data.replace(/\s+/g, '');
        buffer = Buffer.from(hex, 'hex');
      } else {
        buffer = Buffer.from(data, 'utf8');
      }
      serialPort.write(buffer);
      timedSendCount++;
    } catch (e) {
      console.error('定时发送失败:', e);
    }
    if (timedSendMax > 0 && timedSendCount >= timedSendMax) {
      clearInterval(timedSendInterval);
      timedSendInterval = null;
    }
  };

  timedSendInterval = setInterval(doSend, interval);
  const msg = `定时发送已启动，间隔 ${interval}ms` + (timedSendMax ? `，共 ${timedSendMax} 次` : '，持续发送');
  return { success: true, message: msg };
});

// 获取串口日志内容（供 webview 使用）
ipcMain.handle('get-serial-log', async (event) => {
  // 从主窗口的 renderer 进程获取串口日志
  // 由于串口日志存储在 renderer 进程中，需要通过主窗口转发
  if (mainWindow && !mainWindow.isDestroyed()) {
    return new Promise((resolve) => {
      // 向 renderer 进程请求串口日志
      mainWindow.webContents.send('request-serial-log');
      // 监听 renderer 进程的响应
      const responseHandler = (event, content) => {
        ipcMain.removeListener('serial-log-response', responseHandler);
        clearTimeout(timeoutId);
        resolve(content || '');
      };
      ipcMain.on('serial-log-response', responseHandler);
      // 设置超时，避免永久等待
      const timeoutId = setTimeout(() => {
        ipcMain.removeListener('serial-log-response', responseHandler);
        resolve('');
      }, 2000);
    });
  }
  return '';
});

// 读取多指令组列表
ipcMain.handle('get-multi-cmds', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return new Promise((resolve) => {
      mainWindow.webContents.send('request-multi-cmds');
      const responseHandler = (_event, items) => {
        ipcMain.removeListener('multi-cmds-response', responseHandler);
        clearTimeout(timeoutId);
        resolve(items || []);
      };
      ipcMain.on('multi-cmds-response', responseHandler);
      const timeoutId = setTimeout(() => {
        ipcMain.removeListener('multi-cmds-response', responseHandler);
        resolve([]);
      }, 2000);
    });
  }
  return [];
});

// 写入多指令组列表
ipcMain.handle('set-multi-cmds', async (_event, items) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('set-multi-cmds-data', items);
    return { success: true };
  }
  return { success: false, error: '主窗口不可用' };
});

// 处理从AI页面发送来的内容，添加到发送框
ipcMain.on('add-to-send-box', (event, data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('add-to-send-box', data);
  }
});

// 窗口控制
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) {
    closeSerialPort().then(() => {
      mainWindow.close();
    });
  }
});

// 设置窗口置顶
ipcMain.on('set-always-on-top', (event, flag) => {
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(flag);
  }
});

// 保存文件对话框
ipcMain.handle('save-file-dialog', async (event, defaultPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath || 'data.txt',
    filters: [
      { name: '文本文件', extensions: ['txt'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  return result;
});

// 打开文件对话框
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: '文本文件', extensions: ['txt'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  return result;
});

// 读取文件内容
ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const fs = require('fs');
    const content = fs.readFileSync(filePath, 'utf8');
    return { success: true, content: content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 保存文件内容
ipcMain.handle('write-file', async (event, filePath, content) => {
  try {
    const fs = require('fs');
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 追加内容到文件
ipcMain.handle('append-file', async (event, filePath, content) => {
  try {
    const fs = require('fs');
    fs.appendFileSync(filePath, content, 'utf8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 获取当前工作目录
ipcMain.handle('get-current-directory', async () => {
  return process.cwd();
});

// 在程序内部窗口打开帮助页面
let helpWindow = null;
ipcMain.handle('open-help', async () => {
  if (helpWindow && !helpWindow.isDestroyed()) {
    helpWindow.focus();
    return;
  }
  helpWindow = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    title: 'AI串口调试工具 — 使用手册',
    icon: path.join(__dirname, 'mcpiotLogo_b.png'),
    parent: mainWindow,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  helpWindow.setMenu(null);
  helpWindow.loadFile(path.join(__dirname, 'help.html'));
  helpWindow.on('closed', () => { helpWindow = null; });
});

// 生成设备号（基于系统信息，保持不变）
function generateDeviceId() {
  try {
    const configPath = path.join(process.cwd(), 'config.ini');
    // 先尝试从配置文件读取已保存的设备号
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      const deviceIdMatch = content.match(/device_id\s*=\s*(.+)/i);
      if (deviceIdMatch && deviceIdMatch[1]) {
        return deviceIdMatch[1].trim();
      }
    }
    
    // 如果没有保存的设备号，生成一个新的
    const systemInfo = {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      cpus: os.cpus().map(cpu => cpu.model).join('|'),
      totalmem: os.totalmem()
    };
    
    const infoString = JSON.stringify(systemInfo);
    const deviceId = crypto.createHash('md5').update(infoString).digest('hex');
    
    // 保存到配置文件
    let configContent = '';
    if (fs.existsSync(configPath)) {
      configContent = fs.readFileSync(configPath, 'utf8');
      if (!configContent.includes('[device_id]') && !configContent.match(/device_id\s*=/i)) {
        configContent += `\ndevice_id=${deviceId}\n`;
      } else {
        configContent = configContent.replace(/device_id\s*=.*/i, `device_id=${deviceId}`);
      }
    } else {
      configContent = `device_id=${deviceId}\n`;
    }
    fs.writeFileSync(configPath, configContent, 'utf8');
    
    return deviceId;
  } catch (error) {
    console.error('生成设备号失败:', error);
    // 如果失败，返回一个基于时间的临时ID
    return crypto.createHash('md5').update(Date.now().toString()).digest('hex');
  }
}

// 读取配置文件
function readConfig() {
  try {
    const configPath = path.join(process.cwd(), 'config.ini');
    if (!fs.existsSync(configPath)) {
      return { device_id: generateDeviceId(), userid: '', log: '0' };
    }
    
    const content = fs.readFileSync(configPath, 'utf8');
    const config = {
      device_id: '',
      userid: '',
      log: '0' // 默认不显示日志
    };
    
    // 解析 device_id
    const deviceIdMatch = content.match(/device_id\s*=\s*(.+)/i);
    if (deviceIdMatch && deviceIdMatch[1]) {
      config.device_id = deviceIdMatch[1].trim();
    } else {
      config.device_id = generateDeviceId();
    }
    
    // 解析 userid
    const useridMatch = content.match(/userid\s*=\s*(.+)/i);
    if (useridMatch && useridMatch[1]) {
      config.userid = useridMatch[1].trim();
    }
    
    // 解析 log 配置
    const logMatch = content.match(/log\s*=\s*(\d+)/i);
    if (logMatch && logMatch[1]) {
      config.log = logMatch[1].trim();
    }
    
    return config;
  } catch (error) {
    console.error('读取配置文件失败:', error);
    return { device_id: generateDeviceId(), userid: '', log: '0' };
  }
}

// 写入配置文件
function writeConfig(config) {
  try {
    const configPath = path.join(process.cwd(), 'config.ini');
    let content = '';
    
    if (fs.existsSync(configPath)) {
      content = fs.readFileSync(configPath, 'utf8');
    }
    
    // 更新或添加 device_id
    if (config.device_id) {
      if (content.match(/device_id\s*=/i)) {
        content = content.replace(/device_id\s*=.*/i, `device_id=${config.device_id}`);
      } else {
        content += `\ndevice_id=${config.device_id}\n`;
      }
    }
    
    // 更新或添加 userid
    if (config.userid !== undefined) {
      if (content.match(/userid\s*=/i)) {
        content = content.replace(/userid\s*=.*/i, `userid=${config.userid}`);
      } else {
        content += `\nuserid=${config.userid}\n`;
      }
    }
    
    fs.writeFileSync(configPath, content, 'utf8');
    return { success: true };
  } catch (error) {
    console.error('写入配置文件失败:', error);
    return { success: false, error: error.message };
  }
}

// 读取AI服务配置
ipcMain.handle('get-ai-config', async () => {
  const configPath = path.join(process.cwd(), 'config.ini');
  const config = { ai_mode: 'builtin', ai_api_url: '', ai_api_key: '', ai_model: '' };
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      const modeMatch = content.match(/ai_mode\s*=\s*(.+)/i);
      if (modeMatch) config.ai_mode = modeMatch[1].trim();
      const urlMatch = content.match(/ai_api_url\s*=\s*(.*)/i);
      if (urlMatch) config.ai_api_url = urlMatch[1].trim();
      const keyMatch = content.match(/ai_api_key\s*=\s*(.*)/i);
      if (keyMatch) config.ai_api_key = keyMatch[1].trim();
      const modelMatch = content.match(/ai_model\s*=\s*(.*)/i);
      if (modelMatch) config.ai_model = modelMatch[1].trim();
    }
  } catch (error) {
    console.error('读取AI配置失败:', error);
  }
  return config;
});

// 保存AI服务配置
ipcMain.handle('save-ai-config', async (event, aiConfig) => {
  try {
    const configPath = path.join(process.cwd(), 'config.ini');
    let content = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
    const fields = ['ai_mode', 'ai_api_url', 'ai_api_key', 'ai_model'];
    for (const field of fields) {
      const value = aiConfig[field] !== undefined ? aiConfig[field] : '';
      if (new RegExp(`${field}\\s*=`, 'i').test(content)) {
        content = content.replace(new RegExp(`${field}\\s*=.*`, 'i'), `${field}=${value}`);
      } else {
        content += `\n${field}=${value}`;
      }
    }
    fs.writeFileSync(configPath, content, 'utf8');
    return { success: true };
  } catch (error) {
    console.error('保存AI配置失败:', error);
    return { success: false, error: error.message };
  }
});

// 获取设备号和用户ID
ipcMain.handle('get-device-info', async () => {
  const config = readConfig();
  // 确保设备号存在
  if (!config.device_id) {
    config.device_id = generateDeviceId();
  }
  return config;
});

// 保存用户ID到配置文件
ipcMain.handle('save-userid', async (event, userid) => {
  const config = readConfig();
  config.userid = userid;
  return writeConfig(config);
});

// 生成 Word 文档（.docx）
ipcMain.handle('generate-docx', async (_event, { filename, title, content }) => {
  try {
    const {
      Document, Packer, Paragraph, TextRun,
      HeadingLevel, AlignmentType
    } = require('docx');

    const children = [];

    // 文档标题
    if (title && title.trim()) {
      children.push(new Paragraph({
        text: title.trim(),
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 }
      }));
    }

    // 按行解析 Markdown 子集
    const lines = content.split('\n');
    for (const raw of lines) {
      const line = raw.trimEnd();

      if (line.startsWith('### ')) {
        children.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3 }));
      } else if (line.startsWith('## ')) {
        children.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 }));
      } else if (line.startsWith('# ')) {
        children.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 }));
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        children.push(new Paragraph({
          children: parseBoldRuns(line.slice(2), TextRun),
          bullet: { level: 0 }
        }));
      } else if (/^\d+\.\s/.test(line)) {
        const text = line.replace(/^\d+\.\s/, '');
        children.push(new Paragraph({
          children: parseBoldRuns(text, TextRun),
          numbering: { reference: 'numbered-list', level: 0 }
        }));
      } else if (line.trim() === '') {
        children.push(new Paragraph({ text: '' }));
      } else {
        children.push(new Paragraph({ children: parseBoldRuns(line, TextRun) }));
      }
    }

    const doc = new Document({
      numbering: {
        config: [{
          reference: 'numbered-list',
          levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.LEFT }]
        }]
      },
      sections: [{ children }]
    });

    const buffer = await Packer.toBuffer(doc);
    const saveName = (filename || '文档').replace(/[\\/:*?"<>|]/g, '_');
    const docsDir = path.join(process.cwd(), 'docs');
    if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
    const savePath = path.join(docsDir, `${saveName}.docx`);
    fs.writeFileSync(savePath, buffer);
    return { success: true, path: savePath };
  } catch (error) {
    console.error('生成docx失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-file', async (_event, filePath) => {
  await shell.openPath(filePath);
});

// ── TCP/UDP 转发 ──────────────────────────────────────────────

ipcMain.handle('start-tcp-server', async (event, { port }) => {
  try {
    if (tcpServer) {
      for (const c of tcpServerClients) { try { c.destroy(); } catch (e) { /* ignore */ } }
      tcpServerClients = [];
      await new Promise(res => tcpServer.close(res));
      tcpServer = null;
    }
    return new Promise((resolve, reject) => {
      tcpServer = net.createServer((socket) => {
        tcpServerClients.push(socket);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('tcp-event', { type: 'client-connected', info: `${socket.remoteAddress}:${socket.remotePort}` });
        }
        socket.on('data', (data) => {
          if (serialPort && serialPort.isOpen) { serialPort.write(data); }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('network-data', {
              source: `TCP服务[${socket.remoteAddress}:${socket.remotePort}]`,
              hex: Array.from(data).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
            });
          }
        });
        socket.on('close', () => {
          tcpServerClients = tcpServerClients.filter(c => c !== socket);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tcp-event', { type: 'client-disconnected', info: `${socket.remoteAddress}:${socket.remotePort}` });
          }
        });
        socket.on('error', err => console.error('TCP客户端错误:', err.message));
      });
      tcpServer.listen(port, '0.0.0.0', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('tcp-event', { type: 'server-started', info: String(port) });
        }
        resolve({ success: true, message: `TCP服务器已启动，监听端口 ${port}` });
      });
      tcpServer.on('error', err => { tcpServer = null; reject(new Error(err.message)); });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-tcp-server', async () => {
  if (tcpServer) {
    for (const c of tcpServerClients) { try { c.destroy(); } catch (e) { /* ignore */ } }
    tcpServerClients = [];
    return new Promise((resolve) => {
      tcpServer.close(() => {
        tcpServer = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('tcp-event', { type: 'server-stopped', info: '' });
        }
        resolve({ success: true });
      });
    });
  }
  return { success: true };
});

ipcMain.handle('start-tcp-client', async (event, { host, port }) => {
  if (tcpClient) { try { tcpClient.destroy(); } catch (e) { /* ignore */ } tcpClient = null; }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (tcpClient) { tcpClient.destroy(); tcpClient = null; }
      reject(new Error('连接超时'));
    }, 5000);
    tcpClient = net.createConnection({ host, port }, () => {
      clearTimeout(timer);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tcp-event', { type: 'client-connected', info: `${host}:${port}` });
      }
      resolve({ success: true, message: `已连接到 ${host}:${port}` });
    });
    tcpClient.on('data', (data) => {
      if (serialPort && serialPort.isOpen) { serialPort.write(data); }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('network-data', {
          source: `TCP客户端[${host}:${port}]`,
          hex: Array.from(data).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
        });
      }
    });
    tcpClient.on('close', () => {
      tcpClient = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tcp-event', { type: 'client-disconnected', info: '' });
      }
    });
    tcpClient.on('error', (err) => {
      clearTimeout(timer);
      tcpClient = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tcp-event', { type: 'error', info: err.message });
      }
      reject(new Error(err.message));
    });
  });
});

ipcMain.handle('stop-tcp-client', async () => {
  if (tcpClient) {
    try { tcpClient.destroy(); } catch (e) { /* ignore */ }
    tcpClient = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tcp-event', { type: 'client-disconnected', info: '' });
    }
  }
  return { success: true };
});

ipcMain.handle('start-udp', async (event, { localPort, remoteHost, remotePort }) => {
  if (udpSocket) { try { udpSocket.close(); } catch (e) { /* ignore */ } udpSocket = null; }
  return new Promise((resolve, reject) => {
    udpSocket = dgram.createSocket('udp4');
    udpRemoteHost = remoteHost;
    udpRemotePort = parseInt(remotePort);
    udpSocket.on('message', (msg, rinfo) => {
      if (serialPort && serialPort.isOpen) { serialPort.write(msg); }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('network-data', {
          source: `UDP[${rinfo.address}:${rinfo.port}]`,
          hex: Array.from(msg).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
        });
      }
    });
    udpSocket.on('error', (err) => {
      udpSocket = null; udpRemoteHost = ''; udpRemotePort = 0;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('udp-event', { type: 'error', info: err.message });
      }
      reject(new Error(err.message));
    });
    udpSocket.bind(parseInt(localPort), () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('udp-event', {
          type: 'started', info: `本地:${localPort} → ${remoteHost}:${remotePort}`
        });
      }
      resolve({ success: true, message: `UDP已启动，本地端口 ${localPort}，目标 ${remoteHost}:${remotePort}` });
    });
  });
});

ipcMain.handle('stop-udp', async () => {
  if (udpSocket) {
    try { udpSocket.close(); } catch (e) { /* ignore */ }
    udpSocket = null; udpRemoteHost = ''; udpRemotePort = 0;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('udp-event', { type: 'stopped', info: '' });
    }
  }
  return { success: true };
});

// 获取原始字节缓冲区（十六进制）
ipcMain.handle('get-raw-buffer', async (event, { maxBytes = 4096 } = {}) => {
  if (!rawBuffer || rawBuffer.length === 0) return '';
  const len = Math.min(maxBytes, rawBuffer.length);
  const slice = rawBuffer.subarray(rawBuffer.length - len);
  return Array.from(slice).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
});

ipcMain.handle('clear-raw-buffer', async () => {
  rawBuffer = Buffer.alloc(0);
  return { success: true };
});

// 帧规则持久化
ipcMain.handle('get-frame-rule', async () => {
  try {
    const configPath = path.join(process.cwd(), 'config.ini');
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      const match = content.match(/frame_rule\s*=\s*(.*)/i);
      if (match && match[1].trim()) return JSON.parse(decodeURIComponent(match[1].trim()));
    }
  } catch (e) { console.error('读取帧规则失败:', e); }
  return null;
});

ipcMain.handle('save-frame-rule', async (event, rule) => {
  try {
    const configPath = path.join(process.cwd(), 'config.ini');
    let content = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
    const encoded = encodeURIComponent(JSON.stringify(rule));
    if (/frame_rule\s*=/i.test(content)) {
      content = content.replace(/frame_rule\s*=.*/i, `frame_rule=${encoded}`);
    } else {
      content += `\nframe_rule=${encoded}`;
    }
    fs.writeFileSync(configPath, content, 'utf8');
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// AI 发送 apply-frame-rule 给 webview → 转发给主渲染进程
ipcMain.on('apply-frame-rule', (event, rule) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('apply-frame-rule', rule);
  }
});

// ── 解析行内 **加粗** 标记，返回 TextRun 数组
function parseBoldRuns(text, TextRun) {
  const runs = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true }));
    } else if (part) {
      runs.push(new TextRun({ text: part }));
    }
  }
  return runs.length ? runs : [new TextRun({ text: '' })];
}

