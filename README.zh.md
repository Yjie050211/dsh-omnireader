# OmniReader 全能阅读器

面向 **DeepSeek Harness**（`dsh`）的本地优先、多格式文档阅读器插件。
可以直接打开工作区或本地磁盘上的 **Markdown、PDF、DOCX、EPUB、MOBI/AZW3** 文件，
既提供右侧快速预览，也提供完整页面式的沉浸阅读面板。

OmniReader 首先是“阅读器”：不上传文档、不调用大模型、不把阅读内容写进 Agent 上下文；
除非你明确要求，否则阅读行为只发生在本地。

```text
┌──────────────────────────────────────────────────────────────┐
│ OmniReader        标签 · 搜索 · 目录 · 笔记 · 主题           │
├────────────┬──────────────────────────────┬──────────────────┤
│   目录     │          文档正文             │   笔记 / 书签    │
│   章节     │   重排后的段落 / PDF 页面     │   可跳转          │
├────────────┴──────────────────────────────┴──────────────────┤
│ 格式 · 页码/章节 · 进度 · 服务状态                            │
└──────────────────────────────────────────────────────────────┘
```

## 功能

### 两种阅读界面

| | 位置 | 适合场景 |
|---|---|---|
| **快速预览** | 复用 Harness 右侧文档预览（`sidebar.right.tab.document`） | 文件树里点开文件、看 Agent 生成的文档、不离开对话瞥一眼某一章 |
| **沉浸阅读** | 独立的 `main` 面板 + 左侧栏入口 | 论文、电子书、大型 DOCX、长篇技术文档 |

快速预览完全走 Harness 现有的文档预览槽位：EPUB/MOBI/AZW3 由本插件注册新的渲染器，
并且对**所有**被预览的文件在标题栏追加“在 OmniReader 中打开”按钮。内置的
Markdown / PDF / DOCX / XLSX / 图片 / HTML 预览保持原样，本插件不会覆盖任何已有渲染器，
因此停用插件后原有预览行为完全恢复。

### 五种格式

| 格式 | 解析方式 | 目录 | 搜索 | 选择复制 | 页码跳转 | 进度定位 |
|---|---|---|---|---|---|---|
| Markdown / GFM | 自研解析器 | ✅ 标题 + frontmatter 标题 | ✅ | ✅ | – | 章节 + 段落 |
| PDF | 内置 `pdf.js`（worker 内联） | ✅ 内嵌书签目录 | ✅ 全文 | ✅ 文本层 | ✅ 页码 / 缩放 / 旋转 | 页码 + 缩放 + 旋转 |
| DOCX | OOXML → 重排段落 | ✅ 标题样式 | ✅ | ✅ | – | 章节 + 段落 |
| EPUB 2/3 | 自研 ZIP + OPF/NCX/nav | ✅ 导航文档 / NCX | ✅ | ✅ | – | 章节 + 段落 |
| MOBI / KF8 / AZW / AZW3 | PalmDOC/KF8 文本 + 图片记录 | ✅ 自动生成 | ✅ | ✅ | – | 章节 + 段落 |

五种格式都有真实可执行的解析与渲染路径，而不是只靠扩展名识别。加密（DRM）、
HUFF/CDIC 压缩、截断或损坏的文件会给出具体错误提示，而不是空白面板。

### 阅读能力

- **导航**：可折叠目录、章节/页码跳转、PDF 页码输入、上一页/下一页、`Ctrl/Cmd+O` 书库。
- **搜索**：文档内搜索（防抖 + 可取消）、结果高亮、点击跳转；PDF 跨页搜索并标注命中页码；
  扫描版 PDF 会如实报告 0 命中，不会假装能搜到文本。
- **阅读进度**：按绝对路径保存（PDF 为页码 + 缩放 + 旋转，重排格式为章节 + 段落），
  重新打开、切换文档、切换 DSH 面板后都能恢复。
- **外观**：跟随 DSH 主题，`auto/light/sepia/dark` 四种阅读主题，正文字号档位、
  PDF 缩放（适应宽度或 75%–300%）与旋转。
- **书签与笔记**：按文档保存在 Host 端，可跳转、可删除。
- **多文档标签**：最多 8 个标签（超出淘汰最旧），切换面板不丢状态，可从最近阅读恢复。
- **快捷键**：`Ctrl/Cmd+F` 搜索、`Ctrl/Cmd+O` 书库、`Ctrl/Cmd+=`/`-` 字号或缩放、
  `Esc` 关闭搜索/书库、`Ctrl/Cmd+W` 关闭标签、全屏切换。

所有可见文案都经过 Harness 客户端 locale 服务（`en` / `zh`），所有颜色都使用
`--dsw-alias-*` 设计变量，深浅色主题都能自动适配。

## 安装

OmniReader 是标准的 Cordis 插件包（`dsh.bundle.patch` + `dsh.client.platform: "web"`）。
先构建一次浏览器产物，然后用插件管理器按**绝对路径**安装：

```bash
# 1. 构建 lib/client.js 与 lib/pdf.worker.min.mjs
pnpm install          # 或 npm install --ignore-scripts
node build.mjs

# 2. 在 DSH 中安装
#    plugin_manager → install_bundle → target = 本目录绝对路径
#    （或在 设置 → 插件 → 从本地目录安装）
```

安装结果 `application: "applied"` 表示已生效。和所有 Harness 插件一样，
替换已安装的同名包需要先 `remove_bundle`（或重启 DSH 以获得新的 JS 代际）。

仓库中已提交构建产物（`lib/client.js`、`lib/pdf.worker.min.mjs`），
新克隆的目录可直接安装；只有修改 `src/` 后才需要重新 `node build.mjs`。

Host 半部分（`index.js`）通过 `ctx.webServer.register` 注册一组仅限本机回环地址的辅助接口
（`/api/omnireader/*`：文件元数据、字节读取、目录浏览、阅读状态与诊断），
随插件卸载一并释放；没有外部服务、没有账号、没有遥测。

## 目录结构

```text
dsh-omnireader/
├── package.json              # 插件包清单（dsh.bundle + dsh.client）
├── cordis.patch.yml          # 单行 insert：id omnireader
├── index.js                  # Host 半部分：回环文件/状态/诊断路由
├── icon.svg / locale/*.json  # 设置 → 插件 中显示的元数据
├── build.mjs                 # esbuild 打包 + 内联 pdf.js worker
├── src/client/
│   ├── entry.jsx             # apply()：槽位、预览渲染器、操作按钮
│   ├── dict.js               # 中英文词典
│   ├── lib/{http,store,util}.js
│   ├── formats/{zip,dom,flow,markdown,pdf,docx,epub,mobi,index}.js
│   └── ui/{ReaderPanel,Library,Outline,SearchPanel,NotesPanel,FlowView,PdfView,styles,context}
├── lib/                      # 构建产物（已提交）
└── tests/                    # node --test 测试 + 自建测试文件
```

### 架构说明

- **Host / Client 分工**：Host 负责文件访问与持久化（`$DSH_HOME/omnireader/` 下原子写入的 JSON），
  Client 负责解析、渲染与交互。浏览器无法直接读任意路径，因此读取走认证过的回环路由；
  该路由只接受绝对本地路径，并强制大小上限。
- **按格式适配**：每个格式返回“流式模型”（章节 → 段落块）或“PDF 模型”。
  UI 只认识这两种形状，向模型索取 `outline`、`search`、`capabilities`，组件里没有按扩展名的分支。
- **有界开销**：ZIP 条目数/单条目/总解压上限、拒绝路径穿越；MOBI/EPUB/DOCX 字节上限；
  PDF 页面虚拟化（`900px` 预渲染边界，离屏释放画布）；长文档按章节窗口渲染；
  搜索防抖且可取消；每个标签独立 `AbortController`，切换文档不会与慢解析竞态。

## 安全性

- 只读取用户主动选择/输入的路径；不扩大工作区权限、不允许路径穿越、从不写入/移动/删除源文件。
- HTML→块转换器会丢弃 `script/iframe/object/embed/form/svg/math` 等标签，
  拒绝 `javascript:`/`data:` 协议，只保留 `http/https/mailto/file` 链接；
  图片只允许归档内相对路径、文档同目录或回环文件路由。
- EPUB 内嵌脚本不会执行：解析 XHTML 为中性块模型，而不是注入 HTML 或挂载浏览器框架。
- DOCX/EPUB/MOBI 容器使用自研 ZIP 解码器，拒绝 `..`/绝对/UNC 条目并限制解压量（防 zip-slip / zip 炸弹）。
- Host 路由仅回环、校验 JSON content-type、限制体积；状态文件原子写入。
- 不为内容发起任何网络请求（无 CDN、无远程字体、无遥测）；Markdown 中的远程图片只显示替代文本。

## 验证

`node --test "tests/**/*.test.mjs"` —— 17 个测试，覆盖 ZIP 解码（含路径穿越拒绝）、
Markdown 解析、MOBI PalmDOC 解压、格式识别与能力声明。

端到端行为在真实 DSH 页面中验证（插件的客户端包会把结构化诊断上报到
`/api/omnireader/diag`，再从 `$DSH_HOME/omnireader/diagnostics.jsonl` 读回）：

- 五种格式都能打开并到达 `ready` 状态；
- PDF 跨页搜索（`hits: 3`，命中第 1–2 页），关闭重开后页码/缩放/旋转恢复，扫描版 PDF 如实 0 命中；
- EPUB：31 章、32 条目录、112 块搜索索引，书签/笔记写入回读成功，切换文档后阅读位置恢复；
- MOBI：从 PalmDOC 文本记录渲染出 31 章；
- 快速预览通过真实的 `sidebar.right.tab.document` 渲染 EPUB，标题栏注册了“在 OmniReader 中打开”；
- 损坏的 EPUB/MOBI 与不支持的 `.txt` 都进入明确错误态，界面不崩溃；
- 切换深色主题与字号生效，切换 DSH 面板后阅读位置保持不变。

## 已知限制（如实列出）

- **Host 代码需重启生效**：`index.js` 在插件安装时加载，修改后需重启 DSH；客户端包会热重载。
- **DOCX 只有重排阅读模式**：精确分页布局可使用 Harness 内置的 DOCX→PDF 预览；
  本插件的 DOCX 模式是干净的阅读流（标题、表格、图片、链接），复杂分节版式可能重排。
- **Markdown 扩展**：支持表格、任务列表、代码块、公式块与图片；Mermaid 以代码形式展示，
  公式显示为公式块（未内置 TeX/Mermaid 引擎；需要原始效果时可用内置 Markdown 预览）。
  代码高亮为逐块样式，不是 Shiki 级着色。
- **无 PDF 表单、批注与 OCR**；扫描版仅可显示不可搜索（OCR 属于后续可选增强）。
- **固定版式 EPUB** 以重排流方式阅读（不还原版面）。
- **不支持 DRM**：声明加密的书会给出明确错误。
- **无 AI 功能**：摘要/问答/翻译刻意不做，阅读文档不消耗任何推理 Token。

## 开发

```bash
node build.mjs                       # esbuild 打包 → lib/client.js
node --test "tests/**/*.test.mjs"    # 单元测试
```

打包产物包裹在 `window.__ModuleLoader__.load({ id, factory })` 中，唯一的外部模块是
Harness 平台模块表里的 React；`pdfjs-dist` 与全部解析器都被打进 bundle。

## 升级 / 停用 / 卸载

- **升级**：修改 `src/` 后 `node build.mjs`（工作区链接安装会自动热重载）；
  若版本号或 `index.js` 变化，先移除再重新安装（或重启 DSH）以刷新 Host 代码。
- **停用**：设置 → 插件 → 停用 `dsh-omnireader`。预览渲染器与侧边栏/面板入口会消失，
  内置文档预览保持正常。
- **卸载**：`plugin_manager` → `remove_bundle`（`dsh-omnireader`），或在 设置 → 插件 中删除。
  书签/笔记/进度保存在 `$DSH_HOME/omnireader/state.json`，卸载不会删除；需要彻底遗忘时手动删除该目录。

## 许可证

MIT。`tests/fixtures/` 下的测试文件除公有领域电子书外均为自建，来源见 `tests/fixtures/README.md`。
