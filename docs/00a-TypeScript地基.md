# TypeScript 地基（中文念法）

> 这是 [零基础学习路线](00-零基础学习路线.md) 里 **L0 层的配套讲义**。
> 地图告诉你「读哪几行」，这份告诉你「那几行中文怎么念」。
> **只讲这个仓库里真实出现的语法**，不讲的语法你在这 50 万行里基本也不会遇到。

---

## 1. 先建立一个心智模型

### 1.1 代码有三个读者

同一行代码，同时服务三个读者：

| 读者 | 关心什么 | 举例 |
| --- | --- | --- |
| **编译器** | 类型对不对、有没有漏参数 | `satisfies Command` 就是写给它的 |
| **运行时** | 真的会执行什么 | `await clearConversation(ctx)` 会真的去清会话 |
| **人（你）** | 它想解决什么问题 | 顶部那段 `/** ... */` 注释 |

**0 基础最容易犯的错**：把「写给编译器的」当成「会执行的」。比如 `import type`、`satisfies`、`: string` 这些，编译完**一个字都不剩**。看到它们不用怕——它们不会「做事」，只是在「打标签」。

### 1.2 两种注释，作用完全不同

```ts
/**
 * Clear command - minimal metadata only.
 */                        ← 块注释：多行，常被工具抽出来当文档
import type { Command } from '../../commands.js'

const clear = {
  ...
  supportsNonInteractive: false, // Should just create a new session
}                                ↑ 行注释：只影响这一行
```

| 写法 | 名字 | 特点 |
| --- | --- | --- |
| `/** ... */` | JSDoc 块注释 | 出现在声明**上方**时，VSCode 悬停能看到；本仓库的批注版里，中文就插在这种块的下方 |
| `/* ... */` | 普通块注释 | 可以临时「注释掉」一段代码 |
| `// ...` | 行注释 | 只管到行尾，最常用 |

**读代码时的用法**：看到 `/**` 就知道「接下来要定义一个大东西了」；看到 `//` 就知道「这是对上一行的补充说明」。

### 1.3 一个文件的四段结构

以 [`commands/clear/index.ts`](../annotated/src/commands/clear/index.ts) 为例，19 行分成四段：

```ts
/**  ① 文件说明（1–7 行）：这个文件干什么、有什么注意事项
 * ...
 */
import type { Command } from '../../commands.js'   // ② 导入（8 行）

const clear = { ... }                              // ③ 定义（10–17 行）

export default clear                               // ④ 导出（19 行）
```

**这个顺序在本仓库 95% 的文件里都成立**。你打开任何一个新文件，先按这四段扫一眼，就知道大致结构了。

### 1.4 为什么到处是「小文件」

`toolName.ts` 只有 2 行：

```ts
// Here to break circular dependency from prompt.ts
export const BASH_TOOL_NAME = 'Bash'
```

`FileEditTool/constants.ts` 只有 11 行，第一行注释是 `// In its own file to avoid circular dependencies`。

**原因（务必记住）**：模块 A 需要 B 的东西，B 又需要 A 的东西，就叫**循环依赖**，加载顺序会变成死结。解法是把双方都要的东西提到第三个文件 C 里，A 和 B 都只依赖 C。

所以在这个仓库里看到「一个常量单独一个文件」，不要觉得奇怪——**那是解耦的痕迹，不是设计失误**。

### 1.5 为什么 import 写 `.js`，文件却是 `.ts`

```
代码里：  import type { Command } from '../../commands.js'
磁盘上：  source/src/commands.ts
```

TypeScript 会编译成 JavaScript，编译后文件真的叫 `commands.js`。为了让**编译产物**能正确找到文件，路径必须写最终形态。ES Module 规定路径要带扩展名，所以 `.js` 不是笔误，是必须。

**记忆口诀**：**找文件搜 `.ts`，找引用搜 `.js`。**

---

## 2. 语法逐条（每条都配真实代码）

### 2.1 `const` 与 `let`

```ts
const clear = { ... }          // 不能再重新赋值
let lastAssistantId: string | undefined   // 后面会变
```

| 关键字 | 能不能改指向 | 本仓库常见度 |
| --- | --- | --- |
| `const` | 不能 | 极高（默认都用它） |
| `let` | 能 | 低（循环里的累加变量） |
| `var` | 能，且有历史坑 | **零**（别用） |

**注意**：`const` 只保证「不能重新赋值」，**不保证内容不能改**：

```ts
const groups: Message[][] = []
groups.push(current)      // ✅ 合法：改的是内容，不是指向
```

`grouping.ts` 第 23 行就是这个写法。**这是 0 基础第一个反直觉点。**

### 2.2 解构：把「拆开取」写成一行

**数组解构**

```ts
const [isElapsed, setIsElapsed] = useState(false)
//     ↑ 第一个元素        ↑ 第二个元素
```

[`useTimeout.ts`](../annotated/src/hooks/useTimeout.ts) 第 4 行。`useState` 返回一个两元素数组：当前值 + 修改函数。

**对象解构**

```ts
export async function clearConversation({
  getAppState,
  setAppState,
  ...
}: ClearContext)
//  ↑ 直接把参数的字段拆成局部变量
```

[`conversation.ts`](../annotated/src/commands/clear/conversation.ts) 第 49 行。参数是一整个对象，但只取需要的几个字段。

**中文念法**：
> 「从这个对象里，把 `getAppState`、`setAppState` 这几个字段取出来，直接当变量用。」

### 2.3 `?` 的三种含义（同一个符号，三个地方）

| 出现位置 | 含义 | 例子 |
| --- | --- | --- |
| 参数名后 | 这个参数**可以不传** | `resetTrigger?: number`（`useTimeout.ts` 第 3 行） |
| 属性名后 | 这个字段**可能不存在** | `message?: string`（`commandSemantics.ts` 第 16 行） |
| 变量名后紧跟 `.` | **空就停**，别崩 | `clock?.now()`（`use-interval.ts` 第 15 行） |

**三者完全不是一回事**，但长得像。看到 `?` 先判断它跟的是谁。

### 2.4 `satisfies` 与「类型标注」的区别（本仓库最值得学的一招）

两种写法，长得像，效果差很远：

```ts
// 写法 A：类型标注
const clear: Command = { type: 'local', name: 'clear', ... }

// 写法 B：satisfies
const clear = { type: 'local', name: 'clear', ... } satisfies Command
```

| | 写法 A `: Command` | 写法 B `satisfies Command` |
| --- | --- | --- |
| 检查字段对不对 | ✅ | ✅ |
| 推断出的类型 | **宽**：`type` 变成 `string` | **窄**：`type` 还是 `'local'` |
| 后果 | 后面写 `clear.type === 'locl'`（拼错）编译不报错 | 拼错立刻报错 |

**中文念法**：
> 「按 `Command` 的规矩检查我，但**别把我的类型改宽**。」

真实出处：[`clear/index.ts`](../annotated/src/commands/clear/index.ts) 第 17 行。这是 TypeScript 4.9 才有的语法，这个仓库大量使用——**说明作者很在意「别把类型放宽」**。

### 2.5 联合类型：`|` 读作「或」

```ts
export type PermissionBehavior = 'allow' | 'deny' | 'ask'
```

[`types/permissions.ts`](../source/src/types/permissions.ts) 第 44 行。

这一行干了三件事：
1. 定义了一个新类型 `PermissionBehavior`
2. 它只能取三个值之一
3. 全项目任何地方用到「权限判定结果」，都用它

**为什么不用 `string`**：因为 `PermissionBehavior` 写错一个字，**编译期就报错**；`string` 写错了，要等运行时才发现。

**中文念法**：
> 「`PermissionBehavior` 只能是 `allow`、`deny` 或 `ask` 三者之一。」

### 2.6 函数类型别名：给一种「函数长相」起名字

```ts
export type CommandSemantic = (
  exitCode: number,
  stdout: string,
  stderr: string,
) => {
  isError: boolean
  message?: string
}
```

[`commandSemantics.ts`](../annotated/src/tools/BashTool/commandSemantics.ts) 第 10–17 行。

**逐段念**：
> 「`CommandSemantic` 是一种函数：收三个参数（数字、字符串、字符串），返回一个对象，对象里有必填的 `isError`（布尔）和可选的 `message`（字符串）。」

**为什么要起名字**：起了名字，就能当普通类型用——塞进 `Map<string, CommandSemantic>`（第 31 行）、当参数传、当返回值。**「函数」在这个仓库里是一等公民，可以像数字一样传递。**

### 2.7 泛型 `<>`：只需要懂「占位」

```ts
const COMMAND_SEMANTICS: Map<string, CommandSemantic> = new Map([...])
//                          ↑键类型  ↑值类型
```

[`commandSemantics.ts`](../annotated/src/tools/BashTool/commandSemantics.ts) 第 31 行。

`Map<K, V>` 里的 `K` `V` 就是占位符——「一个键是 K、值是 V 的字典」。这里 K = `string`（命令名，如 `grep`），V = `CommandSemantic`（处理它的函数）。

**中文念法**：
> 「一张表，键是字符串，值是 `CommandSemantic` 类型的函数。」

**0 基础只需记住**：看到 `Foo<Bar>` 就读作「装 `Bar` 的 `Foo`」。`Array<string>` = 装字符串的数组，`Promise<number>` = 最终会给出数字的承诺。

### 2.8 箭头函数的三种写法

```ts
// ① 单表达式，隐式返回
const add = (a: number, b: number) => a + b

// ② 要返回对象，必须套圆括号（否则 {} 被当函数体）
const make = (x: number) => ({ value: x })

// ③ 多语句，显式 return
const run = async (ctx: Context) => {
  await doSomething(ctx)
  return { ok: true }
}
```

**真实出处**：② 见 [`commandSemantics.ts`](../annotated/src/tools/BashTool/commandSemantics.ts) 第 22–26 行（`=> ({` 后面直接是对象）；③ 见 [`clear.ts`](../annotated/src/commands/clear/clear.ts) 第 4–7 行。

**0 基础最常见的报错**：写 `=> { value: x }`，结果返回了 `undefined`——因为 `{}` 被当成函数体了。**返回对象一定要套圆括号。**

### 2.9 早返回：把嵌套变成直线

```ts
export function ifNotInteger(value: number | undefined, name: string): void {
  if (value === undefined) return          // 空的 → 不管
  if (Number.isInteger(value)) return      // 是整数 → 没问题
  logForDebugging(`${name} should be an integer, got ${value}`, { level: 'warn' })
}
```

[`ink/warn.ts`](../annotated/src/ink/warn.ts) 全 9 行。

**这个模式本仓库到处都是**：先排除所有「不需要处理」的情况，剩下的就是「要处理」的。读起来比 `if/else` 嵌套清爽，因为**每多一层缩进，人脑就多背一层上下文**。

### 2.10 模板字符串：反引号 + `${}`

```ts
logForDebugging(`${name} should be an integer, got ${value}`, { level: 'warn' })
//                ↑反引号                            ↑插值
```

**规则**：反引号里可以换行、可以插变量；`${}` 里能放任何表达式。

**读代码时注意**：反引号里的中文是**字符串内容**，会被真的输出。所以本仓库有一条硬性校验规则——**批注绝不能插进反引号内部**（插进去中文就变成了程序输出的一部分）。这就是 `annotate.py` 里那套「状态栈」扫描器存在的原因。

### 2.11 `void` 前缀：我知道它会返回东西，我不等

```ts
void evictTaskOutput(taskId)
```

[`conversation.ts`](../annotated/src/commands/clear/conversation.ts) 第 165 行。

**念法**：
> 「这个函数返回一个 Promise，但我**故意不 await**，因为我这会儿不等它。」

**为什么需要写 `void`**：不写的话，lint 会警告「你忘了 await」。写了就是明确表态「我没忘，我故意的」。

---

## 3. 异步：0 基础最大的坎

> 这一节必须读懂。异步没通，后面 50 万行全是天书。

### 3.1 三个词的关系

| 词 | 是什么 | 类比 |
| --- | --- | --- |
| **同步** | 一行做完才做下一行 | 排队买票，前面的人不走你就不动 |
| **异步** | 发起后先干别的，结果好了再回来 | 取号，等叫号时去买水 |
| **`Promise<T>`** | 「一张取货单」，将来会给你一个 `T` | 取号小票 |

### 3.2 `async` / `await` 到底改了什么

```ts
export const call: LocalCommandCall = async (_, context) => {
  await clearConversation(context)
  return { type: 'text', value: '' }
}
```

[`clear.ts`](../annotated/src/commands/clear/clear.ts) 全 7 行。

**逐行念**：
1. `async` —— 「这个函数要做等待的事，所以它**一定**返回 `Promise`」
2. `await clearConversation(context)` —— 「现在等它做完，**做完了才走下一行**」
3. `return {...}` —— 「返回值会被自动包进 `Promise`」

**把 `await` 删掉会怎样**：清理还没开始就返回了「成功」。**这是 0 基础最常写出的 bug**——程序不报错，但行为是错的。

### 3.3 `async` 的三个连带后果

1. **调用它的人也必须 `await`**（否则拿到的是 Promise，不是结果）
2. **没 `await` 的 `try/catch` 抓不到它的错误**（错误会变成「未处理的 Promise 拒绝」）
3. **一个 `async` 会往上传染整条调用链**——所以这个仓库大量函数都是 `async`

```ts
export async function clearConversation({ ... }: ClearContext)   // conversation.ts:49
```

看到 `export async function` 就知道：**它内部一定有 `await`，它的调用者也得等**。

### 3.4 错误处理：`try / catch` 在异步里怎么用

```ts
} catch (error) {
  logError(error)
}
```

[`conversation.ts`](../annotated/src/commands/clear/conversation.ts) 第 162 行。

**念法**：
> 「上面那段 `try` 里任何一步抛错，都跳到这里，把错误交给 `logError`。**不再往上抛。**」

**为什么这里故意吞掉**：清理是「尽力而为」——一个任务清理失败，不能让整次 `/clear` 中断。**吞错误是一个决定，不是一个疏忽**。判断标准：这个错误如果往上抛，会让用户更接近目标还是更远离？这里是更远离，所以吞。

### 3.5 并发：`Promise.all` 是什么意思

```ts
const [a, b] = await Promise.all([fetchA(), fetchB()])
```

**念法**：
> 「同时发起两个请求，**两个都**好了才继续。」

**对比串行**：

```ts
const a = await fetchA()     // 等 A 完
const b = await fetchB()     // 再等 B 完     ← 总时长 = A + B
```

**这个仓库里到处是这种选择**：能并行的都并行（比如 `analyzeContext.ts` 里七个计数器同时算）。读代码时看到 `Promise.all`，就该问一句「它为什么敢并行」——答案通常是「这几件事互不依赖」。

---

## 4. 模块系统：谁引用谁

### 4.1 `import` 的四种写法

```ts
import type { Command } from '../../commands.js'          // ① 只要类型
import { clearConversation } from './conversation.js'      // ② 要真东西（具名）
import clear from './clear.js'                             // ③ 默认导入（名字自己起）
import * as path from 'path'                               // ④ 整个模块打包进来
```

| 写法 | 编译后 | 用在哪 |
| --- | --- | --- |
| ① `import type` | **整行消失** | 只用来标注类型 |
| ② `{ X }` | 保留，取名为 `X` | 最常用 |
| ③ `X` | 保留，取默认导出的东西 | 命令注册表这类「一个文件一个主体」 |
| ④ `* as X` | 保留，包成对象 | 少数（如 `path`） |

### 4.2 动态导入：`import()` 是函数

```ts
load: () => import('./clear.js')
```

[`clear/index.ts`](../annotated/src/commands/clear/index.ts) 第 16 行。

**和上面四种的区别**：前四种在**文件被加载时**就执行；`import()` 是**函数调用**，只有真正调 `load()` 时才去读那个文件。返回的是 `Promise`。

**为什么这么写**（本仓库反复出现的模式）：
> 启动时只读 19 行的声明，把 251 行的实现**推迟**到用户真的敲 `/clear` 时才加载。这叫**懒加载**，目的是省启动时间。`clear/index.ts` 第 3 行注释写得很明白：`Implementation is lazy-loaded from clear.ts to reduce startup time.`

### 4.3 循环依赖：为什么会死结、怎么破

```
A.ts  ──import──▶  B.ts
  ▲                   │
  └─────import────────┘        ← 死结：先加载谁？
```

**破法**（本仓库的标准做法）：把双方都要的东西提到 C：

```
A.ts ──▶ C.ts ◀── B.ts          ← 单向，永不打架
```

真实例子：`toolName.ts`（2 行）、`FileEditTool/constants.ts`（11 行）、`grouping.ts`（63 行，注释里写明「为了打断 compact.ts ↔ compactMessages.ts 的循环」）。

**读代码时的用法**：看到「一个文件小得莫名其妙」，先看它第一行注释——十有八九写着 `avoid circular dependencies`。**这是理解这个仓库文件划分的一把钥匙。**

---

## 5. 中文念法练习（五个真实长行）

读代码卡住，往往不是不懂单词，是**一句话里有三层嵌套**。练习把它念成中文。

### 练习 1

```ts
const semantic = COMMAND_SEMANTICS.get(baseCommand) ?? DEFAULT_SEMANTIC
```

**念**：
> 「去 `COMMAND_SEMANTICS` 这张表里，拿 `baseCommand` 对应的处理函数；表里没有，就用默认的处理函数。」

### 练习 2

```ts
msg.type === 'assistant' && msg.message.id !== lastAssistantId && current.length > 0
```

**念**：
> 「这条消息是助手发的，**并且**它的 id 和上一轮的 id 不同（说明是新的一轮），**并且**当前组里已经有东西了（不能交出一个空组）。」

### 练习 3

```ts
const [time, setTime] = useState(() => clock?.now() ?? 0)
```

**念**：
> 「声明一个状态 `time`，初始值这么算：问 `clock` 现在几点；`clock` 要是没有，就用 `0`。」

### 练习 4

```ts
export const call: LocalCommandCall = async (_, context) => { ... }
```

**念**：
> 「导出一个叫 `call` 的东西，它的类型是 `LocalCommandCall`（一种异步函数），它收两个参数（第一个我不用，第二个叫 `context`）。」

### 练习 5

```ts
load: () => import('./clear.js')
```

**念**：
> 「`load` 这个字段的值是一个**函数**（收零个参数）；调用它会去加载 `clear.js`，返回一个 Promise。」

---

## 6. 二十个术语小字典

| 术语 | 中文 | 一句话解释 |
| --- | --- | --- |
| type annotation | 类型标注 | `: string` 这种「贴标签」 |
| type inference | 类型推断 | 你没写，编译器自己猜出来的 |
| union type | 联合类型 | `A \| B`，取其一 |
| optional | 可选 | `?` 后缀，可以不存在 |
| generic | 泛型 | `<>` 里的占位符 |
| interface | 接口 | 描述「一个对象该有哪些字段」 |
| satisfies | 满足 | 检查类型但不改宽（§2.4） |
| destructuring | 解构 | 把对象/数组拆成变量 |
| arrow function | 箭头函数 | `() => {}` |
| callback | 回调 | 作为参数传进去、稍后被调用的函数 |
| Promise | 承诺 | 将来会给出结果的对象 |
| async / await | 异步 / 等待 | 标记异步、等待结果 |
| resolve / reject | 兑现 / 拒绝 | Promise 的两种结局 |
| module | 模块 | 一个文件 |
| named export | 具名导出 | `export const X` |
| default export | 默认导出 | `export default X` |
| circular dependency | 循环依赖 | A↔B 互引，要拆第三方 |
| lazy loading | 懒加载 | 用到时才加载（`import()`） |
| hook | 钩子 | React 里以 `use` 开头的函数 |
| side effect | 副作用 | 除返回值外还改了外部状态 |

---

## 7. 十个高频误读（0 基础最容易掉进去）

| ❌ 误读 | ✅ 实际 |
| --- | --- |
| `import type` 会加载模块 | 编译后整行删掉，运行时不存在 |
| `const` 的内容不能改 | 只是不能重新赋值，`push` 完全合法 |
| `?` 都是「可空」 | 参数后=可不传，属性后=可能没有，变量后=空就停 |
| `: Command` 和 `satisfies Command` 一样 | 前者把类型改宽，后者保持窄类型 |
| `=> { x: 1 }` 返回 `{x:1}` | 返回 `undefined`，要写成 `=> ({ x: 1 })` |
| 删掉 `await` 只是少等一会儿 | 是逻辑 bug：后续代码在结果到来前就执行了 |
| `try/catch` 能抓住没 `await` 的异步错误 | 抓不住，会变成未处理拒绝 |
| `.js` 是笔误 | 必须写，编译产物就是 `.js` |
| 小文件是设计失误 | 通常是拆循环依赖的产物 |
| `!` 是「不是」 | 在表达式后是「我保证非空」，在表达式前才是「取反」 |

---

## 8. 学完之后

回到 [零基础学习路线](00-零基础学习路线.md)，从 **L0-1** 开始做卡片。每个卡片都会指回这份讲义的某一节——**卡住就回来查，不要硬扛。**

> 一句话总结这份讲义：**这个仓库里 90% 的代码，都是「数据从 A 流到 B，每步做个小变换」。类型标注、`satisfies`、`?.` 这些都是为了让这条路不出错。看清路，比记住语法重要。**
