# 安装指南

如果遇到安装问题，请按以下步骤操作：

## 方法一：清理后重新安装（推荐）

1. **清理 node_modules 和缓存**
```bash
# 删除 node_modules 文件夹（如果存在）
rmdir /s /q node_modules

# 清理 npm 缓存
npm cache clean --force
```

2. **使用国内镜像重新安装**
```bash
npm install
```

## 方法二：如果方法一失败，手动清理

1. **关闭所有可能占用文件的程序**（如 VS Code、文件管理器等）

2. **以管理员身份运行命令提示符**

3. **删除 node_modules 文件夹**
```bash
cd E:\zj_files\projects\uartGo
rmdir /s /q node_modules
```

4. **清理 npm 缓存**
```bash
npm cache clean --force
```

5. **重新安装**
```bash
npm install
```

## 方法三：使用 yarn（如果 npm 持续失败）

```bash
# 安装 yarn（如果还没有）
npm install -g yarn

# 使用 yarn 安装
yarn install
```

## 方法四：分步安装

如果网络不稳定，可以分步安装：

```bash
# 先安装 electron
npm install electron --save-dev

# 再安装 serialport
npm install serialport @serialport/parser-readline --save
```

## 常见问题

### 权限错误 (EPERM)
- 以管理员身份运行命令提示符
- 关闭所有可能锁定文件的程序
- 重启电脑后再试

### 网络错误 (ECONNRESET)
- 检查网络连接
- 使用 VPN 或代理
- 项目已配置国内镜像源（.npmrc 文件）

### serialport 编译失败
- 确保已安装 Visual Studio Build Tools 或完整版 Visual Studio
- 安装 Windows Build Tools：
```bash
npm install --global windows-build-tools
```

## 验证安装

安装完成后，运行：
```bash
npm start
```

如果看到应用窗口，说明安装成功！

