# L3-01 · clear 四件套：第一次同时看多个文件

> 前面三层，你一次只读一个文件：一个函数、一个 hook、一个常量表。真实仓库不是这样长的——一个功能往往摊在 3–5 个文件里。
> 这一课第一次把四个文件摆在一起，但**不要求你读懂 421 行**。只做一件事：沿着它们之间的「边」走一遍，回答「谁引用谁、方向是不是单向」。

| 项目 | 内容 |
| --- | --- |
| 课时号 | L3-01（L3 层第 1 课，共 4 课） |
| ⏱ 时长 | 90 分钟 |
| 前置课时 | [L1-05 十九行命令声明](../L1/L1-05-十九行命令声明.md)、[L1-06 七行命令实现](../L1/L1-06-七行命令实现.md)、[L1-01 两行文件与循环依赖](../L1/L1-01-两行文件与循环依赖.md)、[L2-03 十六行错误处理](../L2/L2-03-十六行错误处理.md) |
| 教材清单 | 批注版：[`index.ts`](../../annotated/src/commands/clear/index.ts)（132 行）、[`clear.ts`](../../annotated/src/commands/clear/clear.ts)（20 行）、[`conversation.ts`](../../annotated/src/commands/clear/conversation.ts)（374 行）、[`caches.ts`](../../annotated/src/commands/clear/caches.ts)（223 行）<br>原文对照：[`index.ts`](../../source/src/commands/clear/index.ts)（19 行）、[`clear.ts`](../../source/src/commands/clear/clear.ts)（7 行）、[`conversation.ts`](../../source/src/commands/clear/conversation.ts)（251 行）、[`caches.ts`](../../source/src/commands/clear/caches.ts)（144 行） |
| 这节课只解决一件事 | 画出四文件依赖图，并指出每条边「是静态还是延迟、是否构成回环」 |

> **行号约定**：本文摘录的文字与批注版**逐字一致**，但行号标的是 `source/` 原文行号——批注版在代码之间插了中文注解，行号整体后移（19 行的文件在批注版里是 132 行）。`satisfies`、`import type`、`async` 这些语法在 L0-01、L1-05、L1-06 已经讲过，本课**不复读语法**，只看文件之间的边。

---

## 1. 先看全景：四个角色，三张图

| 文件 | 行数（原文） | 角色 | 导出 | 谁引用它 |
| --- | --- | --- | --- | --- |
| `index.ts` | 19 | **声明**：我是谁、怎么按需加载 | `default clear` | `commands.ts:9`（静态） |
| `clear.ts` | 7 | **入口**：收到调用，转手 | `call` | `index.ts` 的 `load()`（动态） |
| `conversation.ts` | 251 | **主体**：真正清会话 | `clearConversation` | `clear.ts:2`（静态）；`REPL.tsx:3043、4784`（动态） |
| `caches.ts` | 144 | **清缓存**：清二十几个模块的缓存 | `clearSessionCaches` | `conversation.ts:47`（静态）；`main.tsx:3110、3361`（动态） |

把这四行读成一句话：**声明 → 入口 → 主体 → 清缓存**，越往下越重、越晚加载。

主链（用户敲 `/clear` 之后才走完）：

```
commands.ts:9 ──import──▶ index.ts
                            │
                            │ load()   ← 敲 /clear 那一刻才执行 import
                            ▼
                         clear.ts:2 ──import──▶ conversation.ts:47 ──import──▶ caches.ts
```

两条**不经过 `index.ts`** 的外部入口（这是四件套里最容易被忽略的边）：

```
main.tsx:3110 / 3361 ──await import──▶ caches.ts        （--continue / --resume）
REPL.tsx:3043 / 4784 ──await import──▶ conversation.ts  （plan 模式退出 / idle 返回时选 clear）
```

一条**向上的回边**：

```
caches.ts:10 ──import──▶ commands.ts ──▶ index.ts
index.ts:8   ──import type──▶ commands.ts   （编译后整行消失，不构成运行时回边）
```

三张图里，只有第一条实线（`commands.ts → index.ts`）在启动时求值；带 `load()` 或 `await import` 的边全部按需。

**读的顺序**就由此确定：`index → clear → conversation` 是直线，顺着读；`caches` 放最后，因为它是被调用方，而且只有它连回 `commands.ts`——先把直线读完，再回头看这条回边，才不会在第一个文件就迷路。

---

## 2. 精读正文（行号为 source 原文行号）

### 2.1 `index.ts` 第 8–17 行：三条边，一条被擦除、一条被推迟

```ts
import type { Command } from '../../commands.js'

const clear = {
  type: 'local',
  name: 'clear',
  description: 'Clear conversation history and free up context',
  aliases: ['reset', 'new'],
  supportsNonInteractive: false, // Should just create a new session
  load: () => import('./clear.js'),
} satisfies Command
```

这个文件只有 19 行，却同时挂着三条方向不同的边：

- **`commands.ts:9 → 这里`（静态、向下）**：`import clear from './commands/clear/index.js'`。因为 `commands.ts` 第 265 行的 `COMMANDS` 数组要把所有斜杠命令登记进去，用户敲 `/` 才能弹出补全。这条边必须在启动时成立，所以 `index.ts` 必须足够便宜。
- **`这里 → commands.ts`（类型边、被擦除）**：`import type { Command }`。这是整个四件套里唯一一条「反向指回注册表」的边，而 `import type` 保证它在编译后**整行消失**。如果没有这行 type-only 声明，`commands → index → commands` 就是一个真的运行时环。
- **`这里 → clear.ts`（延迟边、向下）**：`load: () => import('./clear.js')`。箭头函数体里的 `import()` 在 `load()` 被调用前不会执行。启动时它只是一个没被调用的函数对象。

`supportsNonInteractive: false` 本身不产生边，但它是**别人来读你**的字段：`main.tsx:2622` 用它把本地命令过滤出 `-p`（headless）模式可用的子集。命令自己不说「我在哪些场景能用」，能力由外部逐个门禁——这条观察在 L1-05 已经建立，这里只需要记住它也是「文件之间的边」，只是数据流而非 import 流。

### 2.2 `clear.ts` 全 7 行：一条静态边，一个空字符串

```ts
import type { LocalCommandCall } from '../../types/command.js'
import { clearConversation } from './conversation.js'

export const call: LocalCommandCall = async (_, context) => {
  await clearConversation(context)
  return { type: 'text', value: '' }
}
```

**边**：`clear.ts:2 → conversation.ts`（静态、向下）。这条边没有做成动态的，理由很直接：`index.ts` 的 `load()` 已经把「进不进入这个文件」推迟过了；一旦进到这里，说明用户确实敲了 `/clear`，没有第二层可省。

**这层为什么只有 7 行**：`conversation.ts` 依赖二十几个模块，`clear.ts` 只依赖两个。把「薄壳」放在动态边之后，启动时只需要解析这 7 行。

**返回空串**：`{ type: 'text', value: '' }` 表示「往对话里放一段纯文本，内容是空」。消息列表刚被清空，如果再塞一句「已清空」，用户会看到一条孤零零的系统提示——所以故意什么都不说。

### 2.3 `conversation.ts`：策略在这里，执行在隔壁

它只有一条向下依赖：第 47 行 `import { clearSessionCaches } from './caches.js'`。

第 93–96 行，先算出「谁要保留」：

```ts
  const preservedAgentIds = new Set<string>()
  const preservedLocalAgents: LocalAgentTaskState[] = []
  const shouldKillTask = (task: AppState['tasks'][string]): boolean =>
    'isBackgrounded' in task && task.isBackgrounded === false
```

判据只有一句：**除非任务显式说自己必须在前台（`isBackgrounded === false`），否则保留**。所以「前后台」的分界线不是「谁在跑」，而是「谁声明了自己必须在前台」。

第 127 行，把名单交给隔壁：

```ts
  clearSessionCaches(preservedAgentIds)
```

这一行就是两个文件之间的**接口**：`conversation.ts` 决定「保留谁」（策略），`caches.ts` 决定「怎么清」（执行）。`caches.ts` 完全不知道什么是任务、什么是 agent，它只接受一个 `ReadonlySet<string>`。

第 183–189 行还有一个「重置一切时唯一保留的字段」：`mcp` 的客户端、工具、命令、资源全清空，唯独 `pluginReconnectKey` 从旧状态里搬过来。注释写明理由——它只由 `/reload-plugins` 递增，`/clear` 如果把它也重置，插件重连会变成一次空操作。

**读这个文件的正确顺序不是从上往下**，而是照执行顺序：SessionEnd 钩子（66–74）→ 遥测（76–85）→ 算保留名单（87–107）→ 清消息（109）→ 清缓存（127）→ 重建状态树（135–191）→ 换会话 ID（203）→ 重置文件指针（208）→ 重指软链（218–224）→ 补写模式与工作树（230–242）→ SessionStart 钩子（245–250）。顺序本身就是语义：钩子必须在清之前跑，否则脚本读不到会话内容。

### 2.4 `caches.ts`：一个专门清理别人的人，自己站在入口旁边

文件顶部第 1–4 行：

```ts
/**
 * Session cache clearing utilities.
 * This module is imported at startup by main.tsx, so keep imports minimal.
 */
```

第 10 行，一条**向上**的静态边：

```ts
import { clearCommandsCache } from '../../commands.js'
```

这是整个四件套里最值得停一下的地方：`caches.ts` 反过来依赖了 `commands.ts`，而 `commands.ts` 又依赖 `index.ts`。看起来像要成环，但 `index.ts` 只用 `import type` 指回来——**环在类型层被剪断了**。

唯一导出的签名（第 47–50 行）：

```ts
export function clearSessionCaches(
  preservedAgentIds: ReadonlySet<string> = new Set(),
): void {
  const hasPreserved = preservedAgentIds.size > 0
```

`hasPreserved` 只算一次，后面用它守三道门，第 63 行是第一道：

```ts
  if (!hasPreserved) resetPromptCacheBreakDetection()
```

同样的门还出现在第 92 行（swarm 权限回调）和第 115 行（dump 状态）。第四处不是门，而是**选择性清理**：`clearInvokedSkills(preservedAgentIds)`（第 117 行）——同一个函数，按 agent 粒度决定清谁。注释解释了为什么这三项只能整体保留：它们按 `requestId` 记账，无法安全地限定到主会话。

最后四段（第 128 行起）的边也是延迟的：`void import('../../tools/WebFetchTool/utils.js').then(({ clearWebFetchCache }) => clearWebFetchCache())`。`void` 表示「不等它完成」；四个大块缓存（WebFetch、ToolSearch、Agent 定义、SkillTool prompt）全部走这种写法，理由在注释里——它们属于各自的工具，工具模块不该为了清缓存被拉进这条早加载的路径。

---

## 3. 三个核心问题

### 问题 1：`caches.ts` 为什么必须在启动路径上？

先纠正一个事实：它**不是**在 `main.tsx` 顶层被 `import` 的。真实写法是两处 `await import()`：

- `main.tsx:3110`，位于 `if (options.continue)` 分支内，注释是 `Clear stale caches before resuming`；
- `main.tsx:3361`，位于 `else if (options.resume || options.fromPr || ...)` 分支内，同一句注释。

所以准确的回答分三层：

1. **它是「启动文件」能到达的模块，不是「启动时立即求值」的模块。** `--continue` / `--resume` 发生在界面渲染之前，此时要先清一次陈旧缓存，保证文件与技能的发现是新鲜的。同一份清理实现要服务两个入口：运行期的 `/clear`（经 `conversation.ts`）和启动期的恢复流程（`main.tsx` 直接调用）；分成两份清单，迟早会漂移。
2. **方向只能是这样**：要清的东西散落在 `bootstrap/`、`context`、`hooks/`、`services/`、`utils/` 二十几个模块里。如果反过来让每个模块自己注册清理器，启动时就得把全部主人加载一遍；现在由 `caches.ts` 正向认识所有主人，**代价推迟到真正清理的那一刻**。
3. **`keep imports minimal` 因此是一条纪律**：这条路径在首屏之前就会被走到。代码里的做法能数出来——重的四块改成 `void import`，条件性的两块（Tungsten、attribution）改成条件动态导入。

一句话：**它站在启动路径上，不是因为启动要用它，而是因为启动期的恢复和运行期的 `/clear` 必须共用同一份清理实现。**

### 问题 2：依赖方向是单向的吗？有没有 A ↔ B 互相引用？

把全部边列出来，逐条判方向：

| # | 边 | 类型 | 方向 |
| --- | --- | --- | --- |
| 1 | `commands.ts:9 → index.ts` | 静态 import | 注册表 → 声明 |
| 2 | `index.ts:8 → commands.ts` | `import type` | 声明 → 注册表（**编译后消失**） |
| 3 | `index.ts:16 → clear.ts` | `load()` 内动态 import | 声明 → 入口（**延迟**） |
| 4 | `clear.ts:2 → conversation.ts` | 静态 import | 入口 → 主体 |
| 5 | `conversation.ts:47 → caches.ts` | 静态 import | 主体 → 工具 |
| 6 | `caches.ts:10 → commands.ts` | 静态 import | 工具 → 注册表（**唯一的向上运行时边**） |
| 7 | `main.tsx:3110/3361 → caches.ts` | 动态 import | 启动流程 → 工具 |
| 8 | `REPL.tsx:3043/4784 → conversation.ts` | 动态 import | 界面 → 主体 |

**只看静态边**：`caches → commands → index`，而 `index` 没有任何静态回边（第 2 条被擦除、第 3 条是动态），所以静态图无环。

**把动态边也算上**：存在一个环——`commands → index ⇢ clear → conversation → caches → commands`（`⇢` 是动态边）。但这个环上有一条边是 `load()` 里的 `import()`，它只在用户敲 `/clear` 时才被走到；那时所有静态模块早已求值完毕，不可能死锁。

结论：**方向基本单向，回边有两处，各用一种手段拆掉**——类型边用 `import type` 擦除，运行边用动态 `import()` 推迟。这也正是 L1-01 讲的「循环依赖」在真实模块里的样子：不是没有环，而是环上有开关。

### 问题 3：`/clear` 之后，哪些清了、哪些故意没清？

| 清了 | 位置 | 故意没清 | 理由（代码/注释） |
| --- | --- | --- | --- |
| 消息列表 | `conversation.ts:109` | 磁盘上的旧转录 | 只重置写入指针（208 行），不删文件；清的是上下文，不是历史 |
| 会话 ID / UI 的 `conversationId` | `121`、`203` | 进程本身、cwd 之外的环境 | 没有重启进程，也没有退出 |
| 七类内存缓存 | `caches.ts` 全文 | 后台 agent 任务及其 per-agent 状态 | 判据 `isBackgrounded === false` 才杀；四项按 `hasPreserved` 保留 |
| 前台任务（kill + 移除） | `conversation.ts:140–166` | `mcp.pluginReconnectKey` | 只由 `/reload-plugins` 递增，清了会让重连变空操作 |
| `readFileState`、技能发现记录、嵌套记忆路径 | `129–132` | 当前模式与 worktree 的事实 | 缓存被清后立刻 `saveMode` / `saveWorktreeState` 补写（230–242） |
| `attribution`、`standaloneAgentContext`、`fileHistory`、`mcp` 四张表 | `168–190` | 保留任务的输出软链 | 不是清，而是重指到新会话目录（218–224） |
| plan slug、会话元数据、文件指针 | `195`、`199`、`208` | | |

一句话记法：**清的是「上下文」和「围绕上下文的缓存」；没清的是「事实」**——进程还在、目录还在、模式还在、磁盘上的旧转录还在，所以清完要立刻把事实补写回去。

---

## 4. 常见误读

| ❌ 0 基础最可能这样读 | ✅ 实际是什么 |
| --- | --- |
| 顶部注释说 `imported at startup by main.tsx`，所以是顶层 `import` | 是 `main.tsx:3110/3361` 两个分支里的 `await import()`；注释描述的是「谁用它」，不是「何时求值」 |
| 四件套是一条直线，`caches.ts` 只服务 `/clear` | 它还有两个外部入口（`main.tsx` 的恢复流程），并且反向静态依赖 `commands.ts`；它服务的场景比 `/clear` 多 |
| `/clear` 把会话「删掉了」 | 删的是消息与缓存；旧转录仍在磁盘，只是新会话不再往它后面追加（`resetSessionFilePointer`） |

---

## 5. 动手验证（以下输出是我在本仓库真实跑出来的）

**① 谁引用了四件套（一次看全）**

```bash
grep -rn "commands/clear/conversation\|commands/clear/caches\|commands/clear/index" source/src --include=*.ts --include=*.tsx
```

```
source/src/commands.ts:9:import clear from './commands/clear/index.js'
source/src/main.tsx:3110:        } = await import('./commands/clear/caches.js');
source/src/main.tsx:3361:      } = await import('./commands/clear/caches.js');
source/src/screens/REPL.tsx:3043:        } = await import('../commands/clear/conversation.js');
source/src/screens/REPL.tsx:4784:              } = await import('../commands/clear/conversation.js');
```

五条边，四条是 `await import`：**这套设计的重点不在「谁 import 谁」，而在「哪条 import 被推迟了」**。

**② 目录内部的静态边只有两条**

```bash
grep -rn "from './caches.js'\|from './conversation.js'" source/src/commands/clear
```

实际输出（两行）：`clear.ts:2` 引 conversation，`conversation.ts:47` 引 caches。`index.ts → clear.ts` 不在这份输出里，因为它是 `import('./clear.js')` 而不是 `from './clear.js'`——**grep 的写法本身就是依赖类型的指纹**。

**③ 谁真的调用清理函数**

```bash
grep -rn "clearSessionCaches(" source/src --include=*.ts --include=*.tsx
```

```
source/src/commands/clear/caches.ts:47:export function clearSessionCaches(
source/src/commands/clear/conversation.ts:127:  clearSessionCaches(preservedAgentIds)
source/src/hooks/useSwarmPermissionPoller.ts:110: * Called from clearSessionCaches() on /clear to reset stale state,
source/src/main.tsx:3111:        clearSessionCaches();
source/src/main.tsx:3362:      clearSessionCaches();
```

两个真调用点：`conversation.ts` 带名单，`main.tsx` 不带名单（恢复场景没有要保留的后台任务）。同一个函数，两种粒度。

---

## 6. 合书自测

1. 不看笔记，画出四个文件的调用图，并标出哪条边在启动时加载、哪条在敲 `/clear` 时加载。
2. `index.ts` 为什么要写 `import type { Command }`？改成普通 `import` 会多出哪条边？
3. `caches.ts` 第 10 行 import 了 `commands.ts`，为什么没有形成循环依赖？
4. 敲完 `/clear`，后台正在跑的 agent 任务会怎样？哪一行代码决定它？
5. 为什么清完缓存还要调 `saveMode` / `saveWorktreeState`？不写回会丢什么？

<details>
<summary>参考答案（先自己写，再展开）</summary>

1. 主链 `commands.ts:9 → index.ts ⇢（load）clear.ts → conversation.ts → caches.ts`；旁支 `main.tsx ⇢ caches.ts`、`REPL.tsx ⇢ conversation.ts`；回边 `caches.ts → commands.ts`。实线是静态，虚线/`⇢` 是动态。启动时只加载 `commands.ts → index.ts` 这一小段，其余全部按需。
2. 因为 `commands.ts` 第 9 行静态 import 了 `index.ts`，若这里再用普通 import 指回去，就形成真正的运行时环。`import type` 编译后整行消失，只在类型检查时存在。
3. 环要求的最后一条边是 `index.ts → commands.ts`，而它是 type-only；此外 `index → clear → conversation → caches` 这一段里，`index → clear` 是动态边。静态图上没有环，动态环被用户动作隔开。
4. 保留。判据是 `shouldKillTask`：只有 `'isBackgrounded' in task && task.isBackgrounded === false`（显式声明必须在前台）才被杀。保留的任务还会在 218–224 行把输出软链重指到新会话目录。
5. 因为 `clearSessionMetadata()` 把模式和 worktree 从缓存里清掉了，但进程**仍然处在**那个模式、那个工作树里。不写回，下一次 `--resume` 会以为这是普通模式的新会话，协调者模式和工作树信息就丢了。

</details>

---

## 7. 下一课时

- 下一课：[L3-02 GlobTool 三件套](./L3-02-GlobTool三件套.md)——换一种拆法：不是「一条链上的四段」，而是「同一个工具的三张面孔」。路线位置见[零基础学习路线 · L3](../00-零基础学习路线.md)。
