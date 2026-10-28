# L0-02 · `import` 的两种面孔（值 vs 类型）

> 上一课的 19 行里只有一句导入。这一课把那句导入拆成零件，再和另一句对比，搞清一件反直觉的事：**同一行 `import`，编译后可能整行消失，也可能真的去加载一个文件。**

| 项目 | 内容 |
| --- | --- |
| 课时号 | L0-02（L0 层第 2 课，共 11 课） |
| ⏱ 时长 | 20 分钟 |
| 前置课时 | [`./L0-01-一个TypeScript文件长什么样.md`](./L0-01-一个TypeScript文件长什么样.md) |
| 教材 | [`annotated/src/commands/clear/index.ts`](../../annotated/src/commands/clear/index.ts) 第 8 行<br>[`annotated/src/commands/clear/clear.ts`](../../annotated/src/commands/clear/clear.ts) 第 1–2 行<br>原文对照：[`source/src/commands/clear/clear.ts`](../../source/src/commands/clear/clear.ts)（7 行） |
| 配套讲义 | [`../00a-TypeScript地基.md`](../00a-TypeScript地基.md) §4.1 |
| 路线图卡片 | [`../00-零基础学习路线.md`](../00-零基础学习路线.md) 的「L0-2」一节 |

**摘录约定**：`│` 左边是原文行号，右边是原文逐字内容。行号以 `source/` 原文为准。

---

## 1. 三行教材摆在一起

```ts
index.ts:8  │ import type { Command } from '../../commands.js'

clear.ts:1  │ import type { LocalCommandCall } from '../../types/command.js'
clear.ts:2  │ import { clearConversation } from './conversation.js'
```

三行三个共同点：都以 `import` 开头、都从别的文件拿东西、都以 `.js` 结尾。

前两行和第 3 行只差一个 `type`，但这一个词决定了它们**编译后的命运完全不同**：

| 行 | 导入的名字 | 有 `type` 吗 | 这个名字是什么 | 编译后 |
| --- | --- | --- | --- | --- |
| index.ts:8 | `Command` | 有 | 类型（描述数据形状的规矩） | 整行消失 |
| clear.ts:1 | `LocalCommandCall` | 有 | 类型（描述函数形状的规矩） | 整行消失 |
| clear.ts:2 | `clearConversation` | 没有 | 值（一个真的函数） | 保留，运行时真的去加载 `conversation.js` |

## 2. 精读正文

### 2.1 `index.ts` 第 8 行：五个零件

```ts
8 │ import type { Command } from '../../commands.js'
```

从左到右五个零件：

1. **`import`** —— 关键字，告诉编译器「我要从别的模块拿东西」。
2. **`type`** —— 修饰符，声明「我只拿**类型**，不拿任何运行时存在的东西」。这是本课主角。
3. **`{ Command }`** —— **具名导入**。花括号里写对方导出的名字，一个字都不能差（`Command` 首字母大写，是类型的命名惯例）。
4. **`from`** —— 固定搭配，`import ... from ...`。
5. **`'../../commands.js'`** —— 模块路径。`commands/clear/` 上两级到 `src/`，所以指向 `source/src/commands.ts`。

**中文念法**：

> 「从 `../../commands.js` 里，只借用 `Command` 这个**类型说明**；它不是东西，是一个规矩，编译完就不需要它了。」

**它在这一行后面被怎么用**：`index.ts` 里 `Command` 只出现一次，在第 17 行 `} satisfies Command`——那是**类型位置**，纯粹给编译器看。既然运行时根本不需要这个名字，那就该用 `import type`。

### 2.2 `clear.ts` 第 1 行：同款，换了个类型名

```ts
1 │ import type { LocalCommandCall } from '../../types/command.js'
```

同一种写法，只是类型名叫 `LocalCommandCall`，来自 `source/src/types/command.ts`。这个类型的真实定义（该文件第 62–66 行）：

```ts
62 │ export type LocalCommandCall = (
63 │   args: string,
64 │   context: LocalJSXCommandContext,
65 │ ) => Promise<LocalCommandResult>
```

**念法**：「`LocalCommandCall` 是一种函数：收两个参数（字符串、上下文对象），返回一个 `Promise`，里面装着 `LocalCommandResult`。」

所以第 1 行在说：「我下面要定义一个函数，它的长相得符合 `LocalCommandCall` 这个规矩」——同样只是**贴标签**，运行时什么都不做。

### 2.3 `clear.ts` 第 2 行：值导入，因为它要被**调用**

```ts
2 │ import { clearConversation } from './conversation.js'
```

同一个文件里，为什么这行没有 `type`？看它后面怎么用（第 4–7 行）：

```ts
4 │ export const call: LocalCommandCall = async (_, context) => {
5 │   await clearConversation(context)
6 │   return { type: 'text', value: '' }
7 │ }
```

第 5 行 **`clearConversation(context)`** —— 加了圆括号，就是在**调用**它。要调用一个函数，运行时必须真的拿到这个函数本体；而函数本体在 `conversation.js` 里（`conversation.ts`，实测 251 行）。所以这行必须是值导入，编译后必须保留，运行时会真的加载那个模块。

**一句话对照**：

> `Command` 只需要「名字」，`clearConversation` 需要「身体」。名字编译后就扔，身体必须带着走。

### 2.4 一行里既要类型又要值：`{ type X }` 写法

有时候一行里既拿一个类型、又拿一个真的东西。这时用行内 `type` 修饰符，只给类型那个名字加 `type`。真实例子 `source/src/bridge/sessionRunner.ts` 第 1 行：

```ts
1 │ import { type ChildProcess, spawn } from 'child_process'
```

**念法**：「从 `child_process` 里拿两样：`ChildProcess` 只要它的**类型**，`spawn` 要它的**函数本体**。」这种写法实测有 **210 处**（`grep -rn "import { type " source/src | wc -l`），和整行 `import type` 表达的是同一件事，区别只是「一行里混不混值」。

### 2.5 证据：编译产物里到底还剩什么

`source/cli.js` 是这个仓库打包后的产物（13 MB）。拿它和源码对比：

- `grep -c "import type" source/cli.js` → `0`
- `grep -rn "import type" source/src | wc -l` → `2392`

源码里 2392 处 `import type`，产物里 **0 处**——它们全部在编译/打包时被抹掉了。

再看一个更细的证据：`index.ts` 第 13 行那句 `description` 字符串是**值**，必须活下来；第 2 行那句英文注释是**注释**，必须死掉：

- `grep -c "Clear conversation history and free up context" source/cli.js` → `1`（字符串还在，被保留了一次）
- `grep -c "minimal metadata only" source/cli.js` → `0`（注释没了）

**结论**：`import type` 和注释是同一类东西——**只在源码阶段存在**。编译器把它们当脚手架，砌完就拆。

### 2.6 四种导入写法对照（讲义 §4.1）

| 写法 | 编译后 | 你拿到的是 | 本课出处 |
| --- | --- | --- | --- |
| ① `import type { X }` | 整行消失 | 一个类型名 | index.ts:8、clear.ts:1 |
| ② `import { X }` | 保留 | 真的值 | clear.ts:2 |
| ③ `import X` | 保留 | 对方默认导出的东西 | L0-03 讲 |
| ④ `import * as X` | 保留 | 一个装着所有导出的对象 | 本课不涉及 |

## 3. 三个问题（完整解答）

### 问题 1：如果把第 8 行的 `type` 删掉，代码还能跑吗？

**能跑，但会变差**，而且差的不是一点：

1. **多一次运行时加载**。写成 `import { Command } from '../../commands.js'`，编译器就认为「你运行时要这个模块」，产物里会保留这次导入。`commands.ts` 是 **754 行**，它自己还导入几十个命令——为了一个类型，把整张命令表拖进入口。
2. **和这个文件的设计目标冲突**。`index.ts` 第 3 行注释写着 `to reduce startup time`，第 10–17 行唯一的重活被藏进 `load()` 里推迟执行。删掉 `type` 相当于在门口又开一个口子。
3. **可能引入循环依赖**。`commands.ts` 第 9 行正要 `import clear from './commands/clear/index.js'`——它导入 `index.ts`，`index.ts` 又导入它。类型导入不产生运行时边，现在没事；一旦变成值导入，这条边就真实存在（机制见 L0-03）。

所以答案是：**能跑，但这是把「零成本」换成「有成本」，没有任何收益。**

### 问题 2：为什么 `Command` 用 `import type`，而 `clearConversation` 不用？

判断标准只有一条：**这个东西在运行时需不需要存在。**

| | `Command`（index.ts:8） | `clearConversation`（clear.ts:2） |
| --- | --- | --- |
| 本质 | 类型：描述「对象该有哪些字段」的规矩 | 值：一个真的函数 |
| 运行时存在吗 | 不存在。类型编译后一个字都不剩 | 存在。就是 `conversation.js` 里那个函数 |
| 用它做什么 | 第 17 行 `satisfies Command`，纯检查 | 第 5 行 `clearConversation(context)`，真的调用 |
| 必须怎么导入 | `import type`（否则白拖一个模块） | 普通 `import`（否则调用不到） |

**反过来记更牢**：如果你写了 `import type { clearConversation }`，第 5 行的调用会直接编译报错——TypeScript 会告诉你：这个名字是用 `import type` 导入的，不能当值用。

### 问题 3：`import type` 能不能导入一个函数？为什么？

**语法上能写，实际用不了。**

```ts
import type { clearConversation } from './conversation.js'   // 语法合法
```

这行不会报错，因为它只是在说「我知道那边有个叫 `clearConversation` 的名字，它的类型我有兴趣」。但导入进来的这个名字**只能出现在类型位置**：

- 可以：`let f: typeof clearConversation` —— 拿它的**形状**当类型用，合法。
- 不行：`clearConversation(context)` —— 一旦当值用，编译立刻报错。

**为什么**：`import type` 承诺了「编译后这行消失」。如果允许你调用它，运行时就得真的去加载模块——承诺就破了。TypeScript 选择了「宁可报错，也不偷偷保留导入」，这样「`import type` 一定零运行时成本」这条保证才立得住。

**实践结论**：要调用 → 值导入；只贴标签 → `import type`。

## 4. 常见误读

**误读 1：以为 `import type` 只是「写起来更清楚」，编译后和普通导入一样。**
不一样。产物里 `import type` 是 **0 处**（实测 `source/cli.js`），源码里 2392 处。它不是风格问题，是「有没有运行时成本」的问题。

**误读 2：以为 `import type` 拿不到值，所以连类型也用不了。**
反了。`import type` 拿到的正是类型，而且**只能**当类型用。它不能调用、不能当参数传、不能 `console.log`——这些都属于「当值用」。

**误读 3：看到 `import { clearConversation }` 就以为它会把整个 `conversation.ts` 的全部内容搬过来。**
不会。具名导入只绑定**那一个名字**。`conversation.ts` 里其他导出（比如 `clearSessionCaches` 之类）不会出现在这个文件的作用域里。搬不搬、怎么搬是打包器的事，你只拿到你点名的那个。

## 5. 动手验证

在仓库根目录跑：

```bash
grep -rn "import type" source/src/commands/clear/
```

**我实际跑出来的输出**：

```
source/src/commands/clear/clear.ts:1:import type { LocalCommandCall } from '../../types/command.js'
source/src/commands/clear/conversation.ts:17:import type { AppState } from '../../state/AppState.js'
source/src/commands/clear/conversation.ts:25:import type { Message } from '../../types/message.js'
source/src/commands/clear/conversation.ts:27:import type { FileStateCache } from '../../utils/fileStateCache.js'
source/src/commands/clear/index.ts:8:import type { Command } from '../../commands.js'
```

`clear/` 目录一共 4 个文件，`import type` 出现 5 次，分布很有规律：

- `index.ts`、`clear.ts` 各 1 次，都在第一行——**类型导入永远排在最前**，因为它们不参与运行顺序。
- `conversation.ts` 3 次，且都是 `AppState`、`Message`、`FileStateCache` 这类「数据形状」的名字。
- 这 5 行**全都没有**导出一个可调用的东西，正好印证了「`import type` 只贴标签」。

全仓统计一次，和产物对照：

```bash
grep -rn "import type" source/src | wc -l
grep -c "import type" source/cli.js
```

**实际输出**：`2392` 和 `0`——源码里的 2392 行，在产物里一行不剩。

## 6. 合书自测

**1. 给你 `import type { A } from './x.js'` 和 `import { A } from './x.js'`，说出「编译后谁还在」。**

<details>
<summary>参考答案</summary>

第一行整行消失，第二行保留。判断依据不是风格，而是「运行时要不要这个名字」。

</details>

**2. 想让 `clear.ts` 第 5 行能调用 `clearConversation`，第 2 行能不能写成 `import type`？**

<details>
<summary>参考答案</summary>

不能。`import type` 导入的名字只能出现在类型位置，`clearConversation(context)` 是当值调用，编译直接报错。

</details>

**3. 为什么这个仓库里 `import type` 有 2392 处这么多？**

<details>
<summary>参考答案</summary>

因为大量文件之间只共享「数据形状」（`Message`、`AppState`、`Command` 这类），并不共享可执行代码。用 `import type` 能把这类依赖的运行时成本降为零，避免为了类型去加载几百行的模块。

</details>

**4. `import { type ChildProcess, spawn } from 'child_process'` 里，哪个名字编译后还在？**

<details>
<summary>参考答案</summary>

`spawn` 还在（是值），`ChildProcess` 消失（被行内 `type` 标记）。这种写法用于「一行里混着类型和值」的场合。

</details>

**5. 只看 `index.ts` 第 8 行，你怎么判断 `Command` 是类型而不是值？**

<details>
<summary>参考答案</summary>

两个信号：① 行里有 `type` 关键字；② `Command` 首字母大写，本仓库的类型都用这种命名。再加一条硬证据：整个文件里 `Command` 只出现在 `satisfies Command`（类型位置），从没被调用或赋值。

</details>

## 7. 下一课时

→ [`./L0-03-export的两种面孔.md`](./L0-03-export的两种面孔.md)：导入的另一半是导出。`export default` 和 `export const` 差在哪，以及为什么一个 2 行的常量值得单独占一个文件。

**卡住回看**：

- 四种导入写法总表 → [`../00a-TypeScript地基.md`](../00a-TypeScript地基.md) §4.1
- 动态 `import()` 与懒加载 → [`../00a-TypeScript地基.md`](../00a-TypeScript地基.md) §4.2
- `.js` 后缀的来由 → [`../00a-TypeScript地基.md`](../00a-TypeScript地基.md) §1.5
