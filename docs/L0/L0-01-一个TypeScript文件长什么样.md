# L0-01 · 一个 TypeScript 文件长什么样

> 这一课只读 **19 行**。目标是合上书之后，你能对任何一个陌生的 `.ts` 文件，先说出「哪几行是注释、哪几行是导入、哪几行是定义、哪几行是导出」。

| 项目 | 内容 |
| --- | --- |
| 课时号 | L0-01（L0 层第 1 课，共 11 课） |
| ⏱ 时长 | 15 分钟（精读 10 分钟 + 自测 5 分钟） |
| 前置课时 | 无，L0 层起点 |
| 教材 | [`annotated/src/commands/clear/index.ts`](../../annotated/src/commands/clear/index.ts)（批注版 132 行）<br>[`source/src/commands/clear/index.ts`](../../source/src/commands/clear/index.ts)（原文 19 行） |
| 配套讲义 | [`../00a-TypeScript地基.md`](../00a-TypeScript地基.md) §1.1–§1.5 |
| 路线图卡片 | [`../00-零基础学习路线.md`](../00-零基础学习路线.md) 的「L0-1」一节 |

**摘录约定**：代码块里 `│` 左边是**原文行号**，右边是**原文逐字内容**（含空格、含原注释）。`│` 是我加的边栏，不属于代码。行号一律以 `source/` 里的 19 行原文为准；引用批注版时会写明「批注版第 N 行」，因为批注版把中文插在英文之间，是另一套行号。

---

## 1. 先把教材摆出来

这个文件是斜杠命令 `/clear` 的「门牌」——用户敲 `/clear` 时，程序先看到这 19 行，真正的清理动作在别的文件里。

原文 19 行，按结构切成四段：

| 段 | 行号 | 是什么 | 编译后还在吗 |
| --- | --- | --- | --- |
| ① 文件说明 | 1–7 | `/** ... */` 块注释 | 不在（注释全被删） |
| ② 导入 | 8 | `import type { Command }` | 不在（`import type` 整行消失，见 L0-02） |
| ③ 定义 | 10–17 | 对象字面量 + `satisfies Command` | 在（变成真的对象） |
| ④ 导出 | 19 | `export default clear` | 在（被改写成 ESM 导出表） |

第 9 行、第 18 行是空行。**空行不算段**，它只是把四段隔开，让眼睛能停顿。这个顺序（注释 → 导入 → 定义 → 导出）在本仓库绝大多数文件里成立，先把骨架记住。

---

## 2. 精读正文

### 2.1 第 1–7 行：文件说明

```ts
1 │ /**
2 │  * Clear command - minimal metadata only.
3 │  * Implementation is lazy-loaded from clear.ts to reduce startup time.
4 │  * Utility functions:
5 │  * - clearSessionCaches: import from './clear/caches.js'
6 │  * - clearConversation: import from './clear/conversation.js'
7 │  */
```

- **第 1 行 `/**`**：JSDoc 块注释的开头。它和普通块注释 `/*` 只差一个星号，但这一个星号决定编辑器会不会把它当成「这个文件的文档」展示。
- **第 2 行**：一句话定位——「clear 命令，**只放最精简的元信息**」。`metadata` 就是「描述自己的数据」，不是业务数据。
- **第 3 行**：`lazy-loaded` 懒加载，`to reduce startup time` 为了缩短启动时间。这半句解释了「为什么这个文件这么短」——不是没写完，是故意的。
- **第 4 行**：`Utility functions:` 是个小标题，说「下面两行是工具函数清单」。
- **第 5–6 行**：两条「函数名: 从哪里导入」。作用是**导读**：想看真正干活的代码，去这两个文件。
- **第 7 行 `*/`**：块注释收尾。`/**` 和 `*/` 必须成对，少一个，下面所有代码都会被吞进注释，编译器报「文件意外结束」。

**中文念法**：「这是一段写给**人**看的说明书：本文件只放元信息，实现放在 `clear.ts` 里懒加载，两个工具函数分别在 `caches.js` 和 `conversation.js` 里。」

这里有个坑：**第 5 行的 `./clear/caches.js` 是错的**。本文件在 `commands/clear/` 下，`./clear/caches.js` 会被解析成 `commands/clear/clear/caches.js`，那里什么都没有。真实文件是 `commands/clear/caches.ts`。批注版第 53–56 行点了这件事：

```ts
53 │ // 注：这段注释本身就是一份「目录导读」。注意它写的是 `./clear/caches.js`，
54 │ //     从本文件（commands/clear/）出发，这个路径其实是 commands/clear/clear/caches.js ——
55 │ //     看着像笔误，但它只是给人看的说明文字，不参与编译，所以不影响运行。
56 │ //     真实路径是 commands/clear/caches.ts 和 commands/clear/conversation.ts。
```

要学的是判断方法：注释里的路径**不参与编译**，写错了程序照跑。看到注释里的路径，别当事实，用 `ls` 去磁盘上核——这也是本课「动手验证」的一环。

### 2.2 第 8 行：唯一的导入

```ts
8 │ import type { Command } from '../../commands.js'
```

**逐段念**：「从 `../../commands.js` 这个模块里，只导入一个叫 `Command` 的**类型**。」

- `import` —— 导入关键字。
- `type` —— 只导入类型，编译后整行消失（L0-02 专讲）。
- `{ Command }` —— 花括号是**具名导入**，名字必须和对方导出的名字一模一样。
- `'../../commands.js'` —— `../` 一次上一级，两次上两级：`commands/clear/` → `commands/` → `src/`，指向 `source/src/commands.ts`（实测 754 行）。
- 结尾 `.js` 而不是 `.ts` —— TypeScript ESM 的硬规定，问题 2 详讲。

**为什么只导入一个类型就够**：因为第 17 行只用 `Command` 做一次「形状检查」，没拿它做任何实际动作。

### 2.3 第 9–17 行：定义

```ts
 9 │
10 │ const clear = {
11 │   type: 'local',
12 │   name: 'clear',
13 │   description: 'Clear conversation history and free up context',
14 │   aliases: ['reset', 'new'],
15 │   supportsNonInteractive: false, // Should just create a new session
16 │   load: () => import('./clear.js'),
17 │ } satisfies Command
```

- **第 9 行空行**：分隔「导入区」和「定义区」。不是装饰，是排版约定，本仓库到处这么干。
- **第 10 行**：`const` 声明一个**不能重新赋值**的变量 `clear`，值是 `{` 开头的对象。这个 `{` 到第 17 行的 `}` 合起来才是一个完整的**对象字面量**（L0-04 专讲）。念法：「声明一个常量 `clear`，值是对象，内容从下一行开始。」

六个字段读法统一：**`字段名: 值,`**，逗号分隔，最后一个后面也允许有逗号（第 16 行就有）。

- **第 11 行**：`type: 'local'` —— 这个命令的类别是「本地命令」：本地函数执行、返回文本，不发给模型。字符串用单引号，本仓库统一。
- **第 12–13 行**：`name: 'clear'` 是命令名，用户敲 `/clear` 匹配的就是它；`description` 是一句英文说明，直接显示在补全列表里。**这条是给用户看的**，不是给程序看的。
- **第 14 行**：`aliases: ['reset', 'new']` —— 方括号是数组，所以 `/reset`、`/new`、`/clear` 是同一个命令的三个名字。
- **第 15 行**：`supportsNonInteractive: false` —— 布尔值 `false`；行尾 `// Should just create a new session` 是**行注释**，只解释这一行。整行意思：管道/脚本模式下不提供这条命令，因为那个模式没有「会话」可清。
- **第 16 行**：`load` 的值是**函数**，不是字符串。`() =>` 是箭头函数（收零个参数），函数体 `import('./clear.js')` 是**动态导入**——只有真的调用这个函数时才去加载 `clear.js`。
- **第 17 行**：`}` 收掉第 10 行的对象；`satisfies Command` 意思是「**按 `Command` 的规矩检查这个对象，但别改变它自己的类型**」，L0-04 整课讲它，此刻只需记住它在**编译期**工作，运行时什么都不做。本仓库不写分号。

第 14、16 行都有括号但含义不同：`['reset', 'new']` 是**数组**，`() => ...` 是**函数**。看括号前面是什么就能分清。

### 2.4 第 18–19 行：导出

```ts
18 │
19 │ export default clear
```

第 19 行把第 10 行定义的 `clear` 对象作为本模块的**默认导出**交出去；`clear` 只是**引用**，不是新建。谁接住它？`source/src/commands.ts` 第 9 行：

```ts
9 │ import clear from './commands/clear/index.js'
```

于是一条完整链路成立：**定义（10）→ 导出（19）→ 被命令总表导入（commands.ts:9）→ 用户敲 `/clear` 时查到 → 调用 `load()` → 加载 `clear.js` 真正执行**。

---

## 3. 三个问题（完整解答）

### 问题 1：第 1–7 行的 `/** ... */` 和后面 `//` 开头的注释，有什么区别？

两者都是注释，编译器都当它们不存在，区别在**给谁看、能被什么工具读**。

| | 第 1–7 行 `/** ... */` | 第 15 行 `// ...` |
| --- | --- | --- |
| 名字 | JSDoc 块注释 | 行注释 |
| 范围 | 多行，到 `*/` 为止 | 只到本行行尾 |
| 位置 | 通常在**声明上方**，描述「下面这个是什么」 | 通常在语句末尾或上方，解释「这一行为什么这么写」 |
| 工具读不读 | 会。编辑器悬停、文档生成器都能抽出来 | 不会，纯人读 |
| 本文件作用 | 说明书 + 目录导读 | 解释 `supportsNonInteractive: false` 的原因 |

一句话：**`/**` 是「这个文件的档案」，`//` 是「这一行的旁批」**。

### 问题 2：第 8 行结尾为什么写 `'../../commands.js'`，而不是 `'../../commands.ts'`？

因为 TypeScript 最终编译成 JavaScript，**编译产物的文件名真的是 `commands.js`**。导入路径写给「编译后的程序」看，不是写给磁盘上的源码看。三条理由叠在一起：

1. **编译后磁盘上只有 `.js`**：`commands.ts` 编译成 `commands.js`，运行时找的是后者。
2. **ESM 规定路径要带扩展名**：`package.json` 里 `"type": "module"`，全仓都是 ESM，运行时的解析器不会帮你补扩展名。
3. **TS 的解析规则允许 `.js` 指向 `.ts`**：你写 `./x.js`，TypeScript 知道「它编译后叫 `x.js`，现在去找同名的 `x.ts`」。

**记忆口诀（讲义 §1.5）**：**找文件搜 `.ts`，找引用搜 `.js`。** 验证：`ls source/src/commands.ts` 有，`ls source/src/commands.js` 没有——代码里写的却是 `.js`，因为两者说的不是同一个时间点。

### 问题 3：第 19 行 `export default clear` 里的 `clear` 是从哪来的？

来自**同一个文件第 10 行的 `const clear = { ... }`**。这 19 行里 `clear` 只出现两次：第 10 行**诞生**（声明 + 赋值），第 19 行**出门**（把同一个东西交出去）；11–17 行是给这个对象填内容。

所以导出的不是「一个叫 clear 的文件」，而是「第 10 行那个对象本身」。顺带澄清：`export default` 后面跟的是**一个值**（这里是变量名），不是名字；写成 `export default { type: 'local', ... }` 也合法，只是那样就不需要第 10 行的 `clear` 了。这里先起名字，是因为对象跨 8 行书写，起了名字更好读。

---

## 4. 常见误读

**误读 1：以为这 19 行里有清理对话的逻辑。**
没有。全文没有一次「删除」「清空」的动作，只有一个对象。真正的清理在 `clear.ts`（7 行）→ `conversation.ts`（251 行）。判断依据：`clearConversation` 在这个文件里只在**注释**（第 6 行）出现过，代码里没有。

**误读 2：以为第 16 行的 `import('./clear.js')` 在启动时就执行了。**
它写在箭头函数的**函数体**里，函数不调用，函数体就不执行。启动时它只是一个「还没被调用过的函数对象」——所以第 3 行才敢写 `to reduce startup time`。

**误读 3：把注释里的路径当成真实路径。**
第 5 行 `'./clear/caches.js'` 是错的（真实是 `commands/clear/caches.ts`）。注释不参与编译，写错不报错，所以它逃过了检查。**读注释要带一点怀疑，用 `ls` 核。**

---

## 5. 动手验证

在仓库根目录（`D:\CC泄露源码分析`）跑：

```bash
grep -n "^import\|^export\|^const" source/src/commands/clear/index.ts
```

**我实际跑出来的输出**：

```
8:import type { Command } from '../../commands.js'
10:const clear = {
19:export default clear
```

看这三点：

1. 只出来 **3 行**：`^` 表示行首，注释行（`/**`、` * ...`）和缩进的字段行（`  type: 'local',`）都匹配不到——这个命令正好把四段结构的三个起点揪了出来。
2. 第 8、10、19 行，刚好是「导入 / 定义 / 导出」的开头；注释段 1–7 不在其中，因为它不是代码。
3. 空行 9、18 也不出现。

再确认两件事：

```bash
wc -l source/src/commands/clear/index.ts
ls source/src/commands.ts source/src/commands/clear/caches.ts
```

**实际输出**：

```
19 source/src/commands/clear/index.ts
source/src/commands.ts
source/src/commands/clear/caches.ts
```

19 行，和卡片上的「📄 19 行」对得上（`wc -l` 数的是换行符，末行有换行就算一行）；`commands.ts` 真实存在，说明第 8 行的 `../../commands.js` 翻译成磁盘路径是对的（`commands/clear/` 上两级 = `src/`）；`caches.ts` 也真实存在，反证第 5 行注释写的路径是错的。

---

## 6. 合书自测

**1. 不看文件，说出这 19 行分成哪四段、每段几行。**

<details>
<summary>参考答案</summary>

① 文件说明 1–7（JSDoc 块注释）；② 导入 8；③ 定义 10–17；④ 导出 19。第 9、18 行是空行。

</details>

**2. 删掉第 17 行的 `satisfies Command`，程序还能跑吗？**

<details>
<summary>参考答案</summary>

能跑。`satisfies` 只做编译期检查，运行时不产生任何代码。删掉后行为不变，代价是「字段名写错、少写必填字段」这类错误不再被编译器拦住。

</details>

**3. 第 13 行的 `description` 是给谁看的？第 11 行的 `type` 呢？**

<details>
<summary>参考答案</summary>

`description` 给**用户**看（补全列表里的说明文字）；`type` 给**程序**看（决定谁来执行：`local` 表示本地函数执行并返回文本）。

</details>

**4. 用户敲 `/clear` 之后，第一件被执行的、属于本文件的东西是什么？**

<details>
<summary>参考答案</summary>

第 16 行 `load` 字段指向的那个函数 `() => import('./clear.js')`。命令总表拿到对象后调用 `load()`，这时才去加载 `clear.js`。

</details>

**5. 把第 10 行的 `const` 改成 `let`，能通过编译吗？**

<details>
<summary>参考答案</summary>

语法上能（`let` 允许重新赋值），但没有理由这么做：这个对象从头到尾没被重新赋值，`const` 是本仓库的默认选择。

</details>

---

## 7. 下一课时

→ [`./L0-02-import的两种面孔.md`](./L0-02-import的两种面孔.md)：把第 8 行单独拎出来，讲清 `import type` 和普通 `import` 在编译后的两种命运。

**卡住回看**：

- 四段结构、注释的区别 → [`../00a-TypeScript地基.md`](../00a-TypeScript地基.md) §1.1–§1.3
- `.js` 后缀 → [`../00a-TypeScript地基.md`](../00a-TypeScript地基.md) §1.5
- 想先看项目整体地图 → [`../01-项目总览与架构.md`](../01-项目总览与架构.md)
