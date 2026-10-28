# L0-03 · `export` 的两种面孔（默认 vs 具名）

> 上一课讲「怎么拿」。这一课讲「怎么给」，并且回答一个 0 基础最容易困惑的问题：**一个只有 2 行的文件，为什么值得单独存在？**

| 项目 | 内容 |
| --- | --- |
| 课时号 | L0-03（L0 层第 3 课，共 11 课） |
| ⏱ 时长 | 15 分钟 |
| 前置课时 | [`./L0-02-import的两种面孔.md`](./L0-02-import的两种面孔.md) |
| 教材 | [`annotated/src/commands/clear/index.ts`](../../annotated/src/commands/clear/index.ts) 第 19 行<br>[`annotated/src/tools/BashTool/toolName.ts`](../../annotated/src/tools/BashTool/toolName.ts) 全 2 行（批注版 3 行）<br>原文对照：[`source/src/tools/BashTool/toolName.ts`](../../source/src/tools/BashTool/toolName.ts) |
| 配套讲义 | [`../00a-TypeScript地基.md`](../00a-TypeScript地基.md) §4.3（循环依赖）、§6 术语表 |
| 路线图卡片 | [`../00-零基础学习路线.md`](../00-零基础学习路线.md) 的「L0-3」一节 |

**摘录约定**：`│` 左边是原文行号，右边是原文逐字内容。

---

## 1. 两段教材摆在一起

```ts
index.ts:19    │ export default clear

toolName.ts:1  │ // Here to break circular dependency from prompt.ts
toolName.ts:2  │ export const BASH_TOOL_NAME = 'Bash'
```

两行导出，两种语法，去掉了截然不同的两条路：

| | `export default clear` | `export const BASH_TOOL_NAME = 'Bash'` |
| --- | --- | --- |
| 名字 | **默认导出**，一个文件只能有一个 | **具名导出**，一个文件可以有任意多个 |
| 导入方怎么写 | `import 随便起个名 from '...'` | `import { BASH_TOOL_NAME } from '...'`（名字必须对上） |
| 名字由谁定 | **导入方** | **导出方** |
| 适合什么 | 一个文件只有「一个主体」 | 一个文件有一组并列的东西 |

## 2. 精读正文

### 2.1 `index.ts` 第 19 行：默认导出

```ts
19 │ export default clear
```

三个词：

- **`export`** —— 把这个东西交给模块系统，允许别人导入。
- **`default`** —— 声明「这是本文件的**唯一主输出**」。一个文件最多一个 `default`，写两个直接报错。
- **`clear`** —— 一个**已经存在的变量名**，来自本文件第 10 行的 `const clear = {`。这里是引用，不是新建。

**中文念法**：

> 「把本文件里那个 `clear` 对象，作为本模块的主输出交出去；谁想用，谁自己起名字接。」

**「谁自己起名字」的证据**：接收方在 `source/src/commands.ts` 第 9 行：

```ts
9 │ import clear from './commands/clear/index.js'
```

这里写 `clear` 只是**因为习惯**。写成 `import qingkong from './commands/clear/index.js'` 一样合法——默认导出不带名字，导入方有完全的命名权。本仓库的惯例是两边同名（`export default clear` 对 `import clear`），但那是纪律，不是语法。

### 2.2 `toolName.ts` 第 1–2 行：具名导出

```ts
1 │ // Here to break circular dependency from prompt.ts
2 │ export const BASH_TOOL_NAME = 'Bash'
```

- **第 1 行**：行注释，一句话说明这个文件存在的**唯一理由**——`break circular dependency`（打断循环依赖），`from prompt.ts`（来源是 `prompt.ts` 这个文件）。
- **第 2 行**：`export const BASH_TOOL_NAME = 'Bash'`
  - `export` —— 交出去。
  - `const` —— 常量，不能再重新赋值。
  - `BASH_TOOL_NAME` —— **导出名**。这个名字是「契约」，导入方必须一字不差地写它。
  - `= 'Bash'` —— 值是一个字符串 `'Bash'`，也就是这个工具在界面和权限规则里显示的名字。

**中文念法**：

> 「导出一个常量 `BASH_TOOL_NAME`，值是字符串 `'Bash'`；想用它的文件必须按 `BASH_TOOL_NAME` 这个名字来取。」

导入方的写法（`source/src/tools/BashTool/prompt.ts` 第 25 行，实测）：

```ts
25 │ import { BASH_TOOL_NAME } from './toolName.js'
```

花括号 + 完全相同的名字。这里没有命名自由——除非你主动改名：`import { BASH_TOOL_NAME as NAME } from './toolName.js'` 是允许的（`as` 起别名），但那只是**本地改名**，契约名仍然是 `BASH_TOOL_NAME`。

### 2.3 一个文件可以同时有两种导出

`source/src/commands/review.ts` 最后两行（实测）：

```ts
56 │ export default review
57 │ export { ultrareview }
```

对应 `source/src/commands.ts` 第 40 行：

```ts
40 │ import review, { ultrareview } from './commands/review.js'
```

**念法**：「从 `review.js` 里拿两样：主输出叫 `review`（默认导出），另外还有一个具名的 `ultrareview`。」

这条要记住的是**组合写法**：`import 默认名, { 具名1, 具名2 } from '...'`——逗号左边是默认导出，花括号里是具名导出。默认导出最多一个，具名导出可以有任意多个，所以顺序永远是「先默认，后具名」。

### 2.4 为什么 2 行要单独成文件：把死结剪成直线

`BASH_TOOL_NAME` 只是一个字符串常量。直觉上它该住在「Bash 工具」的定义文件 `BashTool.tsx` 里。但它住在了一个 2 行的独立文件里，原因就写在第 1 行注释里。

真实依赖链（两处都有实测出处）：

- `source/src/tools/BashTool/BashTool.tsx` 第 45 行：`import { getDefaultTimeoutMs, getMaxTimeoutMs, getSimplePrompt } from './prompt.js'` —— **BashTool → prompt**
- `source/src/tools/BashTool/prompt.ts` 第 25 行：`import { BASH_TOOL_NAME } from './toolName.js'` —— **prompt → toolName**

现状是一条直线，没有回头路：

```
BashTool.tsx ──▶ prompt.ts ──▶ toolName.ts
                                    ▲
                            常量住在这里（末端，谁都不依赖）
```

假如把常量写回 `BashTool.tsx`，`prompt.ts` 就不得不导入 `BashTool.tsx`，于是：

```
BashTool.tsx ──▶ prompt.ts
      ▲              │
      └──────────────┘        ← 谁先加载？死结
```

这就是**循环依赖**：A 要 B 的东西，B 又要 A 的东西，模块加载器转一圈回到原点。轻则拿到 `undefined`（因为对方还没执行完），重则启动直接崩。

**破法（讲义 §4.3）**：把双方都要的东西提到第三个文件 C，让 A、B 都只依赖 C。这个文件在仓库里到处都是：

- `source/src/tools/FileEditTool/constants.ts`（11 行），第 1 行注释：`// In its own file to avoid circular dependencies`
- `source/src/tools/NotebookEditTool/constants.ts`，第 1 行是同一句话
- 本课的 `toolName.ts`（2 行）

**一条实用判断**：看到一个「小得莫名其妙」的文件，先看第一行注释。十有八九写着 `avoid circular dependencies` / `break circular dependency`。**它不是设计失误，是解耦的痕迹。**

顺带一个量级：`BASH_TOOL_NAME` 在 `source/src` 里出现 **100 次**（`grep -rn "BASH_TOOL_NAME" source/src | wc -l`，含 1 次定义，其余是导入和使用）。一个字符串被近百处共享，却放在一个 2 行文件里——正因为「共享者太多」，才更不能让它挂在某个会反向依赖的大文件上。

## 3. 三个问题（完整解答）

### 问题 1：一个文件能有几个 `export default`？

**一个，多了直接报错。** 语法上 `export default` 后面只能跟一个值/表达式，所以同一文件写两次，第二次就是重复声明默认导出，编译阶段就过不去。

要导出多个东西，用**具名导出**（`export const A = ...`、`export { B }`），数量不限。本仓库的典型分工：

- 命令的「门牌」文件（`commands/*/index.ts`）：只有 `export default`，因为这个文件只有一个主体。
- 常量/工具文件（`toolName.ts`、`constants.ts`）：全是具名导出，因为要按名字逐个取。
- 两者都要（`review.ts`）：一个 `export default` + 若干具名，共用一个文件。

### 问题 2：别人导入 `toolName.ts` 时，必须叫 `BASH_TOOL_NAME` 吗？

**必须。** 具名导出的绑定是**按名字**的：`import { BASH_TOOL_NAME }` 里的名字必须和导出名逐字相同（大小写、下划线都算）。写成 `BASH_TOOLNAME`、`bashToolName` 都会报「该模块没有导出这个成员」。

唯一的例外是主动起别名：`import { BASH_TOOL_NAME as NAME }`。这不是「随便改名」，而是「**我知道它叫 BASH_TOOL_NAME，但我在本地叫它 NAME**」——契约名没变，改的是本文件内的称呼。

对比默认导出：`import clear from ...` 里的 `clear` 是导入方自己起的，和导出方的变量名无关。

一句话记：**默认导出「谁接谁起名」，具名导出「谁给谁定名」。**

### 问题 3：`toolName.ts` 只有 2 行，为什么要单独成一个文件？

**为了打断循环依赖**——第 1 行注释原话是 `Here to break circular dependency from prompt.ts`。

拆开说：

1. `prompt.ts` 需要 `BASH_TOOL_NAME`（它要拼提示词，里面要写工具名）。
2. `BashTool.tsx` 需要 `prompt.ts` 的 `getSimplePrompt`、`getDefaultTimeoutMs` 等（第 45 行）。
3. 如果常量定义在 `BashTool.tsx`，那么 `prompt.ts` 就必须导入 `BashTool.tsx`，第 1、2 条就变成互相导入——死结。
4. 把常量搬到 `toolName.ts` 这个**谁都不依赖**的叶子文件，两条依赖都变成单向：`prompt.ts → toolName.ts`、`BashTool.tsx → toolName.ts`。

代价是一个 2 行文件；收益是**加载顺序不再有歧义**。这类「为了切断依赖而存在的小文件」，读代码时应该当成路标，而不是噪音。

## 4. 常见误读

**误读 1：以为 `export default clear` 导出的是「文件」或者「叫 clear 的模块」。**
导出的是**第 10 行那个对象本身**。名字 `clear` 甚至不会跟着走——导入方可以叫它任何名字。文件是文件，导出值是导出值。

**误读 2：以为具名导出不能被改名。**
能，但必须显式写 `as`：`import { BASH_TOOL_NAME as NAME }`。不写 `as` 就必须一模一样。两种情况的区别是「有没有明说」。

**误读 3：以为 2 行的 `toolName.ts` 是历史遗留，迟早会被合并回去。**
正好相反：它是一种**结构性修复**。合并回去，循环依赖就立刻回来了。同目录下 `FileEditTool/constants.ts`（11 行）、`NotebookEditTool/constants.ts` 用同一句话做第一行注释，说明这是全仓的固定套路。

## 5. 动手验证

```bash
grep -c "export default" source/src/commands/clear/index.ts
```

**我实际跑出来的输出**：

```
1
```

只有 1 个默认导出。全仓再验一次「一个文件只能有一个默认导出」（`source/src` 下共 1902 个文件）：

```bash
grep -rc "export default" source/src | grep ":2" | head
grep -rn "BASH_TOOL_NAME" source/src | wc -l
```

**实际输出**：第一行是空的（没有任何文件出现两次 `export default`），第二行是 `100`。

100 处引用。再看这个常量的「家」有多小：

```bash
wc -l source/src/tools/BashTool/toolName.ts
head -2 source/src/tools/BashTool/toolName.ts
```

**实际输出**：

```
2 source/src/tools/BashTool/toolName.ts
// Here to break circular dependency from prompt.ts
export const BASH_TOOL_NAME = 'Bash'
```

2 行，出现 100 次——这两个数字放在一起，就是「叶子文件」的典型形状：**极薄，但位于依赖图的最底层。**

## 6. 合书自测

**1. 说出「为什么一个 2 行的常量要单独成文件」。**

<details>
<summary>参考答案</summary>

为了打断循环依赖：`BashTool.tsx` 依赖 `prompt.ts`，`prompt.ts` 又需要工具名常量。常量若定义在 `BashTool.tsx`，两边就互相导入；提到独立的 `toolName.ts` 后，依赖变成两条单向边，加载顺序不再有歧义。

</details>

**2. `import { BASH_TOOL_NAME }` 里的名字能不能随便写？**

<details>
<summary>参考答案</summary>

不能。具名导出按名字绑定，必须逐字相同；想改本地称呼必须显式写 `as`。

</details>

**3. 一个文件里能同时有默认导出和具名导出吗？举一个本仓库的例子。**

<details>
<summary>参考答案</summary>

能。`source/src/commands/review.ts` 第 56–57 行：`export default review` 和 `export { ultrareview }`；导入方 `commands.ts:40` 写成 `import review, { ultrareview } from './commands/review.js'`。

</details>

**4. 把 `toolName.ts` 的两行合并进 `BashTool.tsx`，会发生什么？**

<details>
<summary>参考答案</summary>

`prompt.ts` 为了拿常量就得导入 `BashTool.tsx`，而 `BashTool.tsx` 第 45 行本来就导入 `prompt.ts`，于是形成循环依赖。可能表现为某个导入拿到 `undefined`，或启动时报错。

</details>

## 7. 下一课时

→ [`./L0-04-对象字面量与satisfies.md`](./L0-04-对象字面量与satisfies.md)：把第 10–17 行那个对象拆开，讲清 6 个字段各自给谁看，以及 `satisfies Command` 到底比 `: Command` 强在哪。

**卡住回看**：

- 循环依赖的成因与破法 → [`../00a-TypeScript地基.md`](../00a-TypeScript地基.md) §4.3
- 四种导入写法 → [`../00a-TypeScript地基.md`](../00a-TypeScript地基.md) §4.1
- `const` 与「不能重新赋值」 → [`../00a-TypeScript地基.md`](../00a-TypeScript地基.md) §2.1
