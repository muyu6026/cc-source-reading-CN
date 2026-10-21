# Claude Code 源码学习手册（中文注释版）

> **分析对象**：`github.com/hangsman/claude-code-source` 的 `src/` 目录
> **版本**：`2.1.88`（`package.json` 中声明）
> **源码位置**：本目录下的 `source/`（已完整克隆，`src/` 共 1902 个文件）
> **写给谁**：想通过读源码学架构、但不太熟悉英文的同学
> **本手册做什么**：给出分析方案 + 标注源码位置与片段 + 文件夹/术语/英文注释中英文对照

---

## 一分钟看懂这个项目

`Claude Code` 是 Anthropic 出品的**终端里运行的 AI 编程智能体**（agentic coding tool）。它不是普通聊天框，而是能**读你的代码库、改文件、跑终端命令**的"会动手的 AI"。

一句话概括它的运行方式：

```
你输入一句话  →  主循环把消息 + 工具清单发给 Claude  →  模型说"我要调某个工具"
      ↑                                                          ↓
      └──────── 工具结果塞回对话，继续下一轮  ←──────── 权限检查 → 执行工具
```

代码层面，所谓"AI 智能体"就是一个 `while(true)` 循环 + "调用模型 → 执行工具 → 回灌结果"。本手册第 06 篇会把这个循环本体育给你看。

---

## ⚠️ 开始前必须知道的两件事

**1. 这是打包版，不能直接运行。**
`package.json` 的 `dependencies` 是空的（`{}`），依赖在构建时被 Bun 内联了。`npm install` 后并跑不起来——请把它当**源码阅读对象**，不要试图直接运行。

**2. 满屏的 `feature('XXX')` 是构建期开关。**
这是 Bun 的**死代码消除（dead code elimination）**：只有开关打开的分支才会被打进最终包，没开的整段被删。所以你看到的 `feature('KAIROS')`、`feature('COORDINATOR_MODE')` 等分支，在你手上的版本里**可能根本不存在**。读代码时别被它绕晕。

---

## 文档目录（按顺序读，或按需跳）

| 序号 | 章节 | 一句话内容 | 适合什么时候读 |
|------|------|------------|----------------|
| [01](docs/01-项目总览与架构.md) | 项目总览与架构 | 技术栈、整体架构图、数据流 | 第一天，先建立全局印象 |
| [02](docs/02-目录结构中英对照.md) | 目录结构中英对照 | `src/` 每个目录的英文 / 文件数 / 中文含义 | 想找"某个功能在哪个目录"时查 |
| [03](docs/03-启动流程.md) | 启动流程 | `cli.tsx` → `main()` → `setup()` 三棒接力 | 想懂"程序怎么起来的" |
| [04](docs/04-工具系统.md) | 工具系统 | 工具注册中心 `tools.ts` + 工具执行流水线 | **重点**：AI 的"双手" |
| [05](docs/05-提示词与命令.md) | 提示词与命令 | 系统提示词怎么拼、斜杠命令怎么写 | 想学 prompt 工程 / 加命令 |
| [06](docs/06-对话主循环与模型调用.md) | 对话主循环与模型调用 | `while(true)` 循环 + 调 API + 重试 | **最重要**：AI Agent 的心脏 |
| [07](docs/07-服务层详解.md) | 服务层详解 | `services/` 130 个文件逐模块讲 | 想搞懂 MCP / 埋点 / LSP / 登录 |
| [08](docs/08-权限与安全.md) | 权限与安全 | allow / ask / deny 三态判定、6 种模式 | 想学"AI 怎么安全地动手" |
| [09](docs/09-配置系统.md) | 配置系统 | 全局 / 项目 / 企业托管三层配置 | 想知道"设置存在哪" |
| [10](docs/10-子智能体与计划模式.md) | 子智能体与计划模式 | 让 AI 派 AI 干活、先规划后执行 | 想学多智能体 / Plan 模式 |
| [11](docs/11-上下文压缩.md) | 上下文压缩 | 长对话怎么不爆窗口（compact） | 想懂"为什么能聊很久" |
| [12](docs/12-UI与多智能体.md) | UI 与多智能体 | React + Ink 终端渲染、协调器模式 | 对界面 / 多智能体感兴趣 |
| [13](docs/13-中英文术语对照.md) | 中英文术语对照 | 架构术语、英文 prompt、缩写全表 | 随时查词 |
| [14](docs/14-底层运行时与基础设施.md) | 底层运行时与基础设施 | cli / bridge / remote / server / tasks / state / vim / migrations 等 | 想搞懂"程序怎么跑起来" |
| [15](docs/15-常量·技能与伙伴系统.md) | 常量·技能·伙伴系统 | constants 全表、多智能体权限矩阵、skills、buddy 宠物 | 想懂工具/Agent 的权限边界 |

> 学习路线不单独成篇，就写在下面这一节——先看路线，再按路线翻上面的篇目。

---

## 学习路线（七步，按顺序读）

> 不知道怎么下手时，照这条线走。每步都标了耗时和对应章节，走完就对整个项目有了完整的认识。

### 第 1 步：先认门面（约 30 分钟）

> 📁 本节源码：[`src/entrypoints/cli.tsx`](source/src/entrypoints/cli.tsx)
> ✍️ 中文批注版：[`package.json`](annotated/package.json.annotated.md) · [仓库 README](annotated/README.annotated.md) · [`cli.tsx`](annotated/src/entrypoints/cli.tsx)

| 读什么 | 学什么 |
|--------|--------|
| `package.json` | 技术栈是什么；知道"这是打包版，不能直接跑" |
| `README.md` | 它到底是干嘛的 |
| [`src/entrypoints/cli.tsx`](source/src/entrypoints/cli.tsx) 前 120 行 | "快速路径 + 动态 import"的套路 |

**目标**：不再对这个项目感到陌生。

---

### 第 2 步：读一个最小模块（约 1 小时）

> 📁 本节源码：
> - [`src/commands/clear/index.ts`](source/src/commands/clear/index.ts)
> - [`src/tools/BashTool/commandSemantics.ts`](source/src/tools/BashTool/commandSemantics.ts)
> ✍️ 中文批注版：[`clear/index.ts`](annotated/src/commands/clear/index.ts) · [`commandSemantics.ts`](annotated/src/tools/BashTool/commandSemantics.ts)

| 读什么 | 为什么选它 |
|--------|------------|
| [`src/commands/clear/index.ts`](source/src/commands/clear/index.ts) | 19 行，命令模板的极简范例 |
| [`src/tools/BashTool/commandSemantics.ts`](source/src/tools/BashTool/commandSemantics.ts) | 3.8 KB，讲"退出码语义"，逻辑独立 |

**目标**：建立信心。这两个文件小、注释全，是**英语 + 架构双语入门**的最佳材料。

---

### 第 3 步：读初始化流程（约 2 小时）

> 📁 本节源码：[`src/setup.ts`](source/src/setup.ts)
> ✍️ 中文批注版：[`setup.ts`](annotated/src/setup.ts)（477 行全文件，按「顺序即知识」逐段讲）

| 读什么 | 学什么 |
|--------|--------|
| [`src/setup.ts`](source/src/setup.ts) 通读 | 一个会话"出生"要经过哪些步骤 |

**做法**：把每段英文注释翻译成中文对照（这正是本手册 [03 篇](docs/03-启动流程.md)做的事）。

**目标**：理解"程序怎么起来的"。

---

### 第 4 步：读工具系统（重点，约半天）

> 📁 本节源码：
> - [`src/tools.ts`](source/src/tools.ts)
> - [`src/tools/BashTool/bashSecurity.ts`](source/src/tools/BashTool/bashSecurity.ts)
> - [`src/tools/BashTool/bashPermissions.ts`](source/src/tools/BashTool/bashPermissions.ts)
> - [`src/Tool.ts`](source/src/Tool.ts)

| 读什么 | 学什么 |
|--------|--------|
| [`src/tools.ts`](source/src/tools.ts) | 工具户口本（`getAllBaseTools`） |
| [`src/Tool.ts`](source/src/Tool.ts) | 工具的类型 / 基类定义 |
| [`src/tools/BashTool/bashSecurity.ts`](source/src/tools/BashTool/bashSecurity.ts) | AI 怎么安全执行命令（危险命令识别） |
| [`src/tools/BashTool/bashPermissions.ts`](source/src/tools/BashTool/bashPermissions.ts) | 权限判定 |
| `src/services/tools/` | 工具执行流水线（并发 / 钩子 / 编排） |

> ✍️ 中文批注版：[`Tool.ts`](annotated/src/Tool.ts)（792 → 2,013 行，按「一个工具的一生」十二步逐字段讲）· [`tools.ts`](annotated/src/tools.ts)（389 → 647 行，工具户口本）· [`BashTool.tsx`](annotated/src/tools/BashTool/BashTool.tsx)（1,143 → 1,757 行，最复杂的工具实现）· [`bashSecurity.ts`](annotated/src/tools/BashTool/bashSecurity.ts)（2,592 → 3,658 行，22 个 validator 的编排）· [`bashPermissions.ts`](annotated/src/tools/BashTool/bashPermissions.ts)（2,621 → 3,906 行，895 行主函数的权限裁决）
> 前半已完成；后半（`tools.ts` 注册表 + `BashTool/` 实现）待续。

**对应章节**：[04 工具系统](docs/04-工具系统.md)、[08 权限与安全](docs/08-权限与安全.md)

**目标**：理解 AI 的"双手"和"安全护栏"。

---

### 第 5 步：读"AI 大脑接线"（最重要，约 1 天）

> 📁 本节源码：
> - [`src/constants/prompts.ts`](source/src/constants/prompts.ts)
> - [`src/query.ts`](source/src/query.ts)
> - [`src/QueryEngine.ts`](source/src/QueryEngine.ts)
> - [`src/services/api/claude.ts`](source/src/services/api/claude.ts)
> - [`src/services/api/withRetry.ts`](source/src/services/api/withRetry.ts)

| 读什么 | 学什么 |
|--------|--------|
| [`src/constants/prompts.ts`](source/src/constants/prompts.ts) | 系统提示词怎么拼 |
| [`src/query.ts`](source/src/query.ts) | 对话主循环的真身 `while(true)` |
| [`src/QueryEngine.ts`](source/src/QueryEngine.ts) | 查询引擎（流程编排） |
| [`src/services/api/claude.ts`](source/src/services/api/claude.ts) | 真正调 API 的地方 |
| [`src/services/api/withRetry.ts`](source/src/services/api/withRetry.ts) | 重试 / 退避 / 限流 |

**对应章节**：[05 提示词与命令](docs/05-提示词与命令.md)、[06 对话主循环与模型调用](docs/06-对话主循环与模型调用.md)

**目标**：彻底理解"AI Agent 怎么工作"。**这是整条路线的核心，值得多花时间。**

---

### 第 6 步：读服务层（按需，约半天）

> 📁 本节源码：
> - [`src/services/mcp/client.ts`](source/src/services/mcp/client.ts)
> - [`src/services/compact/autoCompact.ts`](source/src/services/compact/autoCompact.ts)
> - [`src/services/lsp/manager.ts`](source/src/services/lsp/manager.ts)
> - [`src/services/oauth/client.ts`](source/src/services/oauth/client.ts)

| 读什么 | 学什么 |
|--------|--------|
| [`src/services/mcp/client.ts`](source/src/services/mcp/client.ts) + `config.ts` | 怎么连外部工具 |
| [`src/services/compact/autoCompact.ts`](source/src/services/compact/autoCompact.ts) | 长对话怎么不爆窗口 |
| [`src/services/lsp/manager.ts`](source/src/services/lsp/manager.ts) | 代码智能怎么接 |
| [`src/services/oauth/client.ts`](source/src/services/oauth/client.ts) | 登录鉴权 |

**对应章节**：[07 服务层详解](docs/07-服务层详解.md)、[11 上下文压缩](docs/11-上下文压缩.md)

**目标**：知道"功能后端"都有哪些能力，需要哪个查哪个。

---

### 第 7 步：UI 与多智能体（可选）

> 📁 本节源码：[`src/commands/agents/agents.tsx`](source/src/commands/agents/agents.tsx)

| 读什么 | 学什么 |
|--------|--------|
| `src/components/` + `src/ink/` | 终端界面怎么画（389 个文件，很大，按需） |
| `src/coordinator/` | 多智能体编排 |
| [`src/commands/agents/agents.tsx`](source/src/commands/agents/agents.tsx) + `AgentTool` | 角色化团队 |

**对应章节**：[12 UI 与多智能体](docs/12-UI与多智能体.md)、[10 子智能体与计划模式](docs/10-子智能体与计划模式.md)

**目标**：想做终端 UI 或多智能体产品时再深入。

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
第7步 UI/多智能体 components / coordinator               [可选]
```

---

### 三个高效阅读习惯

| 习惯 | 做法 | 为什么有效 |
|------|------|------------|
| **先看 import** | 每个文件先扫头部 import | 一眼看出它依赖谁、属于哪一层 |
| **先找 "source of truth"** | 找注释里的 these are all / source of truth | 大项目都有"唯一真相来源"，抓住它就不迷路 |
| **跳过埋点** | 看到 `tengu_`、`logEvent` 直接跳 | 那是内部监控，和理解逻辑无关 |

### 看不懂时的排查顺序

1. **是不是 `feature()` 分支？** —— 这个分支可能在你的版本里根本没实现，别硬找。
2. **是不是内部专用代码？** —— 看到 `USER_TYPE === 'ant'` 就是 Anthropic 内部员工专用，跳过。
3. **是不是埋点 / 遥测？** —— `tengu_` 开头的事件名，跳过。
4. **是不是类型体操？** —— 超长的类型名（如 `AnalyticsMetadata_I_VERIFIED_...`）是安全标记，不是逻辑。
5. **回到入口重走一遍** —— 从 `tools.ts` / `commands.ts` / `query.ts` 这三个"总闸"重新出发。

### 常用全局搜索（在 `source/` 里搜）

> 📁 本节源码：[`src/commands.ts`](source/src/commands.ts)

| 想找什么 | 搜什么 |
|----------|--------|
| 所有工具 | `getAllBaseTools` |
| 所有命令 | [`src/commands.ts`](source/src/commands.ts) 里的注册表 |
| 构建期开关 | `feature(` |
| 系统提示词片段 | `systemPromptSection` |
| 内部埋点 | `tengu_` |
| 权限判定 | `hasPermissionsToUseTool` |
| 主循环 | `while (true)` / `queryLoop` |
| MCP 连接 | `StdioClientTransport` |

### 如果你只想学一件事

> 📁 本节源码：[`src/query.ts`](source/src/query.ts)

如果你时间有限，只想学"AI Agent 到底怎么工作"，那么：

> **只读 [`src/query.ts`](source/src/query.ts) 的 `queryLoop()` 里那个 `while(true)`。**

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
├── docs\                      ← 15 篇专题分析（本手册正文）
│   ├── 01-项目总览与架构.md
│   ├── 02-目录结构中英对照.md
│   ├── 03-启动流程.md
│   ├── 04-工具系统.md
│   ├── 05-提示词与命令.md
│   ├── 06-对话主循环与模型调用.md
│   ├── 07-服务层详解.md
│   ├── 08-权限与安全.md
│   ├── 09-配置系统.md
│   ├── 10-子智能体与计划模式.md
│   ├── 11-上下文压缩.md
│   ├── 12-UI与多智能体.md
│   ├── 13-中英文术语对照.md
│   ├── 14-底层运行时与基础设施.md
│   └── 15-常量·技能与伙伴系统.md
├── annotated\                 ← 中文批注版代码（学习时读这份）
│   ├── README.annotated.md
│   ├── package.json.annotated.md
│   └── src\
│       ├── commands\clear\index.ts
│       ├── entrypoints\cli.tsx
│       ├── setup.ts
│       ├── Tool.ts
│       ├── tools.ts
│       └── tools\BashTool\  BashTool.tsx · bashSecurity.ts · bashPermissions.ts · commandSemantics.ts
├── annotated-索引与进度.md      ← 批注约定 + 进度表 + 自测题
├── scripts\
│   ├── annotate.py            ← 按行号注入批注，生成 annotated/ 镜像
│   ├── check-fidelity.py      ← 校验批注版没改动原文任何一行
│   └── check-links.py         ← 校验所有链接是否有效
├── source\                    ← 克隆的完整源码（仓库根）
│   ├── package.json           ← 分析对象之一（根目录共 7 个文件）
│   ├── cli.js  bun.lock  LICENSE.md  README.md  cli.js.map  sdk-tools.d.ts
│   ├── node_modules\ · vendor\ ← 依赖与第三方代码（不分析）
│   └── src\                   ← 分析对象主体，1902 个文件
└── .backup\                   ← 大改造前的备份（可删）
```

> 提示：用 VSCode / Cursor 打开 `D:\CC泄露源码分析` 这个**文件夹**（不是单个文件），文档里的链接才能正确解析到 `source\`。

---

## 中文批注版代码（`annotated/`）

原版源码的英文注释没有中文，读起来费劲。所以另做了一套**批注版**：英文注释一字不删，每段下方紧跟中文对照。

```
annotated/                        ← 只放与 source/ 同路径的文件
├── README.annotated.md           ← 仓库自带 README 的中英对照
├── package.json.annotated.md     ← JSON 不能写注释，改用逐条讲解
└── src/
    ├── entrypoints/cli.tsx       ← 全 302 行，逐段「译 / 注」
    ├── setup.ts                  ← 全 477 行，启动编排的完整批注
    ├── Tool.ts                   ← 全 792 行，工具契约的逐字段批注
    ├── tools.ts                  ← 全 389 行，工具户口本（45 个工具 + 两套条件加载）
    ├── commands/clear/index.ts   ← 19 行，斜杠命令的最小模板
    └── tools/BashTool/
        ├── BashTool.tsx          ← 全 1,143 行，最复杂的工具实现
        ├── bashSecurity.ts       ← 全 2,592 行，22 个危险检测的编排
        ├── bashPermissions.ts    ← 全 2,621 行，权限裁决（895 行主函数）
        └── commandSemantics.ts   ← 退出码语义判定表
```

**路径规则只有一条**：把路径第一段的 `source` 换成 `annotated`，其余一字不动。

```
source/src/setup.ts                 →  annotated/src/setup.ts
source/package.json                 →  annotated/package.json.annotated.md
source/README.md                    →  annotated/README.annotated.md
```

只有两个例外，都带 `.annotated.md` 后缀：`package.json` 是因为 JSON 写不了注释；`README.md` 是为了不和本文件（手册主索引）同名不同物。导航类文件（[`annotated-索引与进度.md`](annotated-索引与进度.md)）和校验脚本都放在 `annotated/` 外面，所以 `annotated/` 里看到的每个文件都能在 `source/` 里找到同名对应物。

另外要清楚：**`annotated/` 不是 `source/` 的全量副本**。`source/src` 有 1902 个文件，这里只批注学习路线走到的那些，其余仍在 `source/` 里按原样读。

标注方式只有四种，一眼能分清：

| 标记 | 含义 |
|------|------|
| 原文 | 英文原注释，一个字都没删 |
| `// 译：` | 紧跟英文之后，直译 |
| `// 注：` | 额外补充的解释（原文没有） |
| `// ── N. xxx ──` | 段落分隔，方便定位 |

**为什么另开目录而不直接改 `source/`**：插中文行会让后面所有行号下移，正文里 225 处链接、48 个精确行号锚点就全废了。所以 `source/` 永远是行号基准，`annotated/` 才是学习时读的那份。

**怎么保证批注不过界**：`scripts/check-fidelity.py` 会把批注版拆成「代码行 / 注释行 / 批注行」，要求代码行与原文**逐行完全相等**、原文注释**一字不差按序保留**。跑一次就能确认没改源码、没漏括号。

进度：**第 1～3 步已完成**（`package.json` + 仓库 README + `cli.tsx`；`clear/index.ts` + `commandSemantics.ts`；`setup.ts` 全 477 行）；**第 4 步全部完成**（`Tool.ts` 792 + `tools.ts` 389 + `BashTool.tsx` 1,143 + `bashSecurity.ts` 2,592 + `bashPermissions.ts` 2,621，合计 7,537 行原文全批注）。下一步是第 5 步主循环。

👉 入口：[`annotated-索引与进度.md`](annotated-索引与进度.md)

---

## 怎么从文档跳到源码

源码位置**标在讲它的那一节开头**，不在别处。每节标题下都有一行：

> 📁 本节源码：[`src/tools.ts`](source/src/tools.ts)

这一行就是该节的"源码索引"：告诉你在读的这段讲解对应哪个文件；有具体片段的，直接给到行号（如 `src/query.ts:263`），点一下打开文件。

全手册共 **225 处**这样的源码链接（跑 `scripts/check-links.py` 可复算），覆盖 **78 个文件**，其中 **48 处精确到行**。有些节涉及同一文件的多个片段，会写成「文件名 — `52-55` · `170-178`」，两个区间分别可点。

跳到**具体行**取决于你用什么打开：

| 打开方式 | 点链接 | 到具体行 |
|---------|--------|---------|
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

> 代码块的首行注释也标了同一个位置（如 `// src/Tool.ts:362-416`），照抄就能在源码里搜到。少数代码块是"结构简化示意"而非逐行原文，注释里会写明，例如 `permissions.ts:473-956（结构简化示意，真实函数 484 行）`。

---

## 完整性说明

- `src/` 下 **1902 个文件**已与 GitHub 官方文件树（`git/trees/main?recursive=1`）**逐条比对，零缺失**。
- `src/services/` 下 **130 个文件**同样逐条核对，**无缺失、无空壳**（0 行文件数为 0）。
- 目录文件数统计均来自本地实际克隆，不是估算。
- 改了文档后跑 `python scripts/check-links.py` 可复验所有链接（当前：失效 0）。
