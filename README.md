# 豆包收藏助手 (Doubao Collector)

一键收藏豆包 AI 对话为本地 Markdown 笔记，支持 AI 摘要总结。

**收藏到就是学到** —— 把好的 AI 回答变成你的知识库。

## 功能

- **一键保存** — 豆包 AI 回答旁出现保存按钮，点击即可保存为 Markdown 文件
- **AI 摘要** — 可选调用 AI（OpenAI / Claude / 豆包火山引擎 / 自定义）自动生成摘要
- **自定义保存目录** — 保存到你指定的任意本地文件夹
- **知识卡片格式** — 简洁的问答结构，适合作为个人知识库
- **保存进度可视化** — 浮动卡片实时显示保存状态和摘要结果
- **收藏历史** — 扩展弹窗中浏览所有收藏记录

## 安装

### 第一步：安装浏览器扩展

1. 下载或 `git clone` 本仓库
2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择 `doubao-collector` 文件夹
5. 扩展安装完成，记下扩展 ID（稍后要用）

### 第二步：安装 Native Helper（保存到自定义目录）

> 如果你只需要保存到 Downloads 文件夹，可以跳过此步。

需要 [Node.js](https://nodejs.org/)（v16+）。

**Windows:**

```bash
cd doubao-collector/native-host
install.bat
```

**macOS / Linux:**

```bash
cd doubao-collector/native-host
chmod +x install.sh
./install.sh
```

安装脚本会要求输入扩展 ID，在 `chrome://extensions/` 页面可以看到。

安装完成后 **重启 Chrome**。

### 第三步：配置

1. 点击扩展图标 → **设置**
2. **保存目录**：点击"选择目录"，输入你想保存笔记的文件夹路径
3. **AI 摘要**（可选）：选择 AI 提供商，填入 API Key

## 使用方法

1. 打开 [豆包](https://www.doubao.com/chat/) 进行对话
2. 在满意的 AI 回答旁，点击 💾 **保存按钮**
3. 右下角浮动卡片显示保存进度
4. 完成后 Markdown 文件自动保存到你指定的目录

## 保存的 Markdown 格式

```markdown
# 如何学习 Rust

> Rust 学习路线从官方教程入手，配合 Rustlings 练习，重点掌握所有权系统

## 问题
请推荐学习 Rust 编程语言的最佳路线

## 回答
作为有 C++ 基础的开发者，学习 Rust 会相对顺畅...
（完整原文）

---
来源：豆包 | 2026-03-13 | [原始对话](https://www.doubao.com/chat/xxx)
```

## 支持的 AI 提供商

| 提供商 | 用途 | 备注 |
|--------|------|------|
| OpenAI | 摘要生成 | 推荐 gpt-4o-mini |
| Claude (Anthropic) | 摘要生成 | 推荐 claude-sonnet |
| 豆包/火山引擎 | 摘要生成 | 填写推理接入点 ID |
| 自定义 | 摘要生成 | 任何 OpenAI 兼容 API |

> AI 摘要是可选功能。不配置 API Key 也可以正常保存，只是不会有摘要。

## 项目结构

```
doubao-collector/
├── manifest.json           # Chrome 扩展清单 (Manifest V3)
├── background.js           # Service Worker
├── content.js              # 内容脚本（注入豆包页面）
├── content.css             # 注入样式
├── lib/
│   ├── ai-providers.js     # AI 多模型抽象层
│   ├── markdown.js         # Markdown 转换和模板
│   └── storage.js          # 存储封装
├── popup/                  # 扩展弹窗
├── options/                # 设置页
├── native-host/            # Native Messaging Host
│   ├── host.js             # Node.js 原生宿主
│   ├── run-host.bat        # Windows 启动器
│   ├── install.bat         # Windows 安装脚本
│   └── install.sh          # macOS/Linux 安装脚本
└── icons/                  # 扩展图标
```

## 系统要求

- Chrome 88+ / Edge 88+（Manifest V3 支持）
- Windows 11 / macOS（Native Helper 需要）
- Node.js 16+（仅 Native Helper 需要）

## 常见问题

**Q: 保存按钮没有出现？**

豆包页面的 DOM 结构可能会更新。打开 F12 控制台，查看是否有 `[Doubao Collector]` 开头的日志。如果选择器不匹配，在设置页"高级设置"中手动填写 CSS 选择器。

**Q: 保存失败？**

1. 检查 `chrome://extensions/` 中 Service Worker 是否正常
2. 如果使用自定义目录，确认 Native Helper 已安装并重启了 Chrome
3. 打开 Service Worker 控制台查看详细错误日志

**Q: AI 摘要不工作？**

在设置页点击"测试连接"按钮，确认 API Key 和模型配置正确。

## 致谢

灵感来自 [bookmark-is-learned](https://github.com/iamzifei/bookmark-is-learned) —— 收藏到就是学到。

## License

[MIT](LICENSE)
