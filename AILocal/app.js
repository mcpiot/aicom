function initApp() {
  if (typeof Vue === 'undefined') {
    console.error('Vue 未加载，1秒后重试...');
    setTimeout(initApp, 1000);
    return;
  }

  const { createApp } = Vue;

  createApp({
    data() {
      return {
        messages: [],
        inputText: '',
        isLoading: false,
        maxContextLength: 8192,
        logoUrl: '../mcpiotLogo_b.png',
        // 本地API配置（从 config.ini 通过 IPC 加载）
        localApiUrl: '',
        localApiKey: '',
        localModel: '',
        configLoaded: false,
        configError: '',
        agentMode: true,
        agentMaxIterations: 8,
        lang: 'zh'
      };
    },

    methods: {
      async sendMessage() {
        if (!this.inputText.trim() || this.isLoading || !this.configLoaded) return;
        if (!this.localApiUrl) {
          alert(this.t('alertApiNotConfig'));
          return;
        }

        let userMessage = this.inputText.trim();
        this.inputText = '';

        // Agent 模式：跳过串口日志注入，AI 通过工具自主获取
        if (this.agentMode) {
          this.messages.push({ role: 'user', content: userMessage, timestamp: new Date() });
          this.$nextTick(() => this.scrollToBottom());
          this.isLoading = true;
          try {
            await this.runAgentLoop();
          } catch (error) {
            this.messages.push({ role: 'assistant', content: `${this.t('errPrefix')}${error.message}`, timestamp: new Date() });
            this.$nextTick(() => this.scrollToBottom());
          } finally {
            this.isLoading = false;
          }
          return;
        }

        // 检测是否包含"串口日志"或"接收内容"
        const hasSerialLogKeyword = userMessage.includes('串口日志') || userMessage.includes('接收内容');

        if (hasSerialLogKeyword) {
          try {
            let serialLog = await this.getSerialLog();
            if (serialLog && serialLog.trim()) {
              const userMessageLength = userMessage.length;
              const logPrefix = '\n\n【串口接收内容】\n';
              const prefixLength = logPrefix.length;
              const availableLength = this.maxContextLength - userMessageLength - prefixLength;

              if (serialLog.length > availableLength) {
                const noticeText = '【注意：日志内容已裁剪，仅显示最新部分】\n';
                const actualAvailableLength = availableLength - noticeText.length;
                if (actualAvailableLength > 0) {
                  serialLog = noticeText + serialLog.slice(-actualAvailableLength);
                } else {
                  serialLog = noticeText + '（日志内容过长，已全部裁剪）';
                }
              }

              userMessage += logPrefix + serialLog;

              if (userMessage.length > this.maxContextLength) {
                userMessage = '【注意：内容已裁剪，仅显示最新部分】\n' + userMessage.slice(-this.maxContextLength);
                if (userMessage.length > this.maxContextLength) {
                  userMessage = userMessage.slice(-this.maxContextLength);
                }
              }
            } else {
              userMessage += '\n\n【提示：当前没有串口接收内容】';
            }
          } catch (error) {
            console.warn('获取串口日志失败:', error);
            userMessage += '\n\n【提示：获取串口日志失败】';
          }
        } else {
          if (userMessage.length > this.maxContextLength) {
            userMessage = '【注意：消息内容已裁剪，仅显示最新部分】\n' + userMessage.slice(-this.maxContextLength);
          }
        }

        this.messages.push({ role: 'user', content: userMessage, timestamp: new Date() });
        this.$nextTick(() => this.scrollToBottom());

        this.isLoading = true;
        const assistantMessageIndex = this.messages.length;
        this.messages.push({ role: 'assistant', content: '', timestamp: new Date() });
        this.$nextTick(() => this.scrollToBottom());

        try {
          const messageHistory = this.messages.slice(0, assistantMessageIndex).map(m => ({
            role: m.role,
            content: m.content
          }));

          // 追加系统提示词
          if (messageHistory.length > 0) {
            const lastMessage = messageHistory[messageHistory.length - 1];
            if (lastMessage.role === 'user') {
              lastMessage.content += this.t('normalSystemPrompt');
            }
          }

          await this.streamToMessage(messageHistory, assistantMessageIndex);

          if (!this.messages[assistantMessageIndex].content.trim()) {
            this.messages[assistantMessageIndex].content = this.t('noReply');
          }

          this.$nextTick(() => {
            this.scrollToBottom();
            this.processLastCodeBlock(this.messages[assistantMessageIndex].content);
          });

        } catch (error) {
          console.error('发送消息失败:', error);
          if (this.messages[assistantMessageIndex] && !this.messages[assistantMessageIndex].content) {
            this.messages[assistantMessageIndex].content = `${this.t('errPrefix')}${error.message}`;
          } else {
            this.messages.push({ role: 'assistant', content: `${this.t('errPrefix')}${error.message}`, timestamp: new Date() });
          }
          this.$nextTick(() => this.scrollToBottom());
        } finally {
          this.isLoading = false;
        }
      },

      t(key) {
        const dict = (i18nAI && i18nAI[this.lang]) || (i18nAI && i18nAI.zh) || {};
        return dict[key] || (i18nAI && i18nAI.zh && i18nAI.zh[key]) || key;
      },

      scrollToBottom() {
        const contentArea = this.$refs.contentArea;
        if (contentArea) contentArea.scrollTop = contentArea.scrollHeight;
      },

      formatMessage(content) {
        let formatted = content;
        const codeBlockPlaceholder = '___CODE_BLOCK_PLACEHOLDER___';
        const codeBlocks = [];
        let placeholderIndex = 0;

        const pushCodeBlock = (cleanCode) => {
          const escapedCode = this.escapeHtml(cleanCode);
          const codeId = `code-block-${Date.now()}-${placeholderIndex}`;
          const svgIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2" fill="none"/></svg>`;
          codeBlocks.push({
            id: codeId,
            html: `<div class="code-block-wrapper"><pre class="code-block" id="${codeId}"><code>${escapedCode}</code></pre><button class="code-copy-btn" onclick="window.copyCodeToClipboard('${codeId}', \`${this.escapeForTemplate(cleanCode)}\`)" title="${this.t('copyCodeTitle')}">${svgIcon}</button></div>`,
            code: cleanCode
          });
          return `${codeBlockPlaceholder}${placeholderIndex++}${codeBlockPlaceholder}`;
        };

        // 三反引号代码块（去掉语言标识符行，如 ```hex、```text）
        formatted = formatted.replace(/```([\s\S]*?)```/g, (_match, code) => {
          let cleanCode = code.replace(/^\n+|\n+$/g, '');
          cleanCode = cleanCode.replace(/^[a-zA-Z][a-zA-Z0-9_+\-#]*\n/, '');
          return pushCodeBlock(cleanCode);
        });

        // 独立行的十六进制字节序列（如 "03 01 00 00 00 01 0A 84"），自动包装为代码块
        formatted = formatted.replace(
          /^[ \t]*([0-9A-Fa-f]{2}(?:[ \t]+[0-9A-Fa-f]{2}){2,})[ \t]*$/gm,
          (_match, hexStr) => pushCodeBlock(hexStr.trim())
        );

        formatted = formatted.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
        formatted = formatted.replace(/\n/g, '<br>');

        codeBlocks.forEach((codeBlock, index) => {
          formatted = formatted.replace(`${codeBlockPlaceholder}${index}${codeBlockPlaceholder}`, codeBlock.html);
        });

        return formatted;
      },

      escapeForTemplate(text) {
        return text
          .replace(/\\/g, '\\\\')
          .replace(/`/g, '\\`')
          .replace(/\$/g, '\\$');
      },

      escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      },

      processLastCodeBlock(content) {
        if (!content) return;

        // 从三反引号代码块提取（去掉语言标识符行）
        const codeBlockRegex = /```([\s\S]*?)```/g;
        const matches = [];
        let match;
        while ((match = codeBlockRegex.exec(content)) !== null) {
          let code = match[1].replace(/^\n+|\n+$/g, '');
          code = code.replace(/^[a-zA-Z][a-zA-Z0-9_+\-#]*\n/, '');
          if (code.trim()) matches.push(code.trim());
        }

        // 无代码块时，回退到独立行十六进制序列
        if (matches.length === 0) {
          const hexLineRegex = /^[ \t]*([0-9A-Fa-f]{2}(?:[ \t]+[0-9A-Fa-f]{2}){2,})[ \t]*$/gm;
          while ((match = hexLineRegex.exec(content)) !== null) {
            matches.push(match[1].trim());
          }
        }

        if (matches.length === 0) return;

        let processedCode = matches[matches.length - 1];
        processedCode = processedCode.replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();

        const hasHex = /HEX|十六进制/i.test(content) ||
          /^[0-9A-Fa-f]{2}(?:[ \t]+[0-9A-Fa-f]{2})+$/.test(processedCode);
        if (hasHex) {
          processedCode = processedCode.replace(/0x/gi, '');
        }

        if (typeof require !== 'undefined') {
          try {
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('add-to-send-box', { text: processedCode, enableHex: hasHex });
            return;
          } catch (e) {
            console.warn('IPC 发送失败:', e);
          }
        }
        window.postMessage({ type: 'add-to-send-box', text: processedCode, enableHex: hasHex }, '*');
      },

      formatTime(timestamp) {
        const date = new Date(timestamp);
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
      },

      async copyMessage(message, event) {
        const btn = event.currentTarget;
        try {
          const text = message.content;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-999999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          }
          btn.classList.add('copied');
          const orig = btn.getAttribute('title');
          btn.setAttribute('title', this.t('copiedTitle'));
          setTimeout(() => {
            btn.classList.remove('copied');
            btn.setAttribute('title', orig);
          }, 1500);
        } catch (error) {
          console.error('复制失败:', error);
        }
      },

      // ── SSE 流式请求公共方法 ──────────────────────────────────────
      async streamToMessage(history, msgIdx) {
        const headers = { 'Content-Type': 'application/json' };
        if (this.localApiKey) headers['Authorization'] = `Bearer ${this.localApiKey}`;

        const response = await fetch(this.localApiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: this.localModel, messages: history, stream: true })
        });

        if (!response.ok) {
          let errMsg = `HTTP error! status: ${response.status}`;
          try {
            const d = await response.json();
            errMsg = d.message || d.error?.message || errMsg;
          } catch (e) {
            const t = await response.text();
            if (t) errMsg += ` - ${t}`;
          }
          throw new Error(errMsg);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim() || !line.startsWith('data: ')) continue;
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') continue;
            try {
              const data = JSON.parse(dataStr);
              const content = data.choices?.[0]?.delta?.content;
              if (content) {
                this.messages[msgIdx].content += content;
                this.$nextTick(() => this.scrollToBottom());
              }
            } catch (e) { /* ignore parse errors */ }
          }
        }
        if (buffer.trim()) {
          for (const line of buffer.split('\n\n')) {
            if (!line.trim() || !line.startsWith('data: ') || line === '[DONE]') continue;
            try {
              const data = JSON.parse(line.slice(6));
              const content = data.choices?.[0]?.delta?.content;
              if (content) { this.messages[msgIdx].content += content; }
            } catch (e) { /* ignore */ }
          }
        }
      },

      // ── Agent 模式 ──────────────────────────────────────────────
      buildAgentSystemPrompt() {
        const tools = [
          {
            type: 'function',
            function: {
              name: 'get_serial_log',
              description: '获取当前串口接收缓冲区的全部内容',
              parameters: { type: 'object', properties: {}, required: [] }
            }
          },
          {
            type: 'function',
            function: {
              name: 'send_to_serial',
              description: '向已连接的串口发送数据',
              parameters: {
                type: 'object',
                properties: {
                  data: { type: 'string', description: '要发送的数据内容' },
                  is_hex: { type: 'boolean', description: '是否以十六进制HEX格式发送，默认false' }
                },
                required: ['data']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'open_serial_port',
              description: '列出可用串口或打开指定串口。不传port参数时返回可用串口列表；传入port参数时打开该串口',
              parameters: {
                type: 'object',
                properties: {
                  port:      { type: 'string', description: '串口路径，如 COM3 或 /dev/ttyUSB0；不传则仅列出可用串口' },
                  baud_rate: { type: 'integer', description: '波特率，默认 9600，常用值: 1200/2400/4800/9600/19200/38400/57600/115200' },
                  data_bits: { type: 'integer', description: '数据位，默认 8' },
                  stop_bits: { type: 'integer', description: '停止位，默认 1' },
                  parity:    { type: 'string',  description: '校验位: none/even/odd，默认 none' }
                },
                required: []
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'set_baud_rate',
              description: '修改当前已打开串口的波特率，无需关闭重新打开',
              parameters: {
                type: 'object',
                properties: {
                  baud_rate: { type: 'integer', description: '新波特率，如 115200' }
                },
                required: ['baud_rate']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'timed_send',
              description: '启动或停止定时发送。action为start时按interval_ms间隔反复发送data；action为stop时停止当前定时任务',
              parameters: {
                type: 'object',
                properties: {
                  action:      { type: 'string',  description: 'start 或 stop' },
                  data:        { type: 'string',  description: '要发送的数据（action=start时必填）' },
                  interval_ms: { type: 'integer', description: '发送间隔毫秒数，最小100，默认1000' },
                  is_hex:      { type: 'boolean', description: '是否以HEX格式发送，默认false' },
                  count:       { type: 'integer', description: '发送次数，0或不填表示持续发送' }
                },
                required: ['action']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'get_multi_cmds',
              description: '读取多指令组面板中的所有指令条目，返回完整列表供AI分析或修改',
              parameters: { type: 'object', properties: {}, required: [] }
            }
          },
          {
            type: 'function',
            function: {
              name: 'set_multi_cmds',
              description: '将AI生成的多条指令写入多指令组发送列表（会替换现有内容）。用于批量生成或修改指令序列',
              parameters: {
                type: 'object',
                properties: {
                  items: {
                    type: 'array',
                    description: '指令列表，按顺序写入',
                    items: {
                      type: 'object',
                      properties: {
                        data:     { type: 'string',  description: '指令内容（文本或HEX字符串）' },
                        is_hex:   { type: 'boolean', description: '是否以HEX格式发送，默认false' },
                        order:    { type: 'integer', description: '发送顺序编号，默认按数组下标' },
                        delay_ms: { type: 'integer', description: '发送后延时毫秒，默认1000' }
                      },
                      required: ['data']
                    }
                  }
                },
                required: ['items']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'generate_docx',
              description: '当用户要求将内容整理成文档、生成Word文档、导出报告、保存记录等时使用。将内容生成为.docx格式的Word文档并保存到本地',
              parameters: {
                type: 'object',
                properties: {
                  filename: { type: 'string', description: '文件名（不含扩展名），如"分析报告"、"调试记录"' },
                  title:    { type: 'string', description: '文档标题（可选）' },
                  content:  { type: 'string', description: '文档正文内容，支持Markdown：# 一级标题，## 二级标题，### 三级标题，- 列表项，**加粗**，普通段落直接写' }
                },
                required: ['filename', 'content']
              }
            }
          },
          // ── 协议分析工具 ─────────────────────────────────────
          {
            type: 'function',
            function: {
              name: 'get_raw_buffer',
              description: '获取串口接收的原始字节缓冲区（十六进制），用于协议分析与逆向。比 get_serial_log 更适合分析二进制协议',
              parameters: {
                type: 'object',
                properties: {
                  max_bytes: { type: 'integer', description: '最多返回多少字节，默认 2048，最大 8192' }
                },
                required: []
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'calculate_checksum',
              description: '计算十六进制字节序列的校验值，支持 XOR、SUM8、SUM16、CRC16-Modbus、CRC8',
              parameters: {
                type: 'object',
                properties: {
                  hex_data: { type: 'string', description: '十六进制字节串，如 "AA 55 01 05"' },
                  method:   { type: 'string', description: '校验方式：xor | sum8 | sum16 | crc16_modbus | crc8' }
                },
                required: ['hex_data', 'method']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'save_frame_rule',
              description: '保存协议帧解析规则并立即应用到实时解析器。定义帧头、帧长度/帧尾判断方式和各字段，收到新数据后自动解析显示',
              parameters: {
                type: 'object',
                properties: {
                  name:          { type: 'string',  description: '规则名称，如"自定义协议"' },
                  header:        { type: 'string',  description: '帧头十六进制，如 "AA 55"（必填）' },
                  mode:          { type: 'string',  description: '帧判断模式：fixed（固定长度）| length（长度字段）| delimiter（帧尾标识）' },
                  frame_length:  { type: 'integer', description: 'mode=fixed 时帧总字节数' },
                  length_offset: { type: 'integer', description: 'mode=length 时长度字节相对帧头的偏移' },
                  length_size:   { type: 'integer', description: '长度字段字节数，1 或 2（LE），默认 1' },
                  length_scope:  { type: 'string',  description: '长度含义：data（仅数据）| from_length（从长度字段后）| full（整帧）' },
                  footer:        { type: 'string',  description: 'mode=delimiter 时帧尾十六进制，如 "0D 0A"' },
                  max_frame_len: { type: 'integer', description: '安全最大帧长，默认 512' },
                  fields:        { type: 'string',  description: '字段定义，每行：名称,偏移,长度,类型\n类型：hex|uint8|uint16le|uint16be|ascii\n偏移/长度=-1 表示从末尾/剩余字节' },
                  enabled:       { type: 'boolean', description: '是否立即启用实时解析，默认 true' }
                },
                required: ['header', 'mode']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'get_frame_rule',
              description: '读取当前保存的协议帧解析规则',
              parameters: { type: 'object', properties: {}, required: [] }
            }
          },
          // ── TCP/UDP 转发工具 ──────────────────────────────────
          {
            type: 'function',
            function: {
              name: 'start_tcp_server',
              description: '启动 TCP 服务器，监听指定端口，将收到的数据转发给串口，同时将串口数据发送给所有已连接的 TCP 客户端',
              parameters: {
                type: 'object',
                properties: {
                  port: { type: 'integer', description: '监听端口，如 8888' }
                },
                required: ['port']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'stop_tcp_server',
              description: '停止 TCP 服务器',
              parameters: { type: 'object', properties: {}, required: [] }
            }
          },
          {
            type: 'function',
            function: {
              name: 'start_tcp_client',
              description: '以 TCP 客户端模式连接到远端服务器，实现串口数据与 TCP 的双向桥接',
              parameters: {
                type: 'object',
                properties: {
                  host: { type: 'string',  description: '目标服务器 IP 或域名' },
                  port: { type: 'integer', description: '目标端口' }
                },
                required: ['host', 'port']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'stop_tcp_client',
              description: '断开 TCP 客户端连接',
              parameters: { type: 'object', properties: {}, required: [] }
            }
          },
          {
            type: 'function',
            function: {
              name: 'start_udp',
              description: '启动 UDP 转发：将串口数据发往指定远端 UDP 地址，并将收到的 UDP 数据转发给串口',
              parameters: {
                type: 'object',
                properties: {
                  local_port:  { type: 'integer', description: '本地监听 UDP 端口' },
                  remote_host: { type: 'string',  description: '目标主机 IP' },
                  remote_port: { type: 'integer', description: '目标 UDP 端口' }
                },
                required: ['local_port', 'remote_host', 'remote_port']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'stop_udp',
              description: '停止 UDP 转发',
              parameters: { type: 'object', properties: {}, required: [] }
            }
          }
        ];
        return `${this.t('agentSystemPrompt')}

You have access to the following tools:
<tools>
${JSON.stringify(tools)}
</tools>

For each function call return a json object with function name and arguments within <tool_call></tool_call> XML tags as follows:
<tool_call>
{"name": <function-name>, "arguments": <args-dict>}
</tool_call>

When tool results are provided in <tool_response></tool_response> tags, analyze them and continue toward the user's goal. When you have enough information, provide a clear conclusion without further tool calls.`;
      },

      buildAgentHistory() {
        const history = [{ role: 'system', content: this.buildAgentSystemPrompt() }];
        for (const m of this.messages) {
          if (m.role === 'user' || m.role === 'assistant') {
            history.push({ role: m.role, content: m.content });
          } else if (m.role === 'tool_result') {
            history.push({ role: 'user', content: `<tool_response>\n${m.content}\n</tool_response>` });
          }
          // tool_call messages 跳过（内容已包含在前一条 assistant 消息里）
        }
        return history;
      },

      async runAgentLoop() {
        for (let iter = 0; iter < this.agentMaxIterations; iter++) {
          const history = this.buildAgentHistory();
          const assistantIdx = this.messages.length;
          this.messages.push({ role: 'assistant', content: '', timestamp: new Date() });
          this.$nextTick(() => this.scrollToBottom());

          try {
            await this.streamToMessage(history, assistantIdx);
          } catch (error) {
            this.messages[assistantIdx].content = `${this.t('errPrefix')}${error.message}`;
            break;
          }

          const responseText = this.messages[assistantIdx].content;
          if (!responseText.trim()) {
            this.messages[assistantIdx].content = this.t('noReply');
            break;
          }

          const toolCalls = this.parseToolCalls(responseText);
          if (!toolCalls.length) {
            // 无工具调用 → 最终回复
            this.$nextTick(() => {
              this.scrollToBottom();
              this.processLastCodeBlock(responseText);
            });
            break;
          }

          // 执行工具调用
          for (const tc of toolCalls) {
            this.messages.push({
              role: 'tool_call',
              toolName: tc.name,
              content: Object.keys(tc.arguments || {}).length
                ? JSON.stringify(tc.arguments, null, 2)
                : '',
              timestamp: new Date()
            });

            let result;
            try { result = await this.executeToolCall(tc); }
            catch (e) { result = `${this.t('toolExecErr')}${e.message}`; }

            const resultContent = (result && typeof result === 'object') ? result.content : result;
            const resultMeta   = (result && typeof result === 'object') ? result : {};
            this.messages.push({
              role: 'tool_result',
              toolName: tc.name,
              content: resultContent,
              docPath: resultMeta.docPath || null,
              timestamp: new Date()
            });
            this.$nextTick(() => this.scrollToBottom());
          }
        }
      },

      parseToolCalls(text) {
        const calls = [];
        const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
          try {
            const parsed = JSON.parse(match[1]);
            calls.push({ name: parsed.name || '', arguments: parsed.arguments || parsed.args || {} });
          } catch (e) {
            console.warn('解析 tool_call 失败:', e, match[1]);
          }
        }
        return calls;
      },

      async executeToolCall(tc) {
        switch (tc.name) {
          case 'open_serial_port': {
            const { port, baud_rate = 9600, data_bits = 8, stop_bits = 1, parity = 'none' } = tc.arguments;
            if (typeof require === 'undefined') return '错误: 无法访问IPC';
            const { ipcRenderer } = require('electron');
            if (!port) {
              // 列出可用串口
              const r = await ipcRenderer.invoke('get-serial-ports');
              if (!r.success) return `获取串口列表失败: ${r.error}`;
              if (!r.ports.length) return '未发现可用串口';
              const list = r.ports.map(p => `${p.path}${p.friendlyName ? ' — ' + p.friendlyName : ''}`).join('\n');
              return `可用串口列表:\n${list}`;
            }
            try {
              await ipcRenderer.invoke('open-serial-port', {
                path: port, baudRate: baud_rate,
                dataBits: data_bits, stopBits: stop_bits, parity
              });
              return `串口 ${port} 已打开，波特率 ${baud_rate}`;
            } catch (e) {
              return `打开串口失败: ${e.message}`;
            }
          }
          case 'set_baud_rate': {
            const { baud_rate } = tc.arguments;
            if (typeof require === 'undefined') return '错误: 无法访问IPC';
            const { ipcRenderer } = require('electron');
            const r = await ipcRenderer.invoke('set-baud-rate', baud_rate);
            return r.success ? `波特率已设置为 ${baud_rate}` : `设置波特率失败: ${r.error}`;
          }
          case 'timed_send': {
            const { action, data, interval_ms, is_hex = false, count = 0 } = tc.arguments;
            if (typeof require === 'undefined') return '错误: 无法访问IPC';
            const { ipcRenderer } = require('electron');
            const r = await ipcRenderer.invoke('timed-send', {
              action, data, isHex: is_hex, intervalMs: interval_ms, count
            });
            return r.success ? r.message : `定时发送操作失败: ${r.error}`;
          }
          case 'get_serial_log': {
            const log = await this.getSerialLog().catch(() => '');
            return log || '(串口缓冲区为空)';
          }
          case 'send_to_serial': {
            const data = tc.arguments.data || '';
            const isHex = tc.arguments.is_hex === true;
            if (!data) return '错误: 未提供发送数据';
            if (typeof require !== 'undefined') {
              try {
                const { ipcRenderer } = require('electron');
                await ipcRenderer.invoke('write-serial-port', data, isHex);
                return `发送成功: ${data}${isHex ? ' (HEX)' : ''}`;
              } catch (e) {
                return `发送失败: ${e.message}`;
              }
            }
            return '错误: 无法访问串口（IPC不可用）';
          }
          case 'get_multi_cmds': {
            if (typeof require === 'undefined') return '错误: 无法访问IPC';
            const { ipcRenderer } = require('electron');
            const items = await ipcRenderer.invoke('get-multi-cmds');
            if (!items.length) return '多指令组列表为空';
            const lines = items.map((it, i) =>
              `[${i + 1}] ${it.isHex ? '[HEX]' : '[文本]'} 顺序:${it.order} 延时:${it.delay}ms  ${it.data}`
            ).join('\n');
            return `多指令组共 ${items.length} 条:\n${lines}`;
          }
          case 'set_multi_cmds': {
            const { items } = tc.arguments;
            if (!Array.isArray(items) || !items.length) return '错误: 未提供指令列表';
            if (typeof require === 'undefined') return '错误: 无法访问IPC';
            const { ipcRenderer } = require('electron');
            const payload = items.map((it, idx) => ({
              data:  it.data || '',
              isHex: it.is_hex || false,
              order: it.order !== undefined ? it.order : idx,
              delay: it.delay_ms !== undefined ? it.delay_ms : 1000
            }));
            const r = await ipcRenderer.invoke('set-multi-cmds', payload);
            if (r.success) return `已写入 ${payload.length} 条指令到多指令组列表`;
            return `写入失败: ${r.error}`;
          }
          case 'generate_docx': {
            const { filename = '文档', title = '', content = '' } = tc.arguments;
            if (!content) return '错误: 未提供文档内容';
            if (typeof require !== 'undefined') {
              try {
                const { ipcRenderer } = require('electron');
                const result = await ipcRenderer.invoke('generate-docx', { filename, title, content });
                if (result.success) {
                  return { content: `Word文档已生成并保存至: ${result.path}`, docPath: result.path };
                }
                return `文档生成失败: ${result.error}`;
              } catch (e) {
                return `文档生成失败: ${e.message}`;
              }
            }
            return '错误: 无法访问文件系统（IPC不可用）';
          }
          // ── 协议分析工具 ─────────────────────────────────────
          case 'get_raw_buffer': {
            const maxBytes = tc.arguments.max_bytes || 2048;
            if (typeof require === 'undefined') return '错误: 无法访问IPC';
            const { ipcRenderer } = require('electron');
            const hex = await ipcRenderer.invoke('get-raw-buffer', { maxBytes });
            if (!hex) return '原始缓冲区为空（串口尚未接收到数据）';
            const byteCount = hex.split(' ').length;
            return `原始字节缓冲区 (共 ${byteCount} 字节):\n${hex}`;
          }

          case 'calculate_checksum': {
            const { hex_data, method = 'xor' } = tc.arguments;
            if (!hex_data) return '错误: 未提供 hex_data';
            const bytes = hex_data.replace(/\s+/g, '').match(/.{2}/g)
              ?.map(h => parseInt(h, 16)).filter(b => !isNaN(b)) || [];
            if (!bytes.length) return '错误: 无效的 HEX 数据';
            let result;
            switch (method.toLowerCase()) {
              case 'xor':
                result = bytes.reduce((a, b) => a ^ b, 0);
                break;
              case 'sum8':
                result = bytes.reduce((a, b) => (a + b) & 0xFF, 0);
                break;
              case 'sum16':
                result = bytes.reduce((a, b) => (a + b) & 0xFFFF, 0);
                break;
              case 'crc16_modbus': {
                let crc = 0xFFFF;
                for (const byte of bytes) {
                  crc ^= byte;
                  for (let i = 0; i < 8; i++) crc = (crc & 1) ? ((crc >> 1) ^ 0xA001) : (crc >> 1);
                }
                result = crc;
                break;
              }
              case 'crc8': {
                let crc = 0;
                for (const byte of bytes) {
                  crc ^= byte;
                  for (let i = 0; i < 8; i++) crc = (crc & 0x80) ? (((crc << 1) ^ 0x07) & 0xFF) : ((crc << 1) & 0xFF);
                }
                result = crc;
                break;
              }
              default:
                return `不支持的校验方式: ${method}，可选: xor | sum8 | sum16 | crc16_modbus | crc8`;
            }
            const hexResult = result.toString(16).toUpperCase().padStart(result > 0xFF ? 4 : 2, '0');
            return `${method.toUpperCase()} 校验结果: ${result} (0x${hexResult})\n输入: ${bytes.length} 字节`;
          }

          case 'save_frame_rule': {
            const args = tc.arguments;
            if (!args.header) return '错误: header 为必填参数';
            const rule = {
              name:         args.name         || '自定义协议',
              header:       args.header,
              mode:         args.mode         || 'fixed',
              frameLength:  args.frame_length  !== undefined ? args.frame_length  : 8,
              lengthOffset: args.length_offset !== undefined ? args.length_offset : 2,
              lengthSize:   args.length_size   !== undefined ? args.length_size   : 1,
              lengthScope:  args.length_scope  || 'data',
              footer:       args.footer        || '',
              maxFrameLen:  args.max_frame_len || 512,
              fields:       args.fields        || '',
              enabled:      args.enabled !== false
            };
            if (typeof require === 'undefined') return '错误: 无法访问IPC';
            const { ipcRenderer } = require('electron');
            const result = await ipcRenderer.invoke('save-frame-rule', rule);
            if (result.success) {
              ipcRenderer.send('apply-frame-rule', rule);
              return `帧规则 "${rule.name}" 已保存并应用\n模式: ${rule.mode} | 帧头: ${rule.header}${rule.enabled ? '\n实时解析已启用' : '\n实时解析未启用'}`;
            }
            return `保存失败: ${result.error}`;
          }

          case 'get_frame_rule': {
            if (typeof require === 'undefined') return '错误: 无法访问IPC';
            const { ipcRenderer } = require('electron');
            const rule = await ipcRenderer.invoke('get-frame-rule');
            if (!rule) return '未保存任何帧规则';
            return `当前帧规则: ${rule.name}\n帧头: ${rule.header}\n模式: ${rule.mode}\n${rule.fields ? '字段:\n' + rule.fields : '（未定义字段）'}\n实时解析: ${rule.enabled !== false ? '已启用' : '未启用'}`;
          }

          // ── TCP/UDP 转发工具 ──────────────────────────────────
          case 'start_tcp_server': {
            const { port } = tc.arguments;
            if (!port) return '错误: 未提供 port';
            if (typeof require === 'undefined') return '错误: 无法访问IPC';
            const { ipcRenderer } = require('electron');
            try {
              const r = await ipcRenderer.invoke('start-tcp-server', { port });
              return r.success ? r.message : `启动失败: ${r.error}`;
            } catch (e) { return `启动TCP服务器失败: ${e.message}`; }
          }

          case 'stop_tcp_server': {
            if (typeof require === 'undefined') return '错误: 无法访问IPC';
            const { ipcRenderer } = require('electron');
            const r = await ipcRenderer.invoke('stop-tcp-server');
            return r.success ? 'TCP服务器已停止' : `停止失败: ${r.error}`;
          }

          case 'start_tcp_client': {
            const { host, port } = tc.arguments;
            if (!host || !port) return '错误: host 和 port 为必填参数';
            if (typeof require === 'undefined') return '错误: 无法访问IPC';
            const { ipcRenderer } = require('electron');
            try {
              const r = await ipcRenderer.invoke('start-tcp-client', { host, port });
              return r.success ? r.message : `连接失败: ${r.error}`;
            } catch (e) { return `TCP连接失败: ${e.message}`; }
          }

          case 'stop_tcp_client': {
            if (typeof require === 'undefined') return '错误: 无法访问IPC';
            const { ipcRenderer } = require('electron');
            const r = await ipcRenderer.invoke('stop-tcp-client');
            return r.success ? 'TCP客户端已断开' : `操作失败: ${r.error}`;
          }

          case 'start_udp': {
            const { local_port, remote_host, remote_port } = tc.arguments;
            if (!local_port || !remote_host || !remote_port) return '错误: local_port、remote_host、remote_port 均为必填';
            if (typeof require === 'undefined') return '错误: 无法访问IPC';
            const { ipcRenderer } = require('electron');
            try {
              const r = await ipcRenderer.invoke('start-udp', { localPort: local_port, remoteHost: remote_host, remotePort: remote_port });
              return r.success ? r.message : `启动失败: ${r.error}`;
            } catch (e) { return `启动UDP失败: ${e.message}`; }
          }

          case 'stop_udp': {
            if (typeof require === 'undefined') return '错误: 无法访问IPC';
            const { ipcRenderer } = require('electron');
            const r = await ipcRenderer.invoke('stop-udp');
            return r.success ? 'UDP已停止' : `停止失败: ${r.error}`;
          }

          default:
            return `未知工具: ${tc.name}`;
        }
      },

      async openFile(filePath) {
        if (typeof require !== 'undefined') {
          try {
            const { ipcRenderer } = require('electron');
            await ipcRenderer.invoke('open-file', filePath);
          } catch (e) {
            console.error('打开文件失败:', e);
          }
        }
      },

      async getSerialLog() {
        try {
          if (typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            const content = await ipcRenderer.invoke('get-serial-log');
            return content || '';
          }
          return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              window.removeEventListener('message', handler);
              reject(new Error('获取串口日志超时'));
            }, 3000);
            const handler = (event) => {
              if (event.data && event.data.type === 'serial-log-content') {
                clearTimeout(timeout);
                window.removeEventListener('message', handler);
                resolve(event.data.content || '');
              }
            };
            window.addEventListener('message', handler);
            try {
              if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: 'get-serial-log' }, '*');
              } else {
                window.postMessage({ type: 'get-serial-log' }, '*');
              }
            } catch (error) {
              clearTimeout(timeout);
              window.removeEventListener('message', handler);
              reject(error);
            }
          });
        } catch (error) {
          console.error('获取串口日志失败:', error);
          throw error;
        }
      }
    },

    async mounted() {
      // 加载已保存的语言设置
      try {
        const savedLang = localStorage.getItem('uart-lang');
        if (savedLang) this.lang = savedLang;
      } catch (e) {}

      // 暴露全局函数（供 executeJavaScript 和 copyCodeToClipboard 调用）
      window.setAILang = (lang) => { this.lang = lang; };
      window.aiT = (key) => this.t(key);

      // IPC 语言切换监听
      try {
        const { ipcRenderer } = require('electron');
        ipcRenderer.on('lang-changed', (event, lang) => { this.lang = lang; });
      } catch (e) {}

      // 从 config.ini 通过 Electron IPC 加载本地API配置
      try {
        if (typeof require !== 'undefined') {
          const { ipcRenderer } = require('electron');
          const aiConfig = await ipcRenderer.invoke('get-ai-config');
          this.localApiUrl = aiConfig.ai_api_url || '';
          this.localApiKey = aiConfig.ai_api_key || '';
          this.localModel  = aiConfig.ai_model   || '';
          if (!this.localApiUrl) {
            this.configError = this.t('errApiNotSet');
          } else {
            this.configLoaded = true;
            console.log('本地API配置已加载:', this.localApiUrl, '模型:', this.localModel);
          }
        } else {
          this.configError = this.t('errNoIPC');
        }
      } catch (error) {
        this.configError = this.t('errConfigLoad') + error.message;
        console.error('加载本地API配置失败:', error);
      }

      this.$nextTick(() => {
        const textarea = document.querySelector('.input-textarea');
        if (textarea) textarea.focus();
      });

      // 监听来自主窗口追加文本的消息
      window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'append-to-input') {
          const textToAppend = event.data.text || '';
          if (textToAppend) {
            this.inputText = this.inputText ? this.inputText + '\n' + textToAppend : textToAppend;
            this.$nextTick(() => {
              const textarea = document.querySelector('.input-textarea');
              if (textarea) {
                textarea.focus();
                textarea.setSelectionRange(textarea.value.length, textarea.value.length);
              }
            });
          }
        }
        // postMessage 语言切换
        if (event.data && event.data.type === 'lang-changed') {
          this.lang = event.data.lang;
        }
      });
    }
  }).mount('#app');

  // 全局复制代码函数
  window.copyCodeToClipboard = async function(codeId, codeText) {
    const tAI = window.aiT || ((k) => ({ copiedCodeTitle: '已复制！', copyCodeTitle: '复制代码', copyFail: '复制失败，请手动复制' })[k] || k);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(codeText);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = codeText;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      const btn = document.querySelector(`[onclick*="${codeId}"]`);
      if (btn) {
        const originalTitle = btn.getAttribute('title');
        btn.setAttribute('title', tAI('copiedCodeTitle'));
        btn.style.color = '#4caf50';
        setTimeout(() => {
          btn.setAttribute('title', originalTitle || tAI('copyCodeTitle'));
          btn.style.color = '';
        }, 2000);
      }
    } catch (error) {
      console.error('复制失败:', error);
      alert(tAI('copyFail'));
    }
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// 主题切换监听
(function() {
  function applyAiTheme(theme) {
    document.body.classList.remove('theme-dark', 'theme-light');
    document.body.classList.add('theme-' + theme);
  }
  // IPC 监听（Electron webview with nodeIntegration）
  try {
    const { ipcRenderer } = require('electron');
    ipcRenderer.on('theme-changed', (event, theme) => applyAiTheme(theme));
  } catch (e) {}
  // postMessage 监听（备用）
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'theme-changed') applyAiTheme(e.data.theme);
  });
  // 初始化时应用已保存的主题
  try {
    const saved = localStorage.getItem('uart-theme') || 'dark';
    applyAiTheme(saved);
  } catch (e) {}
})();
