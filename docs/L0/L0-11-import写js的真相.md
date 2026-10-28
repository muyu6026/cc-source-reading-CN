# L0-11 · 为什么 `import` 写 `.js`，文件却是 `.ts`

> **课时号**：L0-11　**标题**：为什么 `import` 写 `.js` 但文件是 `.ts`　**⏱ 时长**：10 分钟（精读 6 + 动手 4）
> **前置课时**：[L0-02 import 的两种面孔](./L0-02-import的两种面孔.md)、[L0-08 async 与 await](./L0-08-async与await.md)
> **本课目标**：见到 `.js` 路径不再以为写错；知道该搜 `.ts` 还是搜 `.js`
> **教材清单**：
> - A：[`source/src/commands/clear/index.ts`](../../source/src/commands/clear/index.ts#L1-L19)（全 19 行，本课时主教材）
> - B：批注版 [`annotated/src/commands/clear/index.ts`](../../annotated/src/commands/clear/index.ts#L57)（同一句代码在第 57 行、动态 import 在第 96 行）
> - C：[`source/src/commands.ts`](../../source/src/commands.ts#L1-L10)（第 9 行，谁引用了这个文件）
> - D：[`source/package.json`](../../source/package.json)（`type` 字段，全仓 ESM 的证据）
>
> 行号说明：路线图写「读批注版第 8 行」，我实际读下来，批注版第 8 行是中文注释；**同一句代码**在批注版是第 57 行、在原文是第 8 行（批注插行导致位移）。下文用原文行号。

---

## 1. 先看现象：代码里写 `.js`，磁盘上只有 `.ts`

教材 A 第 8 行，原文逐字：

```ts
// source/src/commands/clear/index.ts:8
import type { Command } from '../../commands.js'
```

从这行出发，路径是 `commands/clear/` 往上两级 + `commands.js`，也就是 `source/src/commands.js`。但磁盘上：

```
source/src/commands.ts     ← 有的是这个
source/src/commands.js     ← 没有这个
```

**这不是笔误，是全仓的统一写法。** 光 `commands.ts` 一个文件里，以 `.js` 结尾的 import 就有 125 处（后面有验证命令）。

---

## 2. 精读正文

### 2.1 第 1–7 行：文件头的说明

```ts
// source/src/commands/clear/index.ts:1-7
/**
 * Clear command - minimal metadata only.
 * Implementation is lazy-loaded from clear.ts to reduce startup time.
 * Utility functions:
 * - clearSessionCaches: import from './clear/caches.js'
 * - clearConversation: import from './clear/conversation.js'
 */
```

这是**块注释**：`/**` 开头、`*/` 结尾，中间每行以 `*` 起头。它不参与执行，只是给人看的说明。

内容讲了三件事：这个文件只放「最精简的元信息」；真正的实现从 `clear.ts` **惰性加载**（为了缩短启动时间）；两个工具函数分别从 `caches.js`、`conversation.js` 导入。

注意注释里也写 `.js`（`'./clear/caches.js'`）。**注释里的路径不参与编译**，写错也不影响运行；但作者仍然照实际引用习惯写，方便你按图索骥。真实文件是 `caches.ts` 和 `conversation.ts`。

### 2.2 第 8 行逐字拆开

```ts
import type { Command } from '../../commands.js'
```

| 片段 | 念法 | 作用 |
| --- | --- | --- |
| `import type` | 「只导入类型」 | **编译后整行消失**，不产生运行时依赖 |
| `{ Command }` | 「要 `Command` 这一个」 | 具名导入，花括号里是名字 |
| `from` | 「来自」 | 固定搭配 |
| `'../../commands.js'` | 「上两级目录的 `commands.js`」 | 相对路径，`../` 一级、`../../` 两级 |

**为什么是 `import type`？** 因为 `Command` 只是个「形状说明书」，运行的时候根本不需要它。写成普通 `import`，编译器会以为你要真的加载那个模块，白白把 754 行的 `commands.ts` 拖进依赖图。批注版第 59 行专门点了这一句：「它保证这行在编译后完全消失，不产生任何运行时依赖」。

中文念法整句：「**从上面两级的 `commands.js` 里，只导入 `Command` 这个类型。**」

### 2.3 关键问题：为什么写 `.js` 而不是 `.ts`

因为 TypeScript 的 import 路径，写的是**编译之后的文件名**，不是**现在磁盘上的文件名**。

```
你写的代码              编译产物              运行时看到的世界
src/commands.ts   ──►   dist/commands.js  ──►  import '../../commands.js'
     ↑                                              ↑
  人读的源文件                                  路径指向这里
```

链条是这样的：源文件叫 `commands.ts` → 编译器把它编成 `commands.js`（扩展名变了、文件名不变）→ 编译后的 `index.js` 里那行 `import` **原样保留**（`import type` 会整行删掉，普通 import 会留下）→ 运行时 Node 只认 `commands.js` 这个名字。

所以如果源码写 `'../../commands'`（不带扩展名）或 `'../../commands.ts'`，编译后那行还是原样，**Node 找不到文件**。规则是：**源码里的路径，要为「未来的自己」写，而不是为「现在的磁盘」写。**

**证据一**：`package.json` 里 `"type": "module"`，全仓是 ES Module。ESM 在 Node 里解析相对路径时要求写全扩展名，不像老的 CommonJS 能自动补 `.js`。这条是 Node 的规则，不是 TypeScript 的偏好。

**证据三**：这份仓库的最终产物是单文件 `source/cli.js`（13,063,710 字节、16,667 行，我 `ls` 与 `wc` 过）。所有模块被打进这一个文件，所以磁盘上**一个 `commands.js` 都看不到**——`.js` 这个名字只在「编译/打包后的世界」里有效，而这个仓库没有把中间产物交给你。

**证据二**：仓库里**没有** `tsconfig.json`（我 `find` 过，`source/` 下只有 `package.json`），所以看不到 `moduleResolution` 的具体设置。能确认的只有两件事：`type: "module"`，以及全仓一致地写 `.js`。**这也说明「写 `.js`」在这个项目里已经是肌肉记忆，不是某个人一次性的选择。**

### 2.4 第 16 行：动态 `import()` 同样写 `.js`

```ts
// source/src/commands/clear/index.ts:16
  load: () => import('./clear.js'),
```

`import('./clear.js')` 和上面的 `import ... from` 长得不一样，但路径规则**完全相同**：它也是「加载编译后的 `clear.js`」。区别只在**时机**——顶层 import 在文件被加载时立刻执行；`import()` 是函数调用，只有真调到它才去读文件。

这里它被包在箭头函数 `() => ...` 里，所以启动时 `load` 只是一个「还没执行的函数」，`clear.js` 一次都没被读；用户敲 `/clear` 时代码调用 `load()`，这时才去读。这就是「惰性加载」。真正调用它的地方在 [`processSlashCommand.tsx` 第 609 行](../../source/src/utils/processUserInput/processSlashCommand.tsx#L609)：

```ts
// source/src/utils/processUserInput/processSlashCommand.tsx:609
            void command.load().then(mod => mod.call(onDone, {
```

念法：「调用 `command.load()` 拿到模块，等它到了再调 `mod.call(...)`。」前面的 `void` 表示「我知道它会返回 Promise，我不在这里等」。

### 2.5 教材 C：消费方也写 `.js`

`source/src/commands.ts` 是这个命令被登记进总表的地方。第 9 行（原文）：

```ts
// source/src/commands.ts:9
import clear from './commands/clear/index.js'
```

同样是「文件叫 `index.ts`、引用写 `index.js`」。**A 文件里的路径写 `.js`，B 文件引用 A 时也写 `.js`，全链一致。**

而这个文件本身有 754 行——它就是被 `import type` 省掉的那 754 行。第 8 行只导入一个类型，运行时不会把它拖进来；但 `commands.ts` 自己确实要被某个地方加载（比如主入口），只是不走 `clear/index.ts` 这条路。

### 2.6 搜索技巧：找文件搜 `.ts`，找引用搜 `.js`

| 你想知道 | 搜什么 | 例子 |
| --- | --- | --- |
| 这个文件在哪 | `.ts` / `.tsx` | `ls source/src/commands.ts` |
| 谁引用了它 | `.js` | `grep -rn "commands.js" source/src` |
| 这个目录下有什么 | 直接 `ls` | `ls source/src/commands/clear` |

**为什么搜引用要搜 `.js`**：引用处写的一定是 `.js`，搜 `commands.ts` 只会搜到文件自己。**为什么找文件要搜 `.ts`**：磁盘上只有 `.ts`，用 `.js` 去 `ls` 会得到 `No such file or directory`——那不是文件不存在，是你搜错了形态。

**口诀**：**找文件搜 `.ts`，找引用搜 `.js`。**

---

## 3. 三个问题

### 问题 1：如果写成 `'../../commands'`（不带后缀）行不行？

在这个仓库**不行**。

原因：全仓是 ES Module（`package.json` 里 `"type": "module"`）。Node 在 ESM 模式下解析相对路径时不会替你补扩展名——老 CommonJS 的 `require('./x')` 会自动尝试 `.js`、`.json`、`index.js`，ESM 不会。少写扩展名，运行时就抛 `ERR_MODULE_NOT_FOUND`。

补充：有些构建工具（webpack、Vite）能容忍省略扩展名，但「能不能跑」取决于运行环境，不取决于编辑器是否报错；这个仓库最终被 Bun 打包成单个 `cli.js`，打包器能处理很多情况，**源码却仍按最严格的 ESM 规则写**——作者不想让代码只在某个打包器下才成立。

结论：写全 `.js` 是「按最严的运行时要求写」，哪都能跑；省略是「赌工具链会帮我补」，换个环境就崩。

### 问题 2：为什么第 16 行 `import('./clear.js')` 也写 `.js`？

因为 `import()` 虽然长得像函数，**解析规则和顶层 `import` 完全一样**：它也是在「加载编译后的模块」，路径同样指向产物。写成 `'./clear.ts'` 的话，编译后那行还是 `'./clear.ts'`，运行时找不到。

它和顶层 import 只差两件事：

- **时机**：顶层在文件加载时执行；`import()` 在被调用时才执行（这里是敲 `/clear` 时）。
- **返回值**：`import()` 返回一个 `Promise`，所以后面能接 `.then(...)` 或 `await`。

路径规则不变，这正是最容易记混的地方：**看起来是函数调用，实际上还是模块引用。**

### 问题 3：在文件里搜索时，该搜 `.ts` 还是 `.js`？

看你要找什么：

- **找文件本身** → 搜 `.ts`（`ls`、`find`、资源管理器都行）。
- **找谁引用了它** → 搜 `.js`（引用处一律写 `.js`）。
- **找它的定义**（比如 `function extractTag`）→ 搜名字，不用管扩展名。

一个具体例子：想知道 `commands.ts` 被谁引用，`grep -rn "commands.js" source/src` 能搜到 `commands/clear/index.ts:8`；如果你搜 `commands.ts`，只会搜到文件自己（如果有注释提到它的话）。

**这条规则的价值**：0 基础读源码时最常卡在「这文件到底在哪」。记住「代码里的路径 ≠ 磁盘上的文件名」，就不会在 `ls` 失败时怀疑仓库缺文件。

---

## 4. 常见误读

**误读 1：以为 `.js` 是笔误，想「修正」成 `.ts`。** 改完 TypeScript 编译能过（它能解析 `.ts`），但**编译产物里的路径不会跟着改**，运行时就找不到文件。这是最典型的「改完本地能跑、打包就炸」。

**误读 2：以为 `import('./clear.js')` 会立刻加载文件。** 它被包在 `() => ...` 里，只有调用 `load()` 那一刻才执行。启动时不加载，正是这个文件只有 19 行的原因。

**误读 3：以为磁盘上应该有一个 `commands.js`。** 没有，也不需要——那个名字只在「编译后的世界」里存在。这个仓库连 `tsconfig.json` 都没发布，你能看到的只有 `.ts` 源文件和打包好的 `cli.js`。

---

## 5. 动手验证

下面是**实际跑出来的输出**，可以逐字对照。

```bash
ls source/src/commands.js
ls source/src/commands.ts
```

```
ls: cannot access 'source/src/commands.js': No such file or directory
source/src/commands.ts
```

第一行报错不是仓库坏了，而是**「代码里写的名字」在磁盘上不存在**——这正是本课时的全部内容。

```bash
grep -n "commands.js" source/src/commands/clear/index.ts
grep -n "commands/clear/index.js" source/src/commands.ts
```

```
8:import type { Command } from '../../commands.js'
9:import clear from './commands/clear/index.js'
```

两行证明：写代码的一方写 `.js`，引用它的一方也写 `.js`，全链一致。

```bash
grep -c "\.js'" source/src/commands.ts
ls source/src/commands/clear
wc -l source/src/commands.ts
```

```
125
caches.ts
clear.ts
conversation.ts
index.ts
754 source/src/commands.ts
```

`125` 是 `commands.ts` 里以 `.js` 结尾的 import 数量；目录里 4 个文件**全是 `.ts`**，没有一个 `.js`；最后一行是 `commands.ts` 的总行数。

---

## 6. 合书自测

**1.** 用自己的话解释：为什么代码里写 `.js`，磁盘上却是 `.ts`？

<details><summary>参考答案</summary>
因为 import 路径指向的是**编译产物**，不是源文件。`commands.ts` 编译后叫 `commands.js`，运行时 Node 读的是编译产物，所以路径必须写成 `.js`；写成 `.ts` 的话，编译后那行不会自动改，运行时就找不到文件。
</details>

**2.** `import type { Command }` 和 `import { Command }` 编译后有什么区别？

<details><summary>参考答案</summary>
`import type` 整行消失，不产生运行时依赖；普通 `import` 会保留，运行时会真的去加载那个模块。这里只用一个类型，所以用 `import type`，避免把 754 行的 `commands.ts` 拖进依赖图。
</details>

**3.** 第 16 行 `load: () => import('./clear.js')` 里的 `import()` 什么时候执行？

<details><summary>参考答案</summary>
只有调用 `load()` 的时候。它被包在箭头函数里，启动时只是一个未执行的函数对象；用户敲 `/clear` 后，`processSlashCommand.tsx:609` 调 `command.load()`，那一刻才去读 `clear.js`。这叫惰性加载。
</details>

**4.** 想找「谁引用了 `commands.ts`」，该 grep 什么？

<details><summary>参考答案</summary>
搜 `commands.js`。因为引用处一律写 `.js`，搜 `.ts` 只会命中文件自己。口诀：找文件搜 `.ts`，找引用搜 `.js`。
</details>

**5.** 如果把第 8 行改成 `'../../commands'`（不带扩展名），会发生什么？

<details><summary>参考答案</summary>
编译能过（TypeScript 会自己找），但产物里的路径还是 `'../../commands'`。运行时是 ESM，Node 不会自动补扩展名，于是抛 `ERR_MODULE_NOT_FOUND`。这类错误的特点是「编辑器不报、打包不报、跑起来才炸」。
</details>

---

## 7. 下一步：L0 结束了

到这里 L0 的五个符号/语法单元全部读完。往下走之前，先做一次总检查：

- **L0 过关标准与 L1 层入口**：[`docs/00-零基础学习路线.md`](../00-零基础学习路线.md) 的「L0 过关标准」一节，五道题全对再进 L1。L1 是「单文件解剖」，从 2 行的文件开始，专门建立「一个文件我真的能读完」的信心。
- **回看讲义**：本课时对应 [`00a-TypeScript地基.md` §1.5](../00a-TypeScript地基.md)（为什么 import 写 `.js`）与 [§4.2 动态导入](../00a-TypeScript地基.md)（`import()` 是函数）。
- **上一课时**：[L0-10 · `class` 与 `private`](L0-10-class与private.md)。
