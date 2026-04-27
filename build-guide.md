# 打包指南

## 安装 electron-builder

首先安装打包工具：

```bash
npm install
```

## 打包命令

### 打包 Windows 安装程序（NSIS）

生成安装程序（.exe），支持自定义安装路径：

```bash
npm run build:win
```

或者：

```bash
npm run build
```

### 打包便携版（Portable）

生成绿色便携版，无需安装：

```bash
npm run build:win:dir
```

### 仅打包目录（不生成安装程序）

用于测试或自定义打包流程：

```bash
npm run build:win:dir
```

## 打包输出

打包完成后，文件会输出到 `dist` 目录：

- **NSIS 安装程序**: `dist/串口调试工具 Setup x.x.x.exe`
- **便携版**: `dist/串口调试工具-x.x.x-portable.exe`
- **未打包目录**: `dist/win-unpacked/` （包含所有文件）

## 配置说明

### 图标文件（可选）

1. 准备一个 256x256 或更大的 PNG 图片
2. 转换为 ICO 格式（可使用在线工具）
3. 将 `icon.ico` 放到 `build/` 目录
4. 取消 `package.json` 中 `build.win.icon` 的注释

### 管理员权限

当前配置要求管理员权限运行（`requestedExecutionLevel: "requireAdministrator"`），因为串口访问通常需要管理员权限。

如果不需要，可以在 `package.json` 的 `build.win` 中修改为：
```json
"requestedExecutionLevel": "asInvoker"
```

## 常见问题

### 打包失败：找不到 serialport

确保 `package.json` 的 `build.files` 中包含了 serialport：
```json
"files": [
  "**/*",
  "!node_modules/**/*",
  "node_modules/serialport/**/*",
  "node_modules/@serialport/**/*"
]
```

### 打包后无法运行

1. 检查是否包含所有必要的文件
2. 查看控制台错误信息
3. 确保 serialport 原生模块已正确打包

### 文件体积过大

可以使用 `electron-builder` 的压缩选项，或排除不必要的文件。

## 高级配置

更多配置选项请参考 [electron-builder 文档](https://www.electron.build/)

