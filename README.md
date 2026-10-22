# Claude Code 源码学习手册（中文注释版）

> **分析对象**：`github.com/hangsman/claude-code-source` 的 `src/` 目录  
> **版本**：`2.1.88`（`package.json` 中声明）  
> **源码位置**：本目录下的 `source/`（已完整克隆，`src/` 共 1902 个文件）  
> **写给谁**：想通过读源码学架构、但不太熟悉英文的同学  
> **本手册做什么**：给出分析方案 + 标注源码位置与片段 + 文件夹/术语/英文注释中英文对照
> **当前进度**：`annotated/` 已批注 **298 个源码文件 / 100,524 行**（`source/src` 共 1,902 文件 / 513,237 行，按行数覆盖 **19%**）。数字由 `python scripts/check-coverage.py src` 实算，不手数；`src/services/` 的细账见[索引与进度 · 第 6 步](annotated-索引与进度.md#第-6-步服务层做到哪了17-个子目录清零全目录-120130)。

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

| 序号                          | 章节         | 一句话内容                                                               | 适合什么时候读                 |
| --------------------------- | ---------- | ------------------------------------------------------------------- | ----------------------- |
| [01](docs/01-项目总览与架构.md)    | 项目总览与架构    | 技术栈、整体架构图、数据流                                                       | 第一天，先建立全局印象             |
| [02](docs/02-目录结构中英对照.md)   | 目录结构中英对照   | `src/` 每个目录的英文 / 文件数 / 中文含义                                         | 想找"某个功能在哪个目录"时查         |
| [03](docs/03-启动流程.md)       | 启动流程       | `cli.tsx` → `main()` → `setup()` 三棒接力                               | 想懂"程序怎么起来的"             |
| [04](docs/04-工具系统.md)       | 工具系统       | 工具注册中心 `tools.ts` + 工具执行流水线                                         | **重点**：AI 的"双手"         |
| [05](docs/05-提示词与命令.md)     | 提示词与命令     | 系统提示词怎么拼、斜杠命令怎么写                                                    | 想学 prompt 工程 / 加命令      |
| [06](docs/06-对话主循环与模型调用.md) | 对话主循环与模型调用 | `while(true)` 循环 + 调 API + 重试                                       | **最重要**：AI Agent 的心脏    |
| [07](docs/07-服务层详解.md)      | 服务层详解      | `services/` 130 个文件逐模块讲                                             | 想搞懂 MCP / 埋点 / LSP / 登录 |
| [08](docs/08-权限与安全.md)      | 权限与安全      | allow / ask / deny 三态判定、6 种模式                                       | 想学"AI 怎么安全地动手"          |
| [09](docs/09-配置系统.md)       | 配置系统       | 全局 / 项目 / 企业托管三层配置                                                  | 想知道"设置存在哪"              |
| [10](docs/10-子智能体与计划模式.md)  | 子智能体与计划模式  | 让 AI 派 AI 干活、先规划后执行                                                 | 想学多智能体 / Plan 模式        |
| [11](docs/11-上下文压缩.md)      | 上下文压缩      | 长对话怎么不爆窗口（compact）                                                  | 想懂"为什么能聊很久"             |
| [12](docs/12-UI与多智能体.md)    | UI 与多智能体   | React + Ink 终端渲染、协调器模式                                              | 对界面 / 多智能体感兴趣           |
| [13](docs/13-中英文术语对照.md)    | 中英文术语对照    | 架构术语、英文 prompt、缩写全表                                                 | 随时查词                    |
| [14](docs/14-底层运行时与基础设施.md) | 底层运行时与基础设施 | cli / bridge / remote / server / tasks / state / vim / migrations 等 | 想搞懂"程序怎么跑起来"            |
| [15](docs/15-常量·技能与伙伴系统.md) | 常量·技能·伙伴系统 | constants 全表、多智能体权限矩阵、skills、buddy 宠物                               | 想懂工具/Agent 的权限边界        |

> 学习路线不单独成篇，就写在下面这一节——先看路线，再按路线翻上面的篇目。

---

## 学习路线（七步，按顺序读）

> 不知道怎么下手时，照这条线走。每步都标了耗时和对应章节，走完就对整个项目有了完整的认识。

### 第 1 步：先认门面（约 30 分钟）

> 📁 本节源码：[`src/entrypoints/cli.tsx`](source/src/entrypoints/cli.tsx)  
> ✍️ 中文批注版：[`package.json`](annotated/package.json.annotated.md) · [仓库 README](annotated/README.annotated.md) · [`cli.tsx`](annotated/src/entrypoints/cli.tsx)

| 读什么                                                                 | 学什么                    |
| ------------------------------------------------------------------- | ---------------------- |
| `package.json`                                                      | 技术栈是什么；知道"这是打包版，不能直接跑" |
| `README.md`                                                         | 它到底是干嘛的                |
| [`src/entrypoints/cli.tsx`](source/src/entrypoints/cli.tsx) 前 120 行 | "快速路径 + 动态 import"的套路  |

**目标**：不再对这个项目感到陌生。

---

### 第 2 步：读一个最小模块（约 1 小时）

> 📁 本节源码：
>
> - [`src/commands/clear/index.ts`](source/src/commands/clear/index.ts)
> - [`src/tools/BashTool/commandSemantics.ts`](source/src/tools/BashTool/commandSemantics.ts)  
>   ✍️ 中文批注版：[`clear/index.ts`](annotated/src/commands/clear/index.ts) · [`commandSemantics.ts`](annotated/src/tools/BashTool/commandSemantics.ts)

| 读什么                                                                                       | 为什么选它                |
| ----------------------------------------------------------------------------------------- | -------------------- |
| [`src/commands/clear/index.ts`](source/src/commands/clear/index.ts)                       | 19 行，命令模板的极简范例       |
| [`src/tools/BashTool/commandSemantics.ts`](source/src/tools/BashTool/commandSemantics.ts) | 3.8 KB，讲"退出码语义"，逻辑独立 |

**目标**：建立信心。这两个文件小、注释全，是**英语 + 架构双语入门**的最佳材料。

---

### 第 3 步：读初始化流程（约 2 小时）

> 📁 本节源码：[`src/setup.ts`](source/src/setup.ts)  
> ✍️ 中文批注版：[`setup.ts`](annotated/src/setup.ts)（477 行全文件，按「顺序即知识」逐段讲）

| 读什么                                      | 学什么             |
| ---------------------------------------- | --------------- |
| [`src/setup.ts`](source/src/setup.ts) 通读 | 一个会话"出生"要经过哪些步骤 |

**做法**：把每段英文注释翻译成中文对照（这正是本手册 [03 篇](docs/03-启动流程.md)做的事）。

**目标**：理解"程序怎么起来的"。

---

### 第 4 步：读工具系统（重点，约半天）

> 📁 本节源码：
>
> - [`src/tools.ts`](source/src/tools.ts)
> - [`src/tools/BashTool/bashSecurity.ts`](source/src/tools/BashTool/bashSecurity.ts)
> - [`src/tools/BashTool/bashPermissions.ts`](source/src/tools/BashTool/bashPermissions.ts)
> - [`src/Tool.ts`](source/src/Tool.ts)

| 读什么                                                                                     | 学什么                      |
| --------------------------------------------------------------------------------------- | ------------------------ |
| [`src/tools.ts`](source/src/tools.ts)                                                   | 工具户口本（`getAllBaseTools`） |
| [`src/Tool.ts`](source/src/Tool.ts)                                                     | 工具的类型 / 基类定义             |
| [`src/tools/BashTool/bashSecurity.ts`](source/src/tools/BashTool/bashSecurity.ts)       | AI 怎么安全执行命令（危险命令识别）      |
| [`src/tools/BashTool/bashPermissions.ts`](source/src/tools/BashTool/bashPermissions.ts) | 权限判定                     |
| `src/services/tools/`                                                                   | 工具执行流水线（并发 / 钩子 / 编排）    |

> ✍️ 中文批注版：[`Tool.ts`](annotated/src/Tool.ts)（792 → 2,013 行，按「一个工具的一生」十二步逐字段讲）· [`tools.ts`](annotated/src/tools.ts)（389 → 647 行，工具户口本）· [`BashTool.tsx`](annotated/src/tools/BashTool/BashTool.tsx)（1,143 → 1,757 行，最复杂的工具实现）· [`bashSecurity.ts`](annotated/src/tools/BashTool/bashSecurity.ts)（2,592 → 3,658 行，22 个 validator 的编排）· [`bashPermissions.ts`](annotated/src/tools/BashTool/bashPermissions.ts)（2,621 → 3,906 行，895 行主函数的权限裁决）  
> 前半已完成；后半（`tools.ts` 注册表 + `BashTool/` 实现）待续。

**对应章节**：[04 工具系统](docs/04-工具系统.md)、[08 权限与安全](docs/08-权限与安全.md)

**目标**：理解 AI 的"双手"和"安全护栏"。

---

### 第 5 步：读"AI 大脑接线"（最重要，约 1 天）

> 📁 本节源码：
>
> - [`src/constants/prompts.ts`](source/src/constants/prompts.ts)
> - [`src/query.ts`](source/src/query.ts)
> - [`src/QueryEngine.ts`](source/src/QueryEngine.ts)
> - [`src/services/api/claude.ts`](source/src/services/api/claude.ts)
> - [`src/services/api/withRetry.ts`](source/src/services/api/withRetry.ts)

| 读什么                                                                     | 学什么                               | 批注版                                                       |
| ----------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------- |
| [`src/constants/prompts.ts`](source/src/constants/prompts.ts)           | 系统提示词怎么拼                          | [✅ 914 → 2,042 行](annotated/src/constants/prompts.ts)     |
| [`src/query.ts`](source/src/query.ts)                                   | 对话主循环的真身 `while(true)`            | [✅ 1,729 → 3,305 行](annotated/src/query.ts)               |
| [`src/QueryEngine.ts`](source/src/QueryEngine.ts)                       | 查询引擎（流程编排）                        | [✅ 1,295 → 2,572 行](annotated/src/QueryEngine.ts)         |
| [`src/services/api/claude.ts`](source/src/services/api/claude.ts)       | 真正调 API 的地方（SSE 解析 + 缓存打点 + 三级降级） | [✅ 3,419 → 4,656 行](annotated/src/services/api/claude.ts) |
| [`src/services/api/withRetry.ts`](source/src/services/api/withRetry.ts) | 重试 / 退避 / 限流                      | ⬜ 待批注（归入第 6 步）                                            |

**对应章节**：[05 提示词与命令](docs/05-提示词与命令.md)、[06 对话主循环与模型调用](docs/06-对话主循环与模型调用.md)

**目标**：彻底理解"AI Agent 怎么工作"。**这是整条路线的核心，值得多花时间。**

---

### 第 6 步：读服务层（按需，约半天）

> 📁 本节源码：
>
> - [`src/services/mcp/client.ts`](source/src/services/mcp/client.ts)
> - [`src/services/mcp/auth.ts`](source/src/services/mcp/auth.ts)
> - [`src/services/mcp/xaa.ts`](source/src/services/mcp/xaa.ts)
> - [`src/services/mcp/useManageMCPConnections.ts`](source/src/services/mcp/useManageMCPConnections.ts)
> - [`src/services/compact/autoCompact.ts`](source/src/services/compact/autoCompact.ts)
> - [`src/services/lsp/manager.ts`](source/src/services/lsp/manager.ts)
> - [`src/services/oauth/client.ts`](source/src/services/oauth/client.ts)

| 读什么                                                                                                   | 学什么                                           | 批注版                                                                        |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------- |
| [`src/services/api/withRetry.ts`](source/src/services/api/withRetry.ts)                               | 重试 / 退避 / 529 白名单 / 无限重试                      | [✅ 822 → 1,419 行](annotated/src/services/api/withRetry.ts)                 |
| [`src/services/compact/apiMicrocompact.ts`](source/src/services/compact/apiMicrocompact.ts)           | 发给 API 的 `context_management` 指令              | [✅ 153 → 329 行](annotated/src/services/compact/apiMicrocompact.ts)         |
| [`src/services/compact/autoCompact.ts`](source/src/services/compact/autoCompact.ts)                   | 什么时候压、四道抑制闸门、熔断                               | [✅ 351 → 668 行](annotated/src/services/compact/autoCompact.ts)             |
| [`src/services/compact/compact.ts`](source/src/services/compact/compact.ts)                           | 摘要压缩本体、PTL 逃生舱、七类附件重建                         | [✅ 1,705 → 3,629 行](annotated/src/services/compact/compact.ts)             |
| [`src/services/compact/microCompact.ts`](source/src/services/compact/microCompact.ts)                 | 三条微压缩路径、缓存编辑、时间触发                             | [✅ 530 → 1,353 行](annotated/src/services/compact/microCompact.ts)          |
| [`src/services/compact/sessionMemoryCompact.ts`](source/src/services/compact/sessionMemoryCompact.ts) | 零调用压缩、索引对齐、两种恢复场景                             | [✅ 630 → 1,518 行](annotated/src/services/compact/sessionMemoryCompact.ts)  |
| [`src/services/mcp/client.ts`](source/src/services/mcp/client.ts)                                     | 七种 transport、错误桥接、MCP 工具封装                    | [✅ 3,348 → 4,776 行](annotated/src/services/mcp/client.ts)                  |
| [`src/services/compact/prompt.ts`](source/src/services/compact/prompt.ts)                             | 压缩提示词本体：三套模板的差异与理由                            | [✅ 374 → 723 行](annotated/src/services/compact/prompt.ts)                  |
| [`src/services/compact/grouping.ts`](source/src/services/compact/grouping.ts)                         | 按 API 轮次切刀口，为什么只有一个判据                         | [✅ 63 → 202 行](annotated/src/services/compact/grouping.ts)                 |
| [`src/services/compact/postCompactCleanup.ts`](source/src/services/compact/postCompactCleanup.ts)     | 压缩后清什么、清哪一层、什么故意不清                            | [✅ 77 → 339 行](annotated/src/services/compact/postCompactCleanup.ts)       |
| [`src/services/compact/timeBasedMCConfig.ts`](source/src/services/compact/timeBasedMCConfig.ts)       | 缓存注定要 miss 时顺手整理上下文                           | [✅ 43 → 228 行](annotated/src/services/compact/timeBasedMCConfig.ts)        |
| [`src/services/compact/compactWarning*.ts`](source/src/services/compact/compactWarningState.ts)       | 一个布尔量的时序、以及 React 隔离                          | [✅ 34 → 176 行](annotated/src/services/compact/compactWarningState.ts)      |
| [`src/services/mcp/config.ts`](source/src/services/mcp/config.ts)                                     | 六种配置来源、优先级、去重、白黑名单策略                          | [✅ 1,578 → 3,077 行](annotated/src/services/mcp/config.ts)                  |
| [`src/services/mcp/auth.ts`](source/src/services/mcp/auth.ts)                                         | OAuth 全流程、XAA/SSO、step-up 补丁、跨进程刷新锁           | [✅ 2,465 → 4,356 行](annotated/src/services/mcp/auth.ts)                    |
| [`src/services/mcp/xaa.ts`](source/src/services/mcp/xaa.ts)                                           | 两跳换票（id_token → ID-JAG → access_token）、三道防混淆闸 | [✅ 511 → 812 行](annotated/src/services/mcp/xaa.ts)                         |
| [`src/services/mcp/xaaIdpLogin.ts`](source/src/services/mcp/xaaIdpLogin.ts)                           | 一次浏览器弹窗、id_token 按 issuer 缓存、OIDC 发现的两个 URL 坑 | [✅ 487 → 709 行](annotated/src/services/mcp/xaaIdpLogin.ts)                 |
| [`src/services/mcp/useManageMCPConnections.ts`](source/src/services/mcp/useManageMCPConnections.ts)   | 异步事件 → AppState 的适配层、16ms 批处理、stale 清理三条引线    | [✅ 1,141 → 1,631 行](annotated/src/services/mcp/useManageMCPConnections.ts) |
| [`src/services/api/errors.ts`](source/src/services/api/errors.ts) | **错误怎么变成一条 assistant 消息**、`NO_RESPONSE_REQUESTED` 哨兵 | [✅ 1,207 → 1,467 行](annotated/src/services/api/errors.ts) |
| [`src/services/api/client.ts`](source/src/services/api/client.ts) | 四级 region 优先级、SDK logger 全走 stderr、凭据不出本机 | [✅ 389 → 583 行](annotated/src/services/api/client.ts) |
| [`src/services/api/logging.ts`](source/src/services/api/logging.ts) | 七个 AI 网关靠响应头前缀识别、`_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` | [✅ 788 → 988 行](annotated/src/services/api/logging.ts) |
| [`src/services/api/filesApi.ts`](source/src/services/api/filesApi.ts) | 把「该不该重试」变成返回值、`normalize` 后判 `..` 防穿越 | [✅ 748 → 889 行](annotated/src/services/api/filesApi.ts) |
| [`src/services/api/promptCacheBreakDetection.ts`](source/src/services/api/promptCacheBreakDetection.ts) | 缓存为什么碎、只追 5 个前缀、MCP 名脱敏 | [✅ 727 → 925 行](annotated/src/services/api/promptCacheBreakDetection.ts) |
| [`src/services/api/sessionIngress.ts`](source/src/services/api/sessionIngress.ts) | 链式追加 + 乐观并发 + **409 和解** | [✅ 514 → 618 行](annotated/src/services/api/sessionIngress.ts) |
| [`src/services/tools/toolExecution.ts`](source/src/services/tools/toolExecution.ts) | 一次工具调用的九道关、两个 `felt stuck` 阈值 | [✅ 1,745 → 1,905 行](annotated/src/services/tools/toolExecution.ts) |
| [`src/services/tools/toolHooks.ts`](source/src/services/tools/toolHooks.ts) | **钩子 `allow` 不绕过 `settings.json` 的 deny** | [✅ 650 → 751 行](annotated/src/services/tools/toolHooks.ts) |
| [`src/services/tools/StreamingToolExecutor.ts`](source/src/services/tools/StreamingToolExecutor.ts) | 并发 = 多个交错 pass，`status='executing'` 当互斥量 | [✅ 530 → 649 行](annotated/src/services/tools/StreamingToolExecutor.ts) |
| [`src/services/tools/toolOrchestration.ts`](source/src/services/tools/toolOrchestration.ts) | 并发批怎么分批、`contextModifier` 为什么必须按序回放 | [✅ 188 → 284 行](annotated/src/services/tools/toolOrchestration.ts) |
| [`src/services/lsp/LSPClient.ts`](source/src/services/lsp/LSPClient.ts) | **`spawn()` 返回 ≠ 启动成功**（ENOENT 是异步事件） | [✅ 447 → 653 行](annotated/src/services/lsp/LSPClient.ts) |
| [`src/services/lsp/LSPServerManager.ts`](source/src/services/lsp/LSPServerManager.ts) | 三张 Map 对应三种问题；声明不支持、server 照样发请求 | [✅ 420 → 583 行](annotated/src/services/lsp/LSPServerManager.ts) |
| [`src/services/lsp/LSPServerInstance.ts`](source/src/services/lsp/LSPServerInstance.ts) | `-32801 ContentModified` 可重试、僵尸状态、129KB 延迟加载 | [✅ 511 → 672 行](annotated/src/services/lsp/LSPServerInstance.ts) |
| [`src/services/lsp/LSPDiagnosticRegistry.ts`](source/src/services/lsp/LSPDiagnosticRegistry.ts) | 跨轮去重靠 LRU(500)；「先标记再删」必须放在可能失败的步骤之后 | [✅ 386 → 521 行](annotated/src/services/lsp/LSPDiagnosticRegistry.ts) |
| [`src/services/lsp/passiveFeedback.ts`](source/src/services/lsp/passiveFeedback.ts) | 缺失 severity 默认 `Error`（漏报比误报贵） | [✅ 328 → 465 行](annotated/src/services/lsp/passiveFeedback.ts) |
| [`src/services/lsp/manager.ts`](source/src/services/lsp/manager.ts) | 四态 + generation counter；issue #15521：memoize + 早期调用 + 缺刷新路径 | [✅ 289 → 417 行](annotated/src/services/lsp/manager.ts) |
| [`src/services/lsp/config.ts`](source/src/services/lsp/config.ts) | 「LSP 只能通过插件配置」= 安全边界 | [✅ 79 → 140 行](annotated/src/services/lsp/config.ts) |
| [`src/services/SessionMemory/sessionMemory.ts`](source/src/services/SessionMemory/sessionMemory.ts) | 后台子代理记笔记；**读文件必须发生在隔离 context** | [✅ 495 → 747 行](annotated/src/services/SessionMemory/sessionMemory.ts) |
| [`src/services/SessionMemory/prompts.ts`](source/src/services/SessionMemory/prompts.ts) | 模板斜体行是给模型看的字段说明；「不许改」说三遍 | [✅ 324 → 482 行](annotated/src/services/SessionMemory/prompts.ts) |
| [`src/services/SessionMemory/sessionMemoryUtils.ts`](source/src/services/SessionMemory/sessionMemoryUtils.ts) | 15s 等待上限 / 60s 判僵死；阈值用增量而非绝对值 | [✅ 207 → 319 行](annotated/src/services/SessionMemory/sessionMemoryUtils.ts) |
| [`src/services/oauth/client.ts`](source/src/services/oauth/client.ts) | 刷新与 5 分钟缓冲、**一次「省 7M 请求/天」的优化差点让订阅类型永久丢失** | [✅ 566 → 744 行](annotated/src/services/oauth/client.ts) |
| [`src/services/oauth/auth-code-listener.ts`](source/src/services/oauth/auth-code-listener.ts) | 延迟响应（攥着 `res` 等 token 换完）、判路径防 favicon 打断 | [✅ 211 → 315 行](annotated/src/services/oauth/auth-code-listener.ts) |
| [`src/services/oauth/index.ts`](source/src/services/oauth/index.ts) | 浏览器内/外两条路径赛跑收敛成一个 Promise | [✅ 198 → 323 行](annotated/src/services/oauth/index.ts) |
| [`src/services/oauth/crypto.ts`](source/src/services/oauth/crypto.ts) | PKCE 三块拼图，base64URL 三次替换 | [✅ 23 → 86 行](annotated/src/services/oauth/crypto.ts) |
| [`src/services/mcp/MCPConnectionManager.tsx`](source/src/services/mcp/MCPConnectionManager.tsx) | **React Compiler 编译产物怎么读**：`_c(6)` 缓存槽、`t0` 临时名 | [✅ 73 → 236 行](annotated/src/services/mcp/MCPConnectionManager.tsx) |
| [`src/services/analytics/growthbook.ts`](source/src/services/analytics/growthbook.ts) | **引擎**：`processRemoteEvalPayload` 的 `{}` 真值判据（漏检查会让所有开关集体黑屏）；`syncRemoteEvalToDisk` 只在成功路径调用（超时投毒结构上不可能）；`checkGate_CACHED_OR_BLOCKING` 的 stale-while-false-blocking；整文件 `@deprecated` 记录从 Statsig 迁到 GrowthBook | [✅ 1,155 → 1,240 行](annotated/src/services/analytics/growthbook.ts) |
| [`src/services/analytics/metadata.ts`](source/src/services/analytics/metadata.ts) | 所有遥测字段的单一事实来源；`to1PEventFormat` 用 proto 生成类型让「漏字段」从运行时 bug 变编译错误；`account_id` 故意省略只填 UUID | [✅ 973 → 1,045 行](annotated/src/services/analytics/metadata.ts) |
| [`src/services/analytics/firstPartyEventLoggingExporter.ts`](source/src/services/analytics/firstPartyEventLoggingExporter.ts) | 跨进程重启的失败事件恢复（BATCH_UUID+sessionId 隔离）；二次方退避（base*attempts²）；401 退化为无 auth 重试；`_PROTO_*` hoist 到 proto 字段后再防御性 strip | [✅ 806 → 880 行](annotated/src/services/analytics/firstPartyEventLoggingExporter.ts) |
| [`src/services/analytics/firstPartyEventLogger.ts`](source/src/services/analytics/firstPartyEventLogger.ts) | OTel logs SDK；自建独立 LoggerProvider 不与客户遥测混；`reinitialize` 三步走（null→forceFlush→swap）的事件丢失安全 | [✅ 449 → 512 行](annotated/src/services/analytics/firstPartyEventLogger.ts) |
| [`src/services/analytics/datadog.ts`](source/src/services/analytics/datadog.ts) | pub 公开 token 写死在客户端（只写不读）；44 事件白名单 + 二次基数归一（mcp→mcp / 罕见模型→other）；`getUserBucket` 用 sha256 mod 30 代替真实 user id 计数 | [✅ 307 → 364 行](annotated/src/services/analytics/datadog.ts) |
| [`src/services/analytics/index.ts`](source/src/services/analytics/index.ts) | 零依赖防循环；`AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 用命名做 lint；`eventQueue` + `queueMicrotask` 先消费后连接，不阻塞启动 | [✅ 173 → 210 行](annotated/src/services/analytics/index.ts) |
| [`src/services/analytics/sink.ts`](source/src/services/analytics/sink.ts) | 路由中枢；`shouldTrackDatadog` 三层回退（killswitch→模块态→跨 session 磁盘缓存）；`stripProtoFields` 只在非 1P 后端前调一次守 PII 边界 | [✅ 114 → 146 行](annotated/src/services/analytics/sink.ts) |
| [`src/services/analytics/config.ts`](source/src/services/analytics/config.ts) | `isAnalyticsDisabled` 五条件一刀切；`isFeedbackSurveyDisabled` 故意不挡 3P 云（本地 UI 弹窗无 transcript） | [✅ 38 → 59 行](annotated/src/services/analytics/config.ts) |
| [`src/services/analytics/sinkKillswitch.ts`](source/src/services/analytics/sinkKillswitch.ts) | `tengu_frond_boric` 熔断；fail-open；绝不能从 `is1PEventLoggingEnabled` 内调用（会递归爆栈） | [✅ 25 → 42 行](annotated/src/services/analytics/sinkKillswitch.ts) |

> **`src/services/` 做到哪了**：全目录 **130 个文件 / 53,683 行**，已批注 **120 份 / 52,462 行（97%）**。
> `api/`（20/20）、`compact/`（11/11）、`mcp/`（23/23）、`lsp/`（7/7）、`oauth/`（5/5）、
> `tools/`（4/4）、`SessionMemory/`（3/3）、`analytics/`（9/9）、`teamMemorySync/`（5/5）、`PromptSuggestion/`（2/2）、`plugins/`（3/3）、`remoteManagedSettings/`（5/5）、`extractMemories/`（2/2）、`tips/`（3/3）、`settingsSync/`（2/2）、`autoDream/`（4/4）、`policyLimits/`（2/2）十七个子目录**已清零**，`voice*.ts` 三份、`vcr.ts`、`diagnosticTracking.ts`、`rateLimitMessages.ts`、`rateLimitMocking.ts` 也已完成；剩 10 份集中在
> `MagicDocs/`、`AgentSummary/`、`toolUseSummary/` 与根目录 6 个小散件。
> 逐份清单和「还剩什么」的完整表格见
> [索引与进度 · 第 6 步](annotated-索引与进度.md#第-6-步服务层做到哪了17-个子目录清零全目录-120130)。
> 这个目录**不存在「全部完成」的状态**，只有「这一批做到哪」——
> 所以本节只标 🟡，不标 ✅。

**对应章节**：[07 服务层详解](docs/07-服务层详解.md)、[11 上下文压缩](docs/11-上下文压缩.md)

**目标**：知道"功能后端"都有哪些能力，需要哪个查哪个。

---

### 第 7 步：UI 与多智能体（可选）

> 📁 本节源码：[`src/commands/agents/agents.tsx`](source/src/commands/agents/agents.tsx)

| 读什么                                                                                 | 学什么                  | 批注版                                                              |
| ----------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------- |
| [`src/coordinator/coordinatorMode.ts`](source/src/coordinator/coordinatorMode.ts)   | 多智能体编排的模式开关 + 协调者提示词 | [369 → 632 行](annotated/src/coordinator/coordinatorMode.ts) ✅    |
| [`src/tools/AgentTool/AgentTool.tsx`](source/src/tools/AgentTool/AgentTool.tsx)     | 派活的十道检查、两套执行路径       | [1,397 → 2,793 行](annotated/src/tools/AgentTool/AgentTool.tsx) ✅ |
| [`src/tools/AgentTool/prompt.ts`](source/src/tools/AgentTool/prompt.ts)             | agent 清单注入策略、简报写法    | [287 → 601 行](annotated/src/tools/AgentTool/prompt.ts) ✅         |
| [`src/tools/AgentTool/forkSubagent.ts`](source/src/tools/AgentTool/forkSubagent.ts) | fork：共享缓存的自我复制       | [210 → 559 行](annotated/src/tools/AgentTool/forkSubagent.ts) ✅   |
| [`src/ink/`](source/src/ink/) 渲染内核                                                  | 终端界面怎么画（见第 8 步）      | ✅ 全部 96 份                                                        |

**对应章节**：[12 UI 与多智能体](docs/12-UI与多智能体.md)、[10 子智能体与计划模式](docs/10-子智能体与计划模式.md)

**目标**：想做终端 UI 或多智能体产品时再深入。

**多智能体这四份读完之后，最值得带走的三条**：

1. **理解不可外包** —— 协调者提示词里最硬的一条是禁止写「based on your findings」。因为多智能体的失败模式几乎全是「协调者偷懒」：把思考推给下属、把判断推给时间、把结果推给想象。
2. **缓存的判据是字节，不是语义** —— fork 之所以便宜，是因为它的请求前缀和父进程逐字节相同。所以它宁可继承一份「教自己 fork」的错误提示词，也不肯换掉系统提示词（换了就全废）。
3. **动态内容一律往后放** —— agent 清单原本内联在工具描述里，成了全公司缓存创建开销的 10.2%。挪到消息流末尾之后归零。同一个手法在 `prompts.ts`（动态边界标记）和 `claude.ts`（deferred_tools_delta）里各出现一次。

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
第7步 多智能体    coordinator / AgentTool / fork         [可选] ✅ 已批注
```

---

### 三个高效阅读习惯

| 习惯                       | 做法                                    | 为什么有效                 |
| ------------------------ | ------------------------------------- | --------------------- |
| **先看 import**            | 每个文件先扫头部 import                       | 一眼看出它依赖谁、属于哪一层        |
| **先找 "source of truth"** | 找注释里的 these are all / source of truth | 大项目都有"唯一真相来源"，抓住它就不迷路 |
| **跳过埋点**                 | 看到 `tengu_`、`logEvent` 直接跳            | 那是内部监控，和理解逻辑无关        |

### 看不懂时的排查顺序

1. **是不是 `feature()` 分支？** —— 这个分支可能在你的版本里根本没实现，别硬找。
2. **是不是内部专用代码？** —— 看到 `USER_TYPE === 'ant'` 就是 Anthropic 内部员工专用，跳过。
3. **是不是埋点 / 遥测？** —— `tengu_` 开头的事件名，跳过。
4. **是不是类型体操？** —— 超长的类型名（如 `AnalyticsMetadata_I_VERIFIED_...`）是安全标记，不是逻辑。
5. **回到入口重走一遍** —— 从 `tools.ts` / `commands.ts` / `query.ts` 这三个"总闸"重新出发。

### 常用全局搜索（在 `source/` 里搜）

> 📁 本节源码：[`src/commands.ts`](source/src/commands.ts)

| 想找什么    | 搜什么                                               |
| ------- | ------------------------------------------------- |
| 所有工具    | `getAllBaseTools`                                 |
| 所有命令    | [`src/commands.ts`](source/src/commands.ts) 里的注册表 |
| 构建期开关   | `feature(`                                        |
| 系统提示词片段 | `systemPromptSection`                             |
| 内部埋点    | `tengu_`                                          |
| 权限判定    | `hasPermissionsToUseTool`                         |
| 主循环     | `while (true)` / `queryLoop`                      |
| MCP 连接  | `StdioClientTransport`                            |

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

| 标记                | 含义            |
| ----------------- | ------------- |
| 原文                | 英文原注释，一个字都没删  |
| `// 译：`           | 紧跟英文之后，直译     |
| `// 注：`           | 额外补充的解释（原文没有） |
| `// ── N. xxx ──` | 段落分隔，方便定位     |

**为什么另开目录而不直接改 `source/`**：插中文行会让后面所有行号下移，正文里 225 处链接、48 个精确行号锚点就全废了。所以 `source/` 永远是行号基准，`annotated/` 才是学习时读的那份。

**行号口径**：批注正文里出现的「第 N 行」一律指 **`source/` 里的原始行号**。想核对就在 `source/` 下打开对应文件；批注版里的实际位置会靠后（因为前面插了注释），但批注就贴在它解释的那段代码上方，不需要靠行号导航。

**怎么保证批注不过界**：`scripts/check-fidelity.py` 会把批注版拆成「代码行 / 注释行 / 批注行」，要求代码行与原文**逐行完全相等**、原文注释**一字不差按序保留**。另外还有三条结构判据：块注释内部不许有中文、多行模板字符串内部不许有中文（否则中文会变成字符串内容，直接进提示词）、批注不许插在未结束的多行表达式中间。还有一类更隐蔽的破坏由 `annotate.py` 结构性拦截：`//` 连续注释也成段，锚点落在段中部会把一句英文从中间剪断（语法合法、注释一行不少，只是读起来断了）—— 现在 `before` 自动挪段首、`after` 自动挪段尾。

判定「哪里在模板字符串内部」靠两个脚本各一份的**状态栈词法扫描器**（code / tpl / expr / block 四态）。它取代了最早的单个布尔量，因为那个版本会被两种写法骗过去：`${cond ? '...(with a \`subagent_type\`)...' : ''}`（模板表达式里的字符串含反引号）和块注释里的 `` `)` ``（`bashSecurity.ts\` 第 472 行）。前者会**误报**（一段正常批注被判成模板内部），后者会**漏报**（真插进模板的批注被放过）—— 两种错误都让校验失去意义，所以扫描器本身也得写对。

---


### 第 8 步：终端渲染器（进阶，可选）

`src/ink/` 是**自己实现**的 Ink（不是官方 npm 包）：把 React 组件树画到终端格子上的整套内核，1.98 万行。它是这个仓库里唯一一处「和业务无关、纯基础设施」的代码，也是最能学到东西的一处 —— 因为终端是一个比浏览器苛刻得多的渲染目标：没有 DOM、没有排版引擎、没有像素，只有一张 `rows × cols` 的字符格子，以及一串带状态的转义序列。

| 读什么                                                                           | 学什么                                                                    | 批注版                                                             |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| [`src/ink/reconciler.ts`](source/src/ink/reconciler.ts)                       | React 19 自定义 renderer：host config 把 React 的 mutation 语义翻译成树操作          | [✅ 512 → 727 行](annotated/src/ink/reconciler.ts)                |
| [`src/ink/dom.ts`](source/src/ink/dom.ts)                                     | 七个元素名的极简 DOM、yoga 桥、文本测量、脏标记冒泡                                         | [✅ 484 → 685 行](annotated/src/ink/dom.ts)                       |
| [`src/ink/ink.tsx`](source/src/ink/ink.tsx)                                   | 帧循环九阶段、双缓冲、diff 与优化、光标定位、终端模式、退出清理                                     | [✅ 1,722 → 2,470 行](annotated/src/ink/ink.tsx)                  |
| [`src/ink/screen.ts`](source/src/ink/screen.ts)                               | 打包格子（2 个 int 装一格）、样式池用 ID 最低位当标签、宽字符四态、blit/shift/clear、两帧 diff        | [✅ 1,486 → 2,167 行](annotated/src/ink/screen.ts)                |
| [`src/ink/render-node-to-output.ts`](source/src/ink/render-node-to-output.ts) | 沿树走一遍做 blit / 清空 / 重画三选一；ScrollBox 的三遍渲染与 DECSTBM 快路径                  | [✅ 1,462 → 2,180 行](annotated/src/ink/render-node-to-output.ts) |
| [`src/ink/log-update.ts`](source/src/ink/log-update.ts)                       | 两帧之间到底发什么字节：全量重置的四种触发、逐格补丁、虚拟光标模型                                      | [✅ 773 → 1,193 行](annotated/src/ink/log-update.ts)              |
| [`src/ink/output.ts`](source/src/ink/output.ts)                               | 一帧的**操作队列**：七种操作、Clip 栈的现场求交、grapheme 聚类、单行写入与控制字符跳过                   | [✅ 798 → 1,151 行](annotated/src/ink/output.ts)                  |
| [`src/ink/styles.ts`](source/src/ink/styles.ts)                               | 两套类型（字 / 盒子）与九个 apply：CSS 属性怎么落到 yoga setter，`'x' in style` 与 diff 的语义 | [✅ 772 → 967 行](annotated/src/ink/styles.ts)                    |
| [`src/ink/colorize.ts`](source/src/ink/colorize.ts)                           | 真彩色的两次降级：VS Code 自报家门不被认识、tmux 转发按别的终端声明做决定                            | [✅ 232 → 372 行](annotated/src/ink/colorize.ts)                  |
| [`src/ink/stringWidth.ts`](source/src/ink/stringWidth.ts)                     | 整台渲染器的尺子：四级快路径、零宽字符表、emoji 宽度、Bun 与 JS 实现的 1 vs 2                      | [✅ 223 → 413 行](annotated/src/ink/stringWidth.ts)               |
| [`src/ink/Ansi.tsx`](source/src/ink/Ansi.tsx)                                 | **React Compiler 的编译产物**该怎么读，以及 ANSI 字符串 → 组件树的语义降维                    | [✅ 292 → 504 行](annotated/src/ink/Ansi.tsx)                     |
| [`src/ink/termio/ansi.ts`](source/src/ink/termio/ansi.ts)                     | 整层的字母表：C0 表为什么写全 32 个、ESC 尾字节范围为什么比 CSI 宽                              | [✅ 76 → 150 行](annotated/src/ink/termio/ansi.ts)                |
| [`src/ink/termio/csi.ts`](source/src/ink/termio/csi.ts)                       | 三个字节区间（中间/参数/尾）就是 CSI 的完整语法；`csi()` 的单参数与多参数两副面孔                       | [✅ 320 → 493 行](annotated/src/ink/termio/csi.ts)                |
| [`src/ink/termio/dec.ts`](source/src/ink/termio/dec.ts)                       | 47 与 1049 的区别、四个鼠标模式为什么一起开、关的时候为什么逆序                                   | [✅ 61 → 119 行](annotated/src/ink/termio/dec.ts)                 |
| [`src/ink/termio/esc.ts`](source/src/ink/termio/esc.ts)                       | 两字符序列；`null`（已处理无事发生）与 `unknown`（没认出来）两种「空」的差别                         | [✅ 68 → 128 行](annotated/src/ink/termio/esc.ts)                 |
| [`src/ink/termio/types.ts`](source/src/ink/termio/types.ts)                   | 语义类型；`Grapheme.width` 算了却没人读；页签状态的三态设计（absent / null / 值）              | [✅ 237 → 424 行](annotated/src/ink/termio/types.ts)              |
| [`src/ink/termio/sgr.ts`](source/src/ink/termio/sgr.ts)                       | 分号与冒号两套语法、`38:2:cs:R:G:B` 的 `off` 偏移、`22` 为什么一对二                       | [✅ 309 → 541 行](annotated/src/ink/termio/sgr.ts)                |
| [`src/ink/termio/tokenize.ts`](source/src/ink/termio/tokenize.ts)             | 词法层：八个状态、`escape` 分支的判定顺序为什么不能重排、降级时不前移游标                              | [✅ 320 → 564 行](annotated/src/ink/termio/tokenize.ts)           |
| [`src/ink/termio/parser.ts`](source/src/ink/termio/parser.ts)                 | 语义层：SGR 被拦下来不进 action 流、`?? 1` 与 `?? 0` 两个默认值、只处理第一个模式                 | [✅ 395 → 671 行](annotated/src/ink/termio/parser.ts)             |
| [`src/ink/termio/osc.ts`](source/src/ink/termio/osc.ts)                       | OSC 全家族：DCS 透传的两套约定、剪贴板三条路、内层为什么选 BEL 而不是 ST                           | [✅ 494 → 879 行](annotated/src/ink/termio/osc.ts)                |
| [`src/ink/termio.ts`](source/src/ink/termio.ts)                               | 桶文件只导出「读」的一侧，生成函数走深路径                                                  | [✅ 43 → 83 行](annotated/src/ink/termio.ts)                      |

上面这张表是二十一份核心。目录里另外七十五份（`layout/` 四个、`ink/` 根目录其余小件、`events/` 十个、`hooks/` 十二个、`components/` 十八个）也都批注完了 —— 其中 `components/App.tsx`（658 行，stdin 的唯一拥有者）、`ScrollBox.tsx`（237 行，绕过 React 的命令式滚动）、`events/dispatcher.ts`（234 行，捕获/冒泡两阶段）最值得看。**`src/ink/` 96 个文件、19,842 行，一份不剩。**

**三上三下，五个旁支，外加一组解析器**：前六份是一条直线（React 元素 → 布局树 → 屏幕缓冲 → 终端字节），分界线是 `screen.ts` 里的 `Screen` 类型 —— 往上都是「节点和坐标」，往下都是「格子和转义序列」。后五份不在主线上，但每一步都用到：`output.ts` 是 `render-node-to-output` 与 `screen` 之间的操作队列，`styles.ts` 管盒子、`colorize.ts` 管字，`stringWidth.ts` 是整条链的尺子，`Ansi.tsx` 走反方向。

最后十份 `termio/` 是**反方向的那条路**：`Ansi.tsx` 收进来一段带转义序列的字符串，`termio/` 把它拆成结构化事件。读的顺序是 `ansi`（字节表）→ `csi`/`dec`/`esc`（三族序列的常量与生成）→ `tokenize`（切边界）→ `sgr`（样式参数）→ `parser`（拼成 action）→ `osc`（唯一带自由文本负载的一族）。前四个是字典，后四个才是逻辑。

**对应章节**：[12 UI 与多智能体](docs/12-UI与多智能体.md)

**目标**：理解「终端 UI 为什么能像 GUI 一样增量更新」，以及那些看起来古怪的代码（`?1049h`、`unref()`、`writeSync`）各自在防什么。

**二十一份读完之后，最值得带走的六条**：

① **终端里没有排版引擎，文字尺寸得自己算。** yoga 只管盒子，不识字宽。所以 `<Text>` 挂了一个 measure 回调（`dom.ts` 332 行），yoga 布局时问它「给这么宽你要多高」。这一个回调决定了：为什么 `<Text>` 里不能放 `<Box>`（展不平就没法量）、为什么裸字符串必须包在 `<Text>` 里（没有父级就不知道该继承什么样式）、为什么宽字符和 emoji 要单独处理。

而宽度本身在 `stringWidth.ts` 里 —— 这是全仓库调用最频繁的函数（约 10 万次/帧）。它在 Bun 下用 `Bun.stringWidth`、否则退到纯 JS 实现，两者在复杂印度语合字上差了 1 列（1 vs 2）。选 Bun 的理由不只是快，是它的宽度语义与终端的格子分配一致 —— 光标定位要对的不是 Unicode 语义，是终端的格子。

② **终端的 diff 是「两份屏幕缓冲之间的最小写入序列」。** 每帧画出一整屏格子，和上一帧逐格比较，只写变化的格子。这套机制的前提是「我们对屏幕状态的认知与物理终端一致」—— 而外部世界一直在破坏这个前提：tmux 重画状态栏、用户按 Cmd+K、SSH 断线重连、笔记本睡眠。所以 `ink.tsx` 里一半的复杂度（`prevFrameContaminated`、`forceRedraw`、`reassertTerminalModes`、每帧 CSI H 锚定）都是在**把失步拉回来**。

③ **一个格子只用 8 字节，而且「空」就是全 0。** `screen.ts` 把所有格子放进一条 `Int32Array`（每格两个 int），`ArrayBuffer` 分配即零填充，于是「没写过」天然等于「空格 + 无样式 + 窄 + 无链接」—— 前提是 `StylePool.none === 0`、`CharPool` 的第 0 项是空格、`HyperlinkPool` 的第 0 项是「无链接」。三条约定凑齐，`diffEach` 才能拿整数直接比较，不做任何归一化。宽字符不是「渲染时才发现要占两列」，而是**显式写一个占位格**，这样「一格 = 一列」成为可以无条件依赖的不变量。

④ **性能优化全在「凭什么敢跳过」上。** 每处跳过都是一个断言，而断言总会被打破：脏兄弟的溢出会毒化后面所有兄弟的 blit 资格、`display:none` 的子孙 cache 会让内容在取消隐藏后消失、硬件滚动会把绝对定位浮层的像素一起挪走、被裁剪的子节点重进视口时会对着别人的位置发 clear。读这个目录的正确姿势不是「它做了什么」，而是「它在什么条件下允许自己什么都不做」。

⑤ **同一个语义在不同终端上要发不同的字节。** `colorize.ts` 只有 232 行，但承载了两个真实世界的适配：VS Code 系（xterm.js）从 2017 年就支持真彩色，可 `supports-color` 不认识 `TERM_PROGRAM=vscode`，于是降级到 6×6×6 色立方 —— Claude 橙变成发白的肉粉色；tmux 解析真彩色完全正确，但转发时只在外层终端声明 `Tc` 时才重发，默认配置下背景色直接丢掉。两段补丁一个向上提、一个向下压，都不是能力查询，是「环境变量粗判 + 已知失败模式」。

⑥ **退出路径比正常路径更难写对。** `unmount()` 里那一串 `writeSync` 不是保守，是必需：`process.exit()` 会丢弃异步写，而漏掉一条复位序列的后果是用户回到 shell 后打字看不见、Ctrl+C 漏成转义序列。这也是为什么 `detachForShutdown()` 要提前把 `isUnmounted` 置真 —— 宁可少做，也不要重复做（重复发 `?1049l` 会把 resume 提示冲掉）。

---

进度：**第 1～3 步已完成**（`package.json` + 仓库 README + `cli.tsx`；`clear/index.ts` + `commandSemantics.ts`；`setup.ts` 全 477 行）；**第 4 步全部完成**（`Tool.ts` 792 + `tools.ts` 389 + `BashTool.tsx` 1,143 + `bashSecurity.ts` 2,592 + `bashPermissions.ts` 2,621，合计 7,537 行原文全批注）；**第 5 步全部完成**（`prompts.ts` 914 + `query.ts` 1,729 + `QueryEngine.ts` 1,295 + `claude.ts` 3,419，合计 7,357 行原文，564 处批注锚点）；**第 6 步完成**（`withRetry.ts` 822 + `src/services/compact/` **全部 11 个文件** 4,864 + `mcp/client.ts` 3,348 + `mcp/config.ts` 1,578 + `mcp/auth.ts` 2,465 + `mcp/xaa.ts` 511 + `mcp/xaaIdpLogin.ts` 487 + `useManageMCPConnections.ts` 1,141 = 15,216 行原文、704 处锚点）；**第 7 步多智能体主线完成**（`coordinatorMode.ts` 369 + `AgentTool.tsx` 1,397 + `prompt.ts` 287 + `forkSubagent.ts` 210，合计 2,263 行原文、133 处锚点）；**第 8 步终端渲染器完成**（`reconciler.ts` 512 + `dom.ts` 484 + `ink.tsx` 1,722 + `screen.ts` 1,486 + `render-node-to-output.ts` 1,462 + `log-update.ts` 773 + `output.ts` 798 + `styles.ts` 772 + `colorize.ts` 232 + `stringWidth.ts` 223 + `Ansi.tsx` 292 + `termio/` 十个文件 2,323 = 11,079 行原文、553 处锚点；**输入侧四份**：`parse-keypress.ts` 802 + `selection.ts` 918 + `hit-test.ts` 131 + `render-border.ts` 232 = 2,083 行原文、117 处锚点；**`mcp/` 其余 16 个小件** 2,708 行原文、80 处锚点；**`ink/` 其余 31 个小件**（根目录 27 个 + `layout/` 四个）2,997 行原文、224 处锚点；**`ink/` 最后 40 个交互原语**（`events/` 10 + `hooks/` 12 + `components/` 18）3,717 行原文、177 处锚点；**第 9 步开了头**：`Messages.tsx` 834 + `MessageRow.tsx` 383 + `Message.tsx` 627 + `messageActions.tsx` 450 = 2,294 行原文、119 处锚点；**输入框整个子目录**：`components/PromptInput/` 全 21 份 5,161 行原文（`PromptInput.tsx` 2,338 + `PromptInputFooterLeftSide.tsx` 516 + `PromptInputHelpMenu.tsx` 357 + `Notifications.tsx` 331 + `PromptInputFooterSuggestions.tsx` 292 + 其余 16 份，含 `IssueFlagBanner.tsx` 这个被构建工具删空的组件）= 235 处锚点；**消息体整个子目录**：`components/messages/` 全 41 份 6,055 行原文（`SystemTextMessage.tsx` 827 + `AttachmentMessage.tsx` 536 + `CollapsedReadSearchContent.tsx` 484 + `AssistantToolUseMessage.tsx` 368 + 其余 37 份，含 `UserToolResultMessage/` 子目录 8 份）= 274 处锚点）。**第 1～8 步主线全部走完，输入输出两个方向闭合，`src/ink/` 清零**：213 个文件、68,501 行原文（批注版 112,528 行）、3,503 处锚点 —— 压缩管线、MCP 四段（配置 → 连接 → 认证 → 企业 SSO）加 UI 接缝、多智能体两条路径、终端渲染的「React 侧 + 绘制侧 + 样式/颜色/宽度 + 转义序列解析」、反方向的「按键/拖选 → 结构化事件 → 同一块屏幕缓冲」、以及 MCP「连接之外的一切」（名字归一化 / 通道六道闸 / 手机审批中继 / elicitation / 动态 header）都闭合了。`src/ink/` 整个目录（96 个文件、19,842 行）到此一份不剩。界面层（`src/components/`，**实测 8.2 万行、389 个文件**）已批注 66 份：消息渲染主链四份 —— `Messages` 管「显示哪些」、`MessageRow` 管「还会不会变」、`Message` 管「怎么画」，三层各有一个 memo、各有一个不变量；消息体整个 `messages/` 子目录 41 份 —— 那些「怎么画」的落点（`UserTextMessage` 十七个 if 顺序即协议、`AssistantTextMessage` 拿文案当判别键、`SystemTextMessage` 十种 subtype 挤一条 if 链、`AttachmentMessage` 四十多个 case），共 274 处锚点；反方向的输入链整个 `PromptInput/` 子目录 —— 按键进 `onChange`、九个高亮触发器按 priority 覆盖、`onSubmit` 是总闸（建议接受 / 推测注入 / @名字走 mailbox / 路由给正在看的 agent / 才到主循环）。剩下的 323 个文件按需再做。

👉 入口：[`annotated-索引与进度.md`](annotated-索引与进度.md)

---

## 怎么从文档跳到源码

源码位置**标在讲它的那一节开头**，不在别处。每节标题下都有一行：

> 📁 本节源码：[`src/tools.ts`](source/src/tools.ts)

这一行就是该节的"源码索引"：告诉你在读的这段讲解对应哪个文件；有具体片段的，直接给到行号（如 `src/query.ts:263`），点一下打开文件。

全手册共 **225 处**这样的源码链接（跑 `scripts/check-links.py` 可复算），覆盖 **78 个文件**，其中 **48 处精确到行**。有些节涉及同一文件的多个片段，会写成「文件名 — `52-55` · `170-178`」，两个区间分别可点。

跳到**具体行**取决于你用什么打开：

| 打开方式                               | 点链接   | 到具体行             |
| ---------------------------------- | ----- | ---------------- |
| VSCode 内置 Markdown 预览              | 打开该文件 | `Ctrl+G` 输行号     |
| Typora / Markdown Preview Enhanced | 打开该文件 | 直接跳到 `#L362` 那一行 |
| GitHub 网页                          | 打开该文件 | 直接跳行             |

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
