# Context Translator

一个基于 AI API 的 Chrome 翻译插件

鼠标悬停段落并按触发键，即可在原文下方嵌入显示译文；选定文字按触发键可在悬浮窗查看译文；也可经右键菜单把选定文字加入上下文（Add to context），或不选文字时手输指引（Add instruction）喂给当前页的翻译会话。所有翻译共享一个按页面绑定的会话，累积上下文以帮助模型理解语境。

与其他翻译插件的差异？支持上下文，支持使用你自己的 API，以极低的价格的获取高质量的翻译结果

## 核心功能

- **悬停翻译**：鼠标悬停在某段文字上，轻按触发键（默认 `Alt`），译文会直接嵌在原文下方——无文本框、无背景，字体格式与原文一致；再按一次隐藏，再按一次显示（使用缓存，不重复请求）。
- **划线翻译**：选定一段文字，按触发键，在选区附近的悬浮窗内查看译文（每次新请求，不缓存）。
- **加上下文（Add to context）**：选定一段文字，右键点「Add to context」，这段文字不会立刻翻译，而是加入当前页面的会话上下文，随下一次翻译一起发给模型，帮助它理解语境（尤其适合翻译短句时补充背景）。
- **补指引（Add instruction）**：不选择任何文字时，右键点「Add instruction」，弹出输入框手输一段指引（术语/背景/语气），加入当前页面会话上下文，随下一次翻译一起发出。
- **按页面绑定的会话**：每个标签页维护一份独立的翻译会话（刷新即重置）。同一页面内多次翻译会带上前文，模型能借助上下文给出更连贯的译文。
- **流式输出**：翻译按 token 逐字显示；等待首字期间显示 `Translating` 加载动画。
- **内联格式保留**：译文保留原文的链接、代码等内联格式，与原文排版一致。
- **OpenAI 兼容端点**：可接入任意 OpenAI 兼容的 chat completions 服务（如 DeepSeek、OpenAI 等），可自定义模型与 system prompt。

## 用法

### 1. 配置

- 点击工具栏扩展图标 → 弹窗里选择**目标语言**（默认简体中文）。
- 点击弹窗里的「**设置…**」打开设置页，填写：
  - **Base URL**：留空即用默认 `https://api.deepseek.com`（DeepSeek 为首要后端，可改其他 OpenAI 兼容端点）
  - **API Key**：你的密钥（仅本地存储，不上传同步；唯一必填项）
  - **Model**：留空即用默认 `deepseek-v4-flash`（也可 `deepseek-v4-pro` 或其他）
  - **触发键**：`Alt` / `Shift` / `Ctrl` 三选一（默认 `Alt`）
  - **思考模式**：开关（默认关）。开启后 DeepSeek 先思考再翻译，译文可能更贴合语境，但会消耗思维链 token（按输出计费）且等待首字时间变长；开启时会弹出提示。
  - **思考强度**：`Low` / `Medium` / `High` / `Max` 单选（默认 `Low`）。仅思考模式开启时可选；DeepSeek 实际仅 `High` / `Max` 生效（`Low` / `Medium` 等同 `High`）。
  - **System Prompt**：可覆盖默认翻译提示
- 保存即可。端点 / Key / 模型 / 思考模式 / 思考强度的改动**即时生效**；触发键与 system prompt 对**新加载的页面**生效（已打开的页面刷新一次即可）。

### 2. 悬停翻译

鼠标悬停在某段文字上 → 轻按触发键 → 译文出现在原文下方。再按一次隐藏，再按一次显示（缓存）。

> 若悬停的文字已是目标语言（如目标为中文时悬停中文），扩展会自动跳过、不发起翻译——按触发键无反应属正常，并非故障。

### 3. 划线翻译

选定一段文字 → 轻按触发键 → 选区附近的悬浮窗显示译文。

### 4. 加上下文（Add to context）

选定一段文字 → 右键 →「Add to context」→ 该文字加入当前页面会话的上下文，随下一次翻译一起发出。

### 5. 补指引（Add instruction）

不选择任何文字 → 右键 →「Add instruction」→ 弹出输入框，输入术语/背景/语气等指引并提交 → 加入当前页面会话上下文，随下一次翻译一起发出。

> 会话按页面绑定：刷新页面会重置会话与上下文。

## 从 Release 安装

1. 到 [Releases 页](https://github.com/BruceXSK/context-translator/releases) 下载最新 `context-translator-<version>.zip`
2. 解压，得到 `context-translator-<version>/` 文件夹
3. 打开 `chrome://extensions` → 右上角开启「**开发者模式**」
4. 点「**加载已解压的扩展程序**」→ 选择解压出的文件夹
5. 点工具栏图标 →「**设置…**」填端点 / API Key / 模型 → 保存

> Chrome 不允许直接安装未上架的 .crx，因此通过「加载已解压」使用下载的 zip。

## 构建并加入 Chrome

### 步骤

1. **克隆仓库**

   ```bash
   git clone https://github.com/BruceXSK/context-translator.git
   cd context-translator
   ```

2. **安装依赖**

   ```bash
   npm install
   ```

3. **构建生产产物**

   ```bash
   npm run build
   ```

   构建产物输出在 `dist/` 目录。

4. **加载到 Chrome**

   - 打开 `chrome://extensions`
   - 右上角开启「**开发者模式**」
   - 点击「**加载已解压的扩展程序**」，选择项目下的 `dist` 目录
   - 扩展出现在列表中，工具栏会显示 Context Translator 图标

5. **配置并使用**

   - 点击工具栏图标 → 选择目标语言 → 点击「设置…」填入端点 / API Key / 模型 → 保存
   - 打开任意网页，悬停段落并按 `Alt` 即可翻译

### 更新到新版本

拉取最新代码后重新构建，再到 `chrome://extensions` 点击扩展卡片上的「刷新」按钮：

```bash
git pull
npm run build
```

## 开发

- `npm run dev`：启动 Vite 开发模式（加载 `dist` 后支持热更新）。
- `npm run typecheck`：TypeScript 类型检查。
- `npm run build`：生产构建到 `dist/`。

## 隐私与备注

- API Key 仅存于本地的 `chrome.storage.local`，不会进入 Chrome 同步，也不会上传到任何第三方服务（除你配置的 LLM 端点外）。
- 翻译内容会发送到你配置的 LLM 端点进行翻译，不上传到其他地方。
- 会话按页面绑定、不自动截断以保持上下文连贯，刷新页面即重置。

## 特别鸣谢

- Claude Code
- GLM-5.2
- Deepseek V4
