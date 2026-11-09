# Claude Code 源码学习手册（中文注释版）

> **这是什么**：一份把 [`github.com/hangsman/claude-code-source`](https://github.com/hangsman/claude-code-source) 的 `src/` 目录**逐行加中文注释**的源码阅读手册。
> **分析版本**：`2.1.88`（`package.json` 中声明）
> **规模**：`source/src` 共 **1,902 个文件 / 513,237 行**，已全部批注（按行数覆盖 **100%**）；配套 `src/services` 等 **130 份**也已批注。
> **写给谁**：想通过读源码学架构、但不太熟悉英文的同学。
> **怎么用**：本手册给出「分析方案 + 中文批注版源码 + 文件夹/术语/英文注释中英文对照」。读的时候看 `annotated/` 里的批注版，对照 `source/` 里的原文。
> **完整进度与逐批记录**：见 [索引与进度](annotated-索引与进度.md)。

---

## 三分钟看懂这个项目

`Claude Code` 是 Anthropic 出品的**终端里运行的 AI 编程智能体**（agentic coding tool）。它不是普通聊天框，而是能**读你的代码库、改文件、跑终端命令**的「会动手的 AI」。

一句话概括它的运行方式：

```
你输入一句话  →  主循环把消息 + 工具清单发给 Claude  →  模型说"我要调某个工具"
     ↑                                                          ↓
     └──────── 工具结果塞回对话，继续下一轮  ←──────── 权限检查 → 执行工具
```

代码层面，所谓「AI 智能体」就是一个 `while(true)` 循环 + 「调用模型 → 执行工具 → 回灌结果」。本手册第 06 篇会把这个循环本体育给你看。

---

## ⚠️ 开始前必须知道的两件事

**1. 这是打包版，不能直接运行。**
`package.json` 的 `dependencies` 是空的（`{}`），依赖在构建时被 Bun 内联了。`npm install` 后也跑不起来——请把它当**源码阅读对象**，不要试图直接运行。

**2. 满屏的 `feature('XXX')` 是构建期开关。**
这是 Bun 的**死代码消除（dead code elimination）**：只有开关打开的分支才会被打进最终包，没开的整段被删。所以你看到的 `feature('KAIROS')`、`feature('COORDINATOR_MODE')` 等分支，在你手上的版本里**可能根本不存在**。读代码时别被它绕晕。

---

## 文档目录（专题分析，按顺序读或按需跳）

| 序号 | 章节 | 一句话内容 | 适合什么时候读 |
| --- | --- | --- | --- |
| [00](docs/00-零基础学习路线.md) | **零基础学习路线** | 六层关卡、每单元 20–30 分钟、2–150 行、三个问题 + 一个验证动作 | **0 基础从这里开始，别跳** |
| [00a](docs/00a-TypeScript地基.md) | **TypeScript 地基** | 只讲本仓库真实出现的语法；每个符号配「中文怎么念」 | 读 L0 时随时查，卡住就回来看 |
| [01](docs/01-项目总览与架构.md) | 项目总览与架构 | 技术栈、整体架构图、数据流 | 走完 L1 之后，建立全局印象 |
| [02](docs/02-目录结构中英对照.md) | 目录结构中英对照 | `src/` 每个目录的英文 / 文件数 / 中文含义 | 想找「某个功能在哪个目录」时查 |
| [03](docs/03-启动流程.md) | 启动流程 | `cli.tsx` → `main()` → `setup()` 三棒接力 | 想懂「程序怎么起来的」 |
| [04](docs/04-工具系统.md) | 工具系统 | 工具注册中心 `tools.ts` + 工具执行流水线 | **重点**：AI 的「双手」 |
| [05](docs/05-提示词与命令.md) | 提示词与命令 | 系统提示词怎么拼、斜杠命令怎么写 | 想学 prompt 工程 / 加命令 |
| [06](docs/06-对话主循环与模型调用.md) | 对话主循环与模型调用 | `while(true)` 循环 + 调 API + 重试 | **最重要**：AI Agent 的心脏 |
| [07](docs/07-服务层详解.md) | 服务层详解 | `services/` 逐模块讲 | 想搞懂 MCP / 埋点 / LSP / 登录 |
| [08](docs/08-权限与安全.md) | 权限与安全 | allow / ask / deny 三态判定、6 种模式 | 想学「AI 怎么安全地动手」 |
| [09](docs/09-配置系统.md) | 配置系统 | 全局 / 项目 / 企业托管三层配置 | 想知道「设置存在哪」 |
| [10](docs/10-子智能体与计划模式.md) | 子智能体与计划模式 | 让 AI 派 AI 干活、先规划后执行 | 想学多智能体 / Plan 模式 |
| [11](docs/11-上下文压缩.md) | 上下文压缩 | 长对话怎么不爆窗口（compact） | 想懂「为什么能聊很久」 |
| [12](docs/12-UI与多智能体.md) | UI 与多智能体 | React + Ink 终端渲染、协调器模式 | 对界面 / 多智能体感兴趣 |
| [13](docs/13-中英文术语对照.md) | 中英文术语对照 | 架构术语、英文 prompt、缩写全表 | 随时查词 |
| [14](docs/14-底层运行时与基础设施.md) | 底层运行时与基础设施 | cli / bridge / remote / server / tasks / state / vim / migrations 等 | 想搞懂「程序怎么跑起来」 |
| [15](docs/15-常量·技能与伙伴系统.md) | 常量·技能·伙伴系统 | constants 全表、多智能体权限矩阵、skills、buddy 宠物 | 想懂工具/Agent 的权限边界 |

> **两条路线**：`00` 篇决定「按什么顺序读」（零基础用），下面的「进阶路线」是「有基础之后查哪」（模块速查用）。

---

## 学习路线（零基础，先读这份）

> **如果你没写过 TypeScript、没读过上千行的文件** —— 直接打开 [`docs/00-零基础学习路线.md`](docs/00-零基础学习路线.md)，别从下面那七步开始。
> 原因很实在：旧路线第 1 步是「读 `cli.tsx` 前 120 行」，而这 120 行里同时出现了动态 `import()`、`feature()` 构建期开关、`process.argv`、`.js` 后缀——**四个从没解释过的概念**。不是你不适合读，是顺序不对。

### 六层总览（详细卡片见 [00 篇](docs/00-零基础学习路线.md)）

| 层 | 内容 | 单元数 | 时长 | 读完能干什么 |
| --- | --- | --- | --- | --- |
| **L0** 语言地基 | 不读业务，只读语法标本；每个语法配真实代码 + 行号 | 11 | 约 5 小时 | 看懂一个 TS 文件 80% 的符号 |
| **L1** 单文件解剖 | 2–19 行的小文件，整个读完不跳 | 6 | 约 2.5 小时 | 5 分钟讲清一个小文件 |
| **L2** 单函数追踪 | 从入口跟到返回值，学会「顺着数据流读」 | 6 | 约 3 小时 | 拿到 60–150 行能画出数据流 |
| **L3** 小模块协作 | 一个目录 3–4 个文件怎么配合 | 4 | 约 4 小时 | 画出依赖方向图、看出循环依赖 |
| **L4** 子系统 | 工具系统 / 主循环 / 权限，各拆 3–5 个聚焦单元 | 12 | 约 3 天 | 默写 Agent 主循环伪代码 |
| **L5** 全链路 | 跟一次真实请求从键盘走到屏幕 | 2 | 各半天 | 每一跳都能指到文件和函数 |

**合计约 7 天**（每天 2–3 小时）。

### 每个单元长什么样

每个单元都是同一个版式，照做就行：

| 部分 | 你该做什么 |
| --- | --- |
| `⏱ 时长｜📄 行数｜前置` | 超时就停；前置没读先回去补 |
| **读** | 只读标出来的那些行，**不要顺手往下翻** |
| **一句话** | 先看这句建立预期——知道要找什么，眼睛才找得到 |
| **带三个问题读** | 带着问题读比通读快 5 倍；答不出就是没读懂 |
| **读完自测** | **合上文件**再答，开着文件答等于抄 |
| **验证** | 跑那条命令，用输出确认「我以为的」和「代码里的」一致 |

---

## 进阶路线（七步，按模块读）

> 有基础之后按模块速查用。不知道怎么下手时，照这条线走。每步都标了耗时和对应章节，走完就对整个项目有了完整的认识。

### 第 1 步：先认门面（约 30 分钟）

| 读什么 | 学什么 | 批注版 |
| --- | --- | --- |
| `package.json` | 技术栈是什么；知道「这是打包版，不能直接跑」 | [✅](annotated/package.json.annotated.md) |
| 仓库 `README.md` | 它到底是干嘛的 | [✅](annotated/README.annotated.md) |
| [`src/entrypoints/cli.tsx`](source/src/entrypoints/cli.tsx) 前 120 行 | 「快速路径 + 动态 import」的套路 | [✅](annotated/src/entrypoints/cli.tsx) |

**目标**：不再对这个项目感到陌生。

---

### 第 2 步：读一个最小模块（约 1 小时）

| 读什么 | 学什么 | 批注版 |
| --- | --- | --- |
| [`src/commands/clear/index.ts`](source/src/commands/clear/index.ts) | 19 行，命令模板的极简范例 | [✅](annotated/src/commands/clear/index.ts) |
| [`src/tools/BashTool/commandSemantics.ts`](source/src/tools/BashTool/commandSemantics.ts) | 3.8 KB，讲「退出码语义」，逻辑独立 | [✅](annotated/src/tools/BashTool/commandSemantics.ts) |

**目标**：建立信心。这两个文件小、注释全，是**英语 + 架构双语入门**的最佳材料。

---

### 第 3 步：读初始化流程（约 2 小时）

| 读什么 | 学什么 | 批注版 |
| --- | --- | --- |
| [`src/setup.ts`](source/src/setup.ts) 通读 | 一个会话「出生」要经过哪些步骤 | [✅](annotated/src/setup.ts)（477 行全文件，按「顺序即知识」逐段讲） |

**做法**：把每段英文注释翻译成中文对照（这正是本手册 [03 篇](docs/03-启动流程.md)做的事）。

**目标**：理解「程序怎么起来的」。

---

### 第 4 步：读工具系统（重点，约半天）

| 读什么 | 学什么 | 批注版 |
| --- | --- | --- |
| [`src/tools.ts`](source/src/tools.ts) | 工具户口本（`getAllBaseTools`） | [✅](annotated/src/tools.ts) |
| [`src/Tool.ts`](source/src/Tool.ts) | 工具的类型 / 基类定义 | [✅](annotated/src/Tool.ts) |
| [`src/tools/BashTool/bashSecurity.ts`](source/src/tools/BashTool/bashSecurity.ts) | AI 怎么安全执行命令（危险命令识别） | [✅](annotated/src/tools/BashTool/bashSecurity.ts) |
| [`src/tools/BashTool/bashPermissions.ts`](source/src/tools/BashTool/bashPermissions.ts) | 权限判定 | [✅](annotated/src/tools/BashTool/bashPermissions.ts) |
| `src/services/tools/` | 工具执行流水线（并发 / 钩子 / 编排） | 全部已批注 |

> 读写文件、搜索、技能等工具（`FileEdit` / `FileWrite` / `FileRead` / `Glob` / `Grep` / `Skill` 等）也已逐份批注完成。

**对应章节**：[04 工具系统](docs/04-工具系统.md)、[08 权限与安全](docs/08-权限与安全.md)

**目标**：理解 AI 的「双手」和「安全护栏」。

---

### 第 5 步：读「AI 大脑接线」（最重要，约 1 天）

| 读什么 | 学什么 | 批注版 |
| --- | --- | --- |
| [`src/constants/prompts.ts`](source/src/constants/prompts.ts) | 系统提示词怎么拼 | [✅](annotated/src/constants/prompts.ts) |
| [`src/query.ts`](source/src/query.ts) | 对话主循环的真身 `while(true)` | [✅](annotated/src/query.ts) |
| [`src/QueryEngine.ts`](source/src/QueryEngine.ts) | 查询引擎（流程编排） | [✅](annotated/src/QueryEngine.ts) |
| [`src/services/api/claude.ts`](source/src/services/api/claude.ts) | 真正调 API 的地方（SSE 解析 + 缓存打点 + 三级降级） | [✅](annotated/src/services/api/claude.ts) |
| [`src/services/api/withRetry.ts`](source/src/services/api/withRetry.ts) | 重试 / 退避 / 限流 | [✅](annotated/src/services/api/withRetry.ts) |

**对应章节**：[05 提示词与命令](docs/05-提示词与命令.md)、[06 对话主循环与模型调用](docs/06-对话主循环与模型调用.md)

**目标**：彻底理解「AI Agent 怎么工作」。**这是整条路线的核心，值得多花时间。**

---

### 第 6 步：读服务层（按需，约半天）

`src/services/` 是整个项目的「功能后端」，共 **130 个文件 / 53,683 行，已全部批注**。下面按子目录挑代表文件读，需要哪个查哪个：

| 子目录 | 读什么（代表） | 学什么 |
| --- | --- | --- |
| `mcp/` | [`client.ts`](source/src/services/mcp/client.ts) · [`config.ts`](source/src/services/mcp/config.ts) · [`auth.ts`](source/src/services/mcp/auth.ts) | 七种 transport、配置优先级、OAuth / XAA 流程 |
| `compact/` | [`autoCompact.ts`](source/src/services/compact/autoCompact.ts) · [`compact.ts`](source/src/services/compact/compact.ts) | 长对话怎么压缩、四道抑制闸门 |
| `lsp/` | [`LSPClient.ts`](source/src/services/lsp/LSPClient.ts) · [`manager.ts`](source/src/services/lsp/manager.ts) | 语言服务器协议接入 |
| `oauth/` | [`client.ts`](source/src/services/oauth/client.ts) · [`index.ts`](source/src/services/oauth/index.ts) | 登录与令牌刷新 |
| `analytics/` | [`growthbook.ts`](source/src/services/analytics/growthbook.ts) · [`metadata.ts`](source/src/services/analytics/metadata.ts) | 开关引擎、遥测字段单一事实来源 |
| `SessionMemory/` | [`sessionMemory.ts`](source/src/services/SessionMemory/sessionMemory.ts) | 后台子代理记笔记 |
| 根目录散件 | `voice*.ts` · `vcr.ts` · `notifier.ts` 等 | 各类独立能力 |

**对应章节**：[07 服务层详解](docs/07-服务层详解.md)、[11 上下文压缩](docs/11-上下文压缩.md)

**目标**：知道「功能后端」都有哪些能力，需要哪个查哪个。

---

### 第 7 步：UI 与多智能体（可选）

| 读什么 | 学什么 | 批注版 |
| --- | --- | --- |
| [`src/coordinator/coordinatorMode.ts`](source/src/coordinator/coordinatorMode.ts) | 多智能体编排的模式开关 + 协调者提示词 | [✅](annotated/src/coordinator/coordinatorMode.ts) |
| [`src/tools/AgentTool/AgentTool.tsx`](source/src/tools/AgentTool/AgentTool.tsx) | 派活的十道检查、两套执行路径 | [✅](annotated/src/tools/AgentTool/AgentTool.tsx) |
| [`src/tools/AgentTool/prompt.ts`](source/src/tools/AgentTool/prompt.ts) | agent 清单注入策略、简报写法 | [✅](annotated/src/tools/AgentTool/prompt.ts) |
| [`src/tools/AgentTool/forkSubagent.ts`](source/src/tools/AgentTool/forkSubagent.ts) | fork：共享缓存的自我复制 | [✅](annotated/src/tools/AgentTool/forkSubagent.ts) |

**对应章节**：[12 UI 与多智能体](docs/12-UI与多智能体.md)、[10 子智能体与计划模式](docs/10-子智能体与计划模式.md)

**目标**：想做终端 UI 或多智能体产品时再深入。

**多智能体这四份读完之后，最值得带走的三条**：

1. **理解不可外包** —— 协调者提示词里最硬的一条是禁止写「based on your findings」。因为多智能体的失败模式几乎全是「协调者偷懒」：把思考推给下属、把判断推给时间、把结果推给想象。
2. **缓存的判据是字节，不是语义** —— fork 之所以便宜，是因为它的请求前缀和父进程逐字节相同。所以它宁可继承一份「教自己 fork」的错误提示词，也不肯换掉系统提示词（换了就全废）。
3. **动态内容一律往后放** —— agent 清单原本内联在工具描述里，成了全公司缓存创建开销的 10.2%。挪到消息流末尾之后归零。

---

### 第 8 步：终端渲染器（进阶，可选）

`src/ink/` 是**自己实现**的 Ink（不是官方 npm 包）：把 React 组件树画到终端格子上的整套内核，1.98 万行。**全部 96 个文件已批注完成**。它是这个仓库里唯一一处「和业务无关、纯基础设施」的代码，也是最能学到东西的一处——因为终端是一个比浏览器苛刻得多的渲染目标：没有 DOM、没有排版引擎、没有像素，只有一张 `rows × cols` 的字符格子，以及一串带状态的转义序列。

| 读什么 | 学什么 | 批注版 |
| --- | --- | --- |
| [`src/ink/reconciler.ts`](source/src/ink/reconciler.ts) | React 19 自定义 renderer：host config 把 mutation 语义翻译成树操作 | [✅](annotated/src/ink/reconciler.ts) |
| [`src/ink/dom.ts`](source/src/ink/dom.ts) | 七个元素名的极简 DOM、yoga 桥、文本测量、脏标记冒泡 | [✅](annotated/src/ink/dom.ts) |
| [`src/ink/ink.tsx`](source/src/ink/ink.tsx) | 帧循环九阶段、双缓冲、diff 与优化、光标定位、终端模式、退出清理 | [✅](annotated/src/ink/ink.tsx) |
| [`src/ink/screen.ts`](source/src/ink/screen.ts) | 打包格子（2 个 int 装一格）、样式池、宽字符四态、blit/shift/clear | [✅](annotated/src/ink/screen.ts) |
| [`src/ink/render-node-to-output.ts`](source/src/ink/render-node-to-output.ts) | 沿树做 blit / 清空 / 重画三选一；ScrollBox 三遍渲染 | [✅](annotated/src/ink/render-node-to-output.ts) |
| [`src/ink/output.ts`](source/src/ink/output.ts) | 一帧的操作队列：七种操作、Clip 栈、grapheme 聚类 | [✅](annotated/src/ink/output.ts) |
| [`src/ink/styles.ts`](source/src/ink/styles.ts) | 两套类型（字 / 盒子）与九个 apply | [✅](annotated/src/ink/styles.ts) |
| [`src/ink/termio/`](source/src/ink/termio/) | 终端转义序列解析（ansi / csi / dec / esc / sgr / tokenize / parser / osc） | 全部已批注 |

**对应章节**：[12 UI 与多智能体](docs/12-UI与多智能体.md)

**目标**：理解「终端 UI 为什么能像 GUI 一样增量更新」，以及那些看起来古怪的代码（`?1049h`、`unref()`、`writeSync`）各自在防什么。

**二十一份核心读完之后，最值得带走的六条**：

1. **终端里没有排版引擎，文字尺寸得自己算。** yoga 只管盒子，不识字宽，所以 `<Text>` 挂了一个 measure 回调（`dom.ts`），yoga 布局时问它「给这么宽你要多高」。这一个回调决定了为什么 `<Text>` 里不能放 `<Box>`、为什么裸字符串必须包在 `<Text>` 里。
2. **终端的 diff 是「两份屏幕缓冲之间的最小写入序列」。** 每帧画出一整屏格子，和上一帧逐格比较，只写变化的格子。这套机制的前提是「我们对屏幕状态的认知与物理终端一致」——而外部世界一直在破坏这个前提（tmux 重画、睡眠、SSH 断线），所以 `ink.tsx` 里一半的复杂度都是在把失步拉回来。
3. **一个格子只用 8 字节，而且「空」就是全 0。** `screen.ts` 把所有格子放进一条 `Int32Array`（每格两个 int），`ArrayBuffer` 分配即零填充，于是「没写过」天然等于「空格 + 无样式 + 窄 + 无链接」。
4. **性能优化全在「凭什么敢跳过」上。** 每处跳过都是一个断言，而断言总会被打破。读这个目录的正确姿势不是「它做了什么」，而是「它在什么条件下允许自己什么都不做」。
5. **同一个语义在不同终端上要发不同的字节。** `colorize.ts` 只 232 行，但承载了两个真实世界的适配：VS Code 系降级到 6×6×6 色立方（Claude 橙变肉粉）、tmux 转发时默认丢背景色。
6. **退出路径比正常路径更难写对。** `unmount()` 里那一串 `writeSync` 不是保守，是必需：`process.exit()` 会丢弃异步写，漏掉一条复位序列的后果是用户回到 shell 后打字看不见。

---

### 路线一图流

```
第1步 认门面      package.json / README / cli.tsx        [30 分钟]
   ↓
第2步 最小模块    clear/index.ts / commandSemantics.ts   [1 小时]
   ↓
第3步 初始化      setup.ts                               [2 小时]
   ↓
第4步 工具系统    tools.ts / BashTool / services/tools   [半天]  ★重点
   ↓
第5步 主循环      prompts.ts / query.ts / api/           [1 天]  ★核心
   ↓
第6步 服务层      mcp / compact / lsp / oauth            [半天]
   ↓
第7步 多智能体    coordinator / AgentTool / fork         [可选]
   ↓
第8步 终端渲染    ink/ 渲染内核                          [可选]
```

---

## 阅读技巧

### 三个高效阅读习惯

| 习惯 | 做法 | 为什么有效 |
| --- | --- | --- |
| **先看 import** | 每个文件先扫头部 import | 一眼看出它依赖谁、属于哪一层 |
| **先找 "source of truth"** | 找注释里的 these are all / source of truth | 大项目都有「唯一真相来源」，抓住它就不迷路 |
| **跳过埋点** | 看到 `tengu_`、`logEvent` 直接跳 | 那是内部监控，和理解逻辑无关 |

### 看不懂时的排查顺序

1. **是不是 `feature()` 分支？** —— 这个分支可能在你的版本里根本没实现，别硬找。
2. **是不是内部专用代码？** —— 看到 `USER_TYPE === 'ant'` 就是 Anthropic 内部员工专用，跳过。
3. **是不是埋点 / 遥测？** —— `tengu_` 开头的事件名，跳过。
4. **是不是类型体操？** —— 超长的类型名（如 `AnalyticsMetadata_I_VERIFIED_...`）是安全标记，不是逻辑。
5. **回到入口重走一遍** —— 从 `tools.ts` / `commands.ts` / `query.ts` 这三个「总闸」重新出发。

### 常用全局搜索（在 `source/` 里搜）

| 想找什么 | 搜什么 |
| --- | --- |
| 所有工具 | `getAllBaseTools` |
| 所有命令 | [`src/commands.ts`](source/src/commands.ts) 里的注册表 |
| 构建期开关 | `feature(` |
| 系统提示词片段 | `systemPromptSection` |
| 内部埋点 | `tengu_` |
| 权限判定 | `hasPermissionsToUseTool` |
| 主循环 | `while (true)` / `queryLoop` |
| MCP 连接 | `StdioClientTransport` |

### 如果你只想学一件事

> 如果你时间有限，只想学「AI Agent 到底怎么工作」，那么：**只读 [`src/query.ts`](source/src/query.ts) 的 `queryLoop()` 里那个 `while(true)`。**

它是所有 Agent 框架（LangChain、AutoGPT、Claude Code、Cursor）的共同本质：

```
while (true) {
  回复 = 调模型(消息历史, 工具清单)
  if (回复里没有工具调用) break        // 任务完成
  结果 = 执行工具(回复里的工具调用)
  消息历史.push(结果)                  // 回灌
}
```

把这段手写一遍（几十行就能跑），你会瞬间理解这个领域的一切。

---

## 目录结构

```
D:\CC泄露源码分析\
├── README.md                  ← 你正在看的这份：主索引 + 学习路线
├── docs\                      ← 专题分析（本手册正文，00–15 篇）
├── annotated\                 ← 中文批注版代码（学习时读这份）
│   ├── README.annotated.md
│   ├── package.json.annotated.md
│   └── src\                   ← 与 source/src 同路径的批注镜像
├── annotated-索引与进度.md      ← 批注约定 + 进度表 + 自测题（详细进度看这里）
├── scripts\                   ← 批注注入与校验工具
│   ├── annotate.py            ← 按行号注入批注，生成 annotated/ 镜像
│   ├── check-fidelity.py      ← 校验批注版没改动原文任何一行
│   └── check-links.py         ← 校验所有链接是否有效
├── source\                    ← 克隆的完整源码（仓库根）
│   ├── package.json           ← 分析对象之一（根目录共 7 个文件）
│   ├── node_modules\ · vendor\ ← 依赖与第三方代码（不分析）
│   └── src\                   ← 分析对象主体，1902 个文件
└── .backup\                   ← 大改造前的备份（可删）
```

> 提示：用 VSCode / Cursor 打开 `D:\CC泄露源码分析` 这个**文件夹**（不是单个文件），文档里的链接才能正确解析到 `source\`。

---

## 中文批注版代码（`annotated/`）

原版源码的英文注释没有中文，读起来费劲。所以另做了一套**批注版**：英文注释一字不删，每段下方紧跟中文对照。

**路径规则只有一条**：把路径第一段的 `source` 换成 `annotated`，其余一字不动。

```
source/src/setup.ts                 →  annotated/src/setup.ts
source/package.json                 →  annotated/package.json.annotated.md
source/README.md                    →  annotated/README.annotated.md
```

只有两个例外，都带 `.annotated.md` 后缀：`package.json` 是因为 JSON 写不了注释；`README.md` 是为了不和本文件（手册主索引）同名不同物。导航类文件（[`annotated-索引与进度.md`](annotated-索引与进度.md)）和校验脚本都放在 `annotated/` 外面，所以 `annotated/` 里看到的每个文件都能在 `source/` 里找到同名对应物。

> 注意：**`annotated/` 不是 `source/` 的全量副本**。`source/src` 有 1902 个文件，这里只批注学习路线走到的那些，其余仍在 `source/` 里按原样读。

标注方式只有四种，一眼能分清：

| 标记 | 含义 |
| --- | --- |
| 原文 | 英文原注释，一个字都没删 |
| `// 译：` | 紧跟英文之后，直译 |
| `// 注：` | 额外补充的解释（原文没有） |
| `// ── N. xxx ──` | 段落分隔，方便定位 |

**为什么另开目录而不直接改 `source/`**：插中文行会让后面所有行号下移，正文里大量链接、精确行号锚点就全废了。所以 `source/` 永远是行号基准，`annotated/` 才是学习时读的那份。

**行号口径**：批注正文里出现的「第 N 行」一律指 **`source/` 里的原始行号**。想核对就在 `source/` 下打开对应文件；批注版里的实际位置会靠后（因为前面插了注释），但批注就贴在它解释的那段代码上方，不需要靠行号导航。

**怎么保证批注不过界**：`scripts/check-fidelity.py` 会把批注版拆成「代码行 / 注释行 / 批注行」，要求代码行与原文**逐行完全相等**、原文注释**一字不差按序保留**。另外还有结构判据（块注释内部、多行模板字符串内部不许有中文）由 `annotate.py` 结构性拦截，避免中文被误插进代码或提示词字符串。

---

## 怎么从文档跳到源码

源码位置**标在讲它的那一节开头**，不在别处。每节标题下都有一行：

> 📁 本节源码：[`src/tools.ts`](source/src/tools.ts)

这一行就是该节的「源码索引」：告诉你在读的这段讲解对应哪个文件；有具体片段的，直接给到行号（如 `src/query.ts:263`），点一下打开文件。

跳到**具体行**取决于你用什么打开：

| 打开方式 | 点链接 | 到具体行 |
| --- | --- | --- |
| VSCode 内置 Markdown 预览 | 打开该文件 | `Ctrl+G` 输行号 |
| Typora / Markdown Preview Enhanced | 打开该文件 | 直接跳到 `#L362` 那一行 |
| GitHub 网页 | 打开该文件 | 直接跳行 |

最快的定位办法是 **`Ctrl+P` 输路径 → `Ctrl+G` 输行号**：

```
Ctrl+P → source/src/Tool.ts → 回车 → Ctrl+G → 362 → 回车
```

**三个更快的定位技巧**

1. **跳转到定义**：在 `source/` 里按住 **Ctrl**（Mac 是 Cmd）点函数名 → 跳到定义；按 **Alt+←** 返回上一处。
2. **全文搜索锚点**：`Ctrl+Shift+F` 搜文档里写的行号注释（如 `Tool.ts:362`），能同时看到文档和源码两侧。
3. **vscode 协议直达**：把下面这行粘进浏览器地址栏，会直接打开 VSCode 并定位到第 362 行：

```
vscode://file/D:/CC泄露源码分析/source/src/Tool.ts:362
```

> 代码块的首行注释也标了同一个位置（如 `// src/Tool.ts:362-416`），照抄就能在源码里搜到。少数代码块是「结构简化示意」而非逐行原文，注释里会写明。

---

## 完整性说明

- `src/` 下 **1,902 个文件**已与 GitHub 官方文件树（`git/trees/main?recursive=1`）**逐条比对，零缺失**。
- `src/services/` 下 **130 个文件**同样逐条核对，**无缺失、无空壳**。
- `source/src` 按行数覆盖 **100%** 批注；目录文件数统计均来自本地实际克隆，不是估算。
- 改了文档后跑 `python scripts/check-links.py` 可复验所有链接（当前：失效 0）。

---

👉 完整进度、批注约定、自测题入口：[`annotated-索引与进度.md`](annotated-索引与进度.md)
