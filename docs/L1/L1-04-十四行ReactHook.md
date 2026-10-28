# L1-04 · 一个 14 行的 React Hook

> L0-05 用这个文件讲过「类型注解给数据贴标签」。**本课完全换角度**：一行类型都不再讲，专讲它作为 **React Hook** 的运行机制——副作用、定时器、清理函数、依赖数组。
> 这也是 L1 层唯一一个「描述会随时间变化的东西」的文件，值得慢慢读。

| 项目 | 内容 |
| --- | --- |
| 课时号 | L1-04（L1 层第 4 课，共 6 课） |
| ⏱ 时长 | 30 分钟 |
| 前置课时 | [`../L0/L0-07-函数也是值.md`](../L0/L0-07-函数也是值.md)、[`../L0/L0-08-async与await.md`](../L0/L0-08-async与await.md)（函数传参与异步节奏） |
| 教材 | [`annotated/src/hooks/useTimeout.ts`](../../annotated/src/hooks/useTimeout.ts) 全 14 行<br>原文对照：[`source/src/hooks/useTimeout.ts`](../../source/src/hooks/useTimeout.ts) |
| 配套讲义 | [`../00a-TypeScript地基.md`](../00a-TypeScript地基.md) §2.2（数组解构）、§2.8（箭头函数）、术语表（hook / side effect） |
| 路线图卡片 | [`../00-零基础学习路线.md`](../00-零基础学习路线.md) 的「L1-4」一节 |

**摘录约定**：`│` 左边是原文行号，右边是原文逐字内容。

---

## 1. 精读正文

全文件 14 行，逐字摘录：

```ts
1  │ import { useEffect, useState } from 'react'
2  │
3  │ export function useTimeout(delay: number, resetTrigger?: number): boolean {
4  │   const [isElapsed, setIsElapsed] = useState(false)
5  │
6  │   useEffect(() => {
7  │     setIsElapsed(false)
8  │     const timer = setTimeout(setIsElapsed, delay, true)
9  │
10 │     return () => clearTimeout(timer)
11 │   }, [delay, resetTrigger])
12 │
13 │   return isElapsed
14 │ }
```

### 1.1 这个 Hook 的功能一句话

「给我一个毫秒数 `delay`，我给你一个布尔值：**时间没到是 `false`，到了就翻成 `true`**；如果 `resetTrigger` 变了，重新计时。」它管的是「**已经过了多久**」这件事——终端界面里的加载转圈（转超过 1 秒才显示）就靠它。

### 1.2 第 3–4 行：Hook 的门面与状态

```ts
3  │ export function useTimeout(delay: number, resetTrigger?: number): boolean {
4  │   const [isElapsed, setIsElapsed] = useState(false)
```

- 第 3 行：函数名以 **`use` 开头**——这是 React 的命名约定：`use` 开头的函数叫 **Hook（钩子）**，里面可以使用 React 的特殊能力。`resetTrigger?` 的 `?` 表示这个参数**可以不传**（L1 教材批注里也点了：`?` 跟在参数后是「可不传」）。
- 第 4 行：`useState(false)` 创建一块**状态**，初始值 `false`，返回一个两元素数组，第 4 行用**数组解构**（讲义 §2.2）拆开：
  - `isElapsed` —— 当前值（「时间到了吗」）；
  - `setIsElapsed` —— 唯一能合法修改它的函数。

**为什么要用 `useState` 而不是普通变量？** 因为普通变量在函数每次被调用时都重新创建，记不住上一次的值；状态由 React 保管，跨多次渲染存活，且**改它会触发界面重新渲染**。「改状态 → 重新渲染」是 React 的基本循环。

### 1.3 第 6–11 行：useEffect 与副作用

```ts
6  │   useEffect(() => {
7  │     setIsElapsed(false)
8  │     const timer = setTimeout(setIsElapsed, delay, true)
9  │
10 │     return () => clearTimeout(timer)
11 │   }, [delay, resetTrigger])
```

**先说什么是「副作用」（side effect）**：函数除了算出返回值，还动了「外面的世界」——改状态、设定时器、发网络请求，都算。React 里**渲染过程**要求纯粹（只算、不动手），动手的事统一交给 `useEffect`：**「渲染完成后，再执行我给的这段代码」**。

逐行拆：

- **第 7 行**：每次效果执行，先把状态复位成 `false`——「重新计时」从清零开始。
- **第 8 行**：`setTimeout(回调, 毫秒数, 传给回调的参数)`。这里把 `setIsElapsed` 直接当回调、第三个参数 `true` 会在触发时作为实参传给它——合起来就是「**`delay` 毫秒后执行 `setIsElapsed(true)`**」。定时器的编号存进 `timer`。
- **第 10 行**：**本课的主角**。效果函数可以返回一个函数，React 把它当**清理函数**用。第 11 行的 `[delay, resetTrigger]` 是**依赖数组**。两件事合在一起，是下一节的核心问题。
- **第 11 行**：依赖数组决定「**什么变化会让这段效果重跑**」：`delay` 或 `resetTrigger` 任一个和上次渲染时不同，React 就先调上次的清理函数，再重新执行整个效果。

**中文念法（第 8 行）**：

> 「起一个定时器：`delay` 毫秒后，调 `setIsElapsed(true)`；编号记在 `timer` 里。」

**中文念法（第 10 行）**：

> 「返回一个清理函数：将来 React 要打扫时，执行 `clearTimeout(timer)`，把这个定时器取消掉。」

### 1.4 第 13–14 行：把状态交出去

```ts
13 │   return isElapsed
14 │ }
```

Hook 把状态值作为返回值交给调用方。调用方（实测 `source/src/utils/preflightChecks.tsx` 第 85 行）：

```ts
85 │   const showSpinner = useTimeout(1000) && isChecking;
```

**中文念法**：「显示转圈 = 『已经过了 1000 毫秒』**并且**『还在检查中』。」检查很快（比如 200 毫秒）就完成时，`isElapsed` 还是 `false`，转圈**根本不出现**——没有一闪而过的闪烁。这个 Hook 的存在就是为了这种「超过阈值才出现」的体验。

## 2. 核心问题（路线卡片原题的完整解答）

### 2.1 `return () => clearTimeout(timer)` 这个返回值是给谁的？

**给 React 用的，不是给调用方用的。**

`useEffect` 的效果函数如果返回一个函数，React 会记住它，并在**两个时机**调用：

1. **下一次重跑这个效果之前**。`delay` 或 `resetTrigger` 变了，React 要重跑效果；重跑前先调上一次的清理函数——先把旧定时器取消，再起新的。没有这一步，旧定时器还挂着，到点就会把状态翻成 `true`，新计时就被旧定时器搞乱了。
2. **组件从界面上移除（卸载）时**。这是最后一道打扫：组件都没了，定时器必须取消。

谁调它？React 内部。什么时候调？就是上面两个时机。**写代码的人只负责「把打扫动作返回出去」，调用时机完全交给 React**——这是 React 的契约。如果不返回，就等于说「没有要打扫的」，React 也不会报错，但定时器就漏了（见下一题）。

### 2.2 为什么定时器必须被清理？（不清理会怎样）

两条后果，一条影响正确性，一条影响资源：

1. **正确性被旧定时器污染**。设想 `delay` 从 1000 改成 5000：如果不清理旧定时器，1000 毫秒一到，旧定时器照样把 `isElapsed` 翻成 `true`——而新意图是「5 秒后才翻」。使用者看到一个**提前出现的转圈**。重跑效果时第 7 行 `setIsElapsed(false)` 复位一次，也救不回已经被旧定时器安排好的将来。
2. **组件没了，定时器还在跑**。组件卸载后，它的定时器如果不取消，到点仍会执行回调——试图去更新一个**已经不存在的组件**的状态。轻则是无意义的工作（泄漏的定时器越积越多，长会话的终端界面里组件频繁生灭，积累可观），重则触发 React 的「更新已卸载组件」警告甚至异常行为。**「谁起的东西，谁负责收」——定时器、事件监听、订阅，凡是「起了一个会持续存在的东西」，清理函数都要对称地给一份。**

`clearTimeout(timer)` 就是「取消那个编号的定时器」：到点不再触发，像它从未存在过。

### 2.3 依赖数组 `[delay, resetTrigger]` 决定什么？

**决定这个效果「跟着谁变」**。React 拿这次的依赖值和上次渲染时的依赖值逐项比较（`Object.is` 比较）：

- **都没变** → 效果不重跑，一切维持原样，定时器继续走。
- **任何一个变了** → 三步曲：先调上次的**清理函数**（取消旧定时器）→ 重新执行效果（第 7 行复位为 `false`）→ 起新定时器（按新 `delay` 计时）。

所以这个数组同时决定了两件事：**效果重跑的时机**，和**清理函数被调用的时机**（每次重跑前 + 卸载时）。

### 2.4 `resetTrigger` 变化时的重置行为具体是什么？

调用方传一个数字当 `resetTrigger`（可选，不传就永远不变）。当调用方把这个数字**换成新值**（典型做法是加 1）：

1. React 发现依赖变了，先 `clearTimeout` 旧定时器；
2. 重跑效果：`setIsElapsed(false)`——把「时间到了」翻回「还没到」；
3. 用**原来的 `delay`** 重新起一个定时器。

净效果：**计时归零重来**。比如「正在检查」的过程中用户又发起了新一轮检查，调用方把 `resetTrigger` 加 1，转圈的 1 秒阈值就从这一刻重新起算，而不是沿用上一轮的残时。注意：`resetTrigger` 的**数值本身没有意义**，有意义的只是「它变没变」——这是「用变化信号触发重置」的惯用法。

## 3. 常见误读

**误读 1：以为第 10 行的 `return` 是这个 Hook 的返回值。**
不是。它在 `useEffect(() => {...})` 这个**箭头函数的函数体**里（讲义 §2.8），返回的是「清理函数」，交给 React。Hook 自己的返回值在第 13 行 `return isElapsed`。一个函数里两个 `return`，属于**两层不同的函数**。

**误读 2：以为依赖数组 `[delay, resetTrigger]` 是「这两个值变了才执行 effect」的一次性条件。**
依赖数组管的是**每次渲染后的对比**，不是「第一次执行的条件」。效果第一次挂载时必然执行一次；之后每次渲染都拿依赖值和上次比，变了才重跑。空数组 `[]` 才是「只在挂载时执行一次」。

**误读 3：以为不写清理函数也没事，反正定时器到点自己结束。**
到点「结束」的是触发**动作**，但在这之前它一直占用着一个「将来要做某事」的注册位；而且一旦组件卸载或依赖变化，这个「将来」就是错的。清理的意义不在省那一次触发，而在**保证「将来的动作」永远和当前意图一致**。

## 4. 动手验证

确认 `useEffect` 确实在这个文件里、以及谁在用它：

```bash
grep -rn "useEffect" source/src/hooks/useTimeout.ts
grep -rn "useTimeout" source/src --include=*.tsx --include=*.ts -l
```

**我实际跑出来的输出**：

```
source/src/hooks/useTimeout.ts:6:  useEffect(() => {
source/src/hooks/useTimeout.ts
source/src/utils/preflightChecks.tsx
```

第一行：`useEffect` 出现在第 6 行（路线卡片指定的验证命令）。第二行：全仓只有一个调用方。看调用现场：

```bash
sed -n '7p;85p' source/src/utils/preflightChecks.tsx
```

**实际输出**：

```
7:import { useTimeout } from '../hooks/useTimeout.js';
85:  const showSpinner = useTimeout(1000) && isChecking;
```

不传 `resetTrigger`（可选参数），1000 毫秒阈值，与 `isChecking` 相与——正是 1.4 节分析的用法。

## 5. 合书自测

**1. 不看文件，说出 `useTimeout` 收什么、还什么。**

<details>
<summary>参考答案</summary>

收：必填的 `delay`（毫秒数），可选的 `resetTrigger`（变化即重置计时的信号）。还：一个布尔值 `isElapsed`——时间没到 `false`，到了 `true`；`resetTrigger` 变化时翻回 `false` 重新计时。

</details>

**2. 清理函数在哪些时机会被 React 调用？**

<details>
<summary>参考答案</summary>

两个时机：这个效果因依赖变化即将重跑之前（先清理旧的，再跑新的），以及组件卸载时（最后一次打扫）。

</details>

**3. `resetTrigger` 从 3 变成 4 之后，界面上的「已过时间」状态经历了什么？**

<details>
<summary>参考答案</summary>

先 `clearTimeout` 旧定时器；效果重跑，`setIsElapsed(false)` 把状态复位；再按原 `delay` 起新定时器。计时从零重新开始，`resetTrigger` 的具体数值本身没有意义。

</details>

**4. `setTimeout(setIsElapsed, delay, true)` 的第三个参数 `true` 是干嘛的？**

<details>
<summary>参考答案</summary>

`setTimeout` 允许把额外参数传给到点执行的回调：到点时执行的是 `setIsElapsed(true)`，等价于「把状态翻成 true」。这是「函数当值传」的写法——不包一层箭头函数也能带参调用。

</details>

**5. 如果把依赖数组删掉（写成无第二个参数的 `useEffect(...)`），会发生什么？**

<details>
<summary>参考答案</summary>

没有依赖数组时，效果在**每次渲染后都重跑**：每次都清理旧定时器、复位状态、重新计时。状态一变就触发渲染，渲染又重置计时——`isElapsed` 可能永远翻不到 `true`。依赖数组正是为了「只在真正相关的值变化时才重置」。

</details>

**6. 为什么普通函数记不住「上次算出的值」，这个 Hook 可以？**

<details>
<summary>参考答案</summary>

因为状态存在 `useState` 里，由 React 保管，跨渲染存活；普通局部变量每次函数调用都重新创建。且 `setIsElapsed` 的修改会触发重新渲染，形成「改状态 → 重渲染 → 读到新状态」的循环。

</details>

## 6. 下一课时

→ [`./L1-05-十九行命令声明.md`](./L1-05-十九行命令声明.md)：回到「声明」这个主题——19 行的 `/clear` 命令门牌，L0 只看过它的片段，这次从头读到尾。

**卡住回看**：

- 数组解构 → [`../00a-TypeScript地基.md`](../00a-TypeScript地基.md) §2.2
- 箭头函数三种写法 → [`../00a-TypeScript地基.md`](../00a-TypeScript地基.md) §2.8
- `?` 的三种含义 → [`../00a-TypeScript地基.md`](../00a-TypeScript地基.md) §2.3

**L1 过关标准**：任挑一个 ≤20 行的文件，5 分钟内讲清「它收什么、做什么、返回什么、谁在用它」。标准见 [`../00-零基础学习路线.md`](../00-零基础学习路线.md)。
