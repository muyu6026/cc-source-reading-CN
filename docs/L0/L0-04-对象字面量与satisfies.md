# L0-04 · 对象字面量与 `satisfies`

> 一个斜杠命令在代码里就是**一个对象**。这一课把它逐字段拆开：谁在写、谁在读、写给谁看；最后讲清 `satisfies Command` 与 `: Command` 的实质差别。

| 项目 | 内容 |
| --- | --- |
| 课时号 | L0-04（L0 层第 4 课，共 11 课） |
| ⏱ 时长 | 25 分钟 |
| 前置课时 | [`./L0-01-一个TypeScript文件长什么样.md`](./L0-01-一个TypeScript文件长什么样.md)、[`./L0-03-export的两种面孔.md`](./L0-03-export的两种面孔.md) |
| 教材 | [`annotated/src/commands/clear/index.ts`](../../annotated/src/commands/clear/index.ts) 第 10–17 行<br>类型出处：[`source/src/types/command.ts`](../../source/src/types/command.ts) 第 74–78、184、205 行 |
| 配套讲义 | [`../00a-TypeScript地基.md`](../00a-TypeScript地基.md) §2.4（satisfies）、§2.5（联合类型） |
| 路线图卡片 | [`../00-零基础学习路线.md`](../00-零基础学习路线.md) 的「L0-4」一节 |

**摘录约定**：`│` 左边是原文行号，右边是原文逐字内容。

---

## 1. 教材与六个字段的全景

```ts
10 │ const clear = {
11 │   type: 'local',
12 │   name: 'clear',
13 │   description: 'Clear conversation history and free up context',
14 │   aliases: ['reset', 'new'],
15 │   supportsNonInteractive: false, // Should just create a new session
16 │   load: () => import('./clear.js'),
17 │ } satisfies Command
```

这 8 行是**一个对象字面量**。6 个字段，谁消费它们，都能在仓库里指到具体行：

| 字段 | 值 | 谁在读它 | 实测出处 |
| --- | --- | --- | --- |
| `type` | `'local'` | 命令调度器、headless 过滤 | `main.tsx:2622` |
| `name` | `'clear'` | 补全列表、`/clear` 匹配 | `commands.ts:9` 的命令总表 |
| `description` | 一句英文 | 补全列表的说明文字 | 用户界面 |
| `aliases` | `['reset','new']` | 多入口匹配 | 命令解析 |
| `supportsNonInteractive` | `false` | headless（`-p`）过滤 | `main.tsx:2622` |
| `load` | 函数 | 执行命令前调用 | `processSlashCommand.tsx:668` |

## 2. 精读正文

### 2.1 第 10 行：什么叫「对象字面量」

```ts
10 │ const clear = {
```

**对象字面量**＝不借助任何类、不 `new`，直接在代码里把对象「写出来」。`{` 是开头，配对的 `}` 在第 17 行，中间每行一个 `键: 值,`。

**中文念法**：「声明一个常量 `clear`，它的值是一个对象；字段从下一行开始，一行一个。」

三个容易混的点：

- **`{` 有两种用途**：函数体 和 对象。这里在 `=` 右边，所以是**对象**；同样的括号出现在 `() => {` 后面就是函数体（讲义 §2.8 的坑）。
- **字段之间的逗号不能省**，只有最后一个可省；少了就是语法错误。
- **`const` 只锁「名字」**：`clear` 不能再指向别的对象，但 `clear.name = 'x'` 并不被禁止，本仓库靠约定不改。

### 2.2 第 11 行：`type: 'local'` 决定「谁来执行」

```ts
11 │   type: 'local',
```

斜杠命令一共三类：`'prompt'`（展开成文字发给模型）、`'local'`（本地函数执行、返回文本）、`'local-jsx'`（本地执行并渲染 Ink 界面，例：`context/index.ts:8`）。本文件选 `'local'`。

选了它，就必须满足 `LocalCommand`（`source/src/types/command.ts` 第 74–78 行，逐字）：

```ts
74 │ type LocalCommand = {
75 │   type: 'local'
76 │   supportsNonInteractive: boolean
77 │   load: () => Promise<LocalCommandModule>
78 │ }
```

这张小表解释了两件事：为什么第 15 行必须写 `supportsNonInteractive`、第 16 行必须写 `load`——它们不是装饰，是 `type: 'local'` 带来的**义务**。

### 2.3 第 12–14 行：给用户的名字、说明与别名

```ts
12 │   name: 'clear',
13 │   description: 'Clear conversation history and free up context',
14 │   aliases: ['reset', 'new'],
```

- **第 12 行**：命令名。用户敲 `/clear` 时，程序拿输入和它比对。
- **第 13 行**：说明文字，直接显示在补全列表 `/clear` 后面。**这是产品文案，不是逻辑**——改它不改变行为，只改变用户看到的话。
- **第 14 行**：方括号是**数组字面量**，所以 `/reset`、`/new`、`/clear` 是同一个命令的三个入口。

**判断「字段给谁看」的通用方法**：改这个值，谁会感觉到？改 `description` → 只有用户；改 `type` → 程序行为变了。

`aliases` 在 `CommandBase` 里是**可选**的（`aliases?: string[]`，`types/command.ts:184`），不写也能过检查。别名里的 `new` 透露了设计意图：`/clear` 的语义是「**开一个新会话**」，不是「删掉已有东西」——第 15 行的行注释说的正是这件事。

### 2.4 第 15 行：一个 `false` 决定它在管道模式下是否存在

```ts
15 │   supportsNonInteractive: false, // Should just create a new session
```

`supportsNonInteractive` 直译「支持非交互」，`false` 就是**不支持**。非交互模式指 `claude -p "问题"` 那种跑完就退出的模式（headless）。它在哪里被读？`source/src/main.tsx` 第 2622 行，逐字：

```ts
2622 │ const commandsHeadless = disableSlashCommands ? [] : commands.filter(command => command.type === 'prompt' && !command.disableNonInteractive || command.type === 'local' && command.supportsNonInteractive);
```

**念法**：「headless 模式下把命令过滤一遍，只留两类：`prompt` 里没被显式禁用的，和 `local` 里 `supportsNonInteractive` 为真的。」我们这个对象 `type` 是 `'local'`、`supportsNonInteractive` 是 `false`——两条都不满足，所以 **`-p` 模式下它根本不在命令表里**，敲了也匹配不到。这正是行注释的意思：一次性执行没有「会话」可清，想要干净上下文就换个新进程。

### 2.5 第 16 行：`load` 的值为什么是函数

```ts
16 │   load: () => import('./clear.js'),
```

`()` 收零个参数，`=>` 是箭头函数，`import('./clear.js')` 是**动态导入**（一次函数调用，返回 `Promise`）。所以 `load` 的类型是 `() => Promise<LocalCommandModule>`——「调用后才去加载」的函数。

**谁调用它**：`source/src/utils/processUserInput/processSlashCommand.tsx` 第 668 行，逐字：

```ts
668 │ const mod = await command.load();
```

`await` 说明它等 `Promise`；下一行 `const result = await mod.call(args, context);` 才真正执行命令。

**如果 `load` 写成字符串**：类型检查立刻不过（`LocalCommand` 要求函数）；就算绕过，字符串也表达不了「什么时候加载」，只能立刻加载，懒加载就没了。**写成函数，等于把「加载时机」的控制权交给调用方。**

### 2.6 第 17 行：`satisfies Command` 做了什么

```ts
17 │ } satisfies Command
```

`Command` 的定义（`types/command.ts` 第 205–206 行，逐字）：

```ts
205 │ export type Command = CommandBase &
206 │   (PromptCommand | LocalCommand | LocalJSXCommand)
```

**念法**：「`Command` ＝所有命令共有的基础字段，**并且**是三种命令之一。」`&` 读「并且」，`|` 读「或」。

`satisfies` 做的事：**拿 `Command` 这把尺子量这个对象，量不过就报错；量过了，对象的类型保持原样，不被改宽。** 中文念法（讲义 §2.4 原话）：

> 「按 `Command` 的规矩检查我，但**别把我的类型改宽**。」

仓库里另一种写法见于 `source/src/commands/context/index.ts` 第 4 行 `export const context: Command = {`。两者差别只有一处，后果不小：

| | `... } satisfies Command` | `const x: Command = {...}` |
| --- | --- | --- |
| 检查字段对不对 | ✅ | ✅ |
| `type` 的类型 | 精确的 `'local'` | `'prompt' \| 'local' \| 'local-jsx'` |
| `name` 的类型 | 精确的 `'clear'` | `string` |
| 能不能直接读 `.supportsNonInteractive` | 能 | **不能**，`Command` 上没有这个字段，得先按 `type` 收窄 |

第三条最关键：`supportsNonInteractive` 只存在于 `LocalCommand`（第 76 行），`CommandBase` 和 `PromptCommand` 都没有。用 `: Command` 标注后，编译器只知道「它是三种之一」，不会替你认定是哪一种。

**为什么作者偏爱 `satisfies`**：写元信息时你**知道**自己写的是 `local`，也**希望**编译器记住这个事实。全仓实测：`satisfies Command` 出现在 **74 个文件**，`: Command = {` 出现在 **10 个文件**。

## 3. 三个问题（完整解答）

### 问题 1：`load` 的值是**函数**而不是字符串，为什么？

因为 `load` 的职责不是「记住路径」，而是「**决定什么时候去加载**」。

- 写成 `() => import('./clear.js')`：文件被导入时只创建了一个函数对象，`import()` 并未执行。等用户真的敲 `/clear`，`processSlashCommand.tsx:668` 才 `await command.load()`，那一刻才去读 `clear.js`。这就是 `index.ts` 第 3 行说的 `lazy-loaded`——启动时只解析 19 行元信息，不解析 251 行的 `conversation.ts`。
- 写成字符串：类型对不上（`LocalCommand.load` 必须是函数），而且「什么时候加载」变成框架的默认行为，调用方失去控制权。

### 问题 2：`} satisfies Command` 换成 `}: Command` 会有什么不同？

**检查一样，类型不一样。**

- 两者都会检查字段名对不对、必填字段少没少、值是否符合类型。所以把 `'local'` 写成 `'Local'`，两种写法都在编译期报错。
- 差别在**推断出的类型**：`satisfies` 保留字面量（`clear.type` 精确为 `'local'`、`clear.name` 精确为 `'clear'`）；`: Command` 把对象拓宽成 `Command` 联合（`type` 三选一、`name` 退化成 `string`），想读 `clear.supportsNonInteractive` 还得先按 `type` 收窄。

**收益方向**：`satisfies` 让你「既被检查、又保留精确信息」，代价是打字多一点。74 : 10 的比例说明作者认为划算。

### 问题 3：把 `type: 'local'` 改成 `'Local'` 会怎样？

**编译期就报错，运行不到。**

原因：`Command` 里 `local` 那一支的类型是**字符串字面量** `'local'`（`types/command.ts:75`），不是 `string`。字面量类型只接受完全相同的字符串，`'Local'` 大小写不同就是另一个值。报错大意是「`'Local'` 不能赋给 `'local' | 'prompt' | 'local-jsx'`，也不满足 `LocalCommand`」。

这正是用字面量而不用 `string` 的价值：**拼写错误在编译期暴露，而不是等用户敲 `/clear` 才发现命令没被识别。**

## 4. 常见误读

**误读 1：以为 `satisfies` 会给对象「加上」类型。**
不是加，是**校验**。它不改变对象类型，只在你写错时喊停，运行时完全不产生代码。把它当「质检员」，不是「模具」。

**误读 2：以为 6 个字段都是必填的。**
`CommandBase`（`types/command.ts:175` 起）里大量字段带 `?`：`availability?`、`isEnabled?`、`isHidden?`、`aliases?`。本文件写 `aliases` 是因为这个命令**需要**别名。真正必填的只有 `type`、`name`、`description`，外加 `local` 这一支的 `supportsNonInteractive`、`load`。

**误读 3：以为第 16 行的 `import('./clear.js')` 是静态导入的另一种写法。**
`import x from '...'` 在文件加载时执行；`import('...')` 是**函数调用**，只有被调用时才发生，返回 `Promise`。两者长得像，时机差一个量级——这也正是 `load` 必须写成函数的原因。

## 5. 动手验证

```bash
grep -n "satisfies" source/src/commands/clear/index.ts
```

**我实际跑出来的输出**：

```
17:} satisfies Command
```

只有一处，在第 17 行。再看全仓两种写法的比例：

```bash
grep -rln "satisfies Command" source/src | wc -l
grep -rln ": Command = {" source/src | wc -l
```

**实际输出**：

```
74
10
```

`satisfies` 是主流（74 个文件），`: Command = {` 是少数派（10 个文件）。两种都能编译，区别就是上一节讲的「类型宽窄」。

最后一句 `grep -n "supportsNonInteractive" source/src/main.tsx` 只命中一行（第 2622 行，内容即上一节引用的那句）：这个字段在整个入口文件里只干一件事——把不支持非交互的 `local` 命令从 `-p` 列表里剔掉。

## 6. 合书自测

**1. 说出 6 个字段各自给谁看。**

<details>
<summary>参考答案</summary>

`type` 给程序（决定谁来执行）；`name` 给程序和用户（匹配键 + 列表显示）；`description` 给用户（说明文字）；`aliases` 给程序（多入口匹配）；`supportsNonInteractive` 给程序（headless 过滤）；`load` 给加载器（决定何时加载实现）。

</details>

**2. 为什么第 15、16 行是必填，`aliases` 却不是？**

<details>
<summary>参考答案</summary>

`type: 'local'` 让对象必须满足 `LocalCommand`（`types/command.ts:74-78`），那里把 `supportsNonInteractive` 和 `load` 写成必填；`aliases` 定义在 `CommandBase` 里且带 `?`，是可选。

</details>

**3. 用一句话说清 `satisfies Command` 和 `: Command` 的差别。**

<details>
<summary>参考答案</summary>

检查强度一样，推断结果不同：`satisfies` 保留字面量（`type` 精确为 `'local'`），`: Command` 把对象拓宽成 `Command` 联合（`type` 变成三选一、`name` 变成 `string`，访问 `local` 专属字段要先收窄）。

</details>

**4. 在 `-p` 模式下敲 `/clear` 会发生什么？**

<details>
<summary>参考答案</summary>

匹配不到。`main.tsx:2622` 要求 `local` 类命令的 `supportsNonInteractive` 为真，本命令是 `false`，压根不在 headless 的命令表里。

</details>

## 7. 下一课时

→ [`./L0-05-类型注解给数据贴标签.md`](./L0-05-类型注解给数据贴标签.md)：`参数名: 类型`、`参数名?: 类型`、`) : 类型` 三种贴标签写法怎么念。

**卡住回看**：

- `satisfies` 与类型标注的对比 → [`../00a-TypeScript地基.md`](../00a-TypeScript地基.md) §2.4
- 联合类型 `|` → [`../00a-TypeScript地基.md`](../00a-TypeScript地基.md) §2.5
- 「返回对象要套圆括号」 → [`../00a-TypeScript地基.md`](../00a-TypeScript地基.md) §2.8
- 动态 `import()` → [`../00a-TypeScript地基.md`](../00a-TypeScript地基.md) §4.2
