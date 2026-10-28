# L0-08 · `async` 与 `await`（精读版）

> **课时号**：L0-08　**标题**：`async` / `await`——0 基础最大的坎
> **⏱ 时长**：40 分钟　**前置课时**：[L0-07 函数也是值](./L0-07-函数也是值.md)
> **教材清单**：
> - 批注版：[`annotated/src/commands/clear/clear.ts`](../../annotated/src/commands/clear/clear.ts)（20 行，对应原文 7 行）
> - 原文：[`source/src/commands/clear/clear.ts`](../../source/src/commands/clear/clear.ts)（全 7 行）
> - 实现体：[`annotated/src/commands/clear/conversation.ts`](../../annotated/src/commands/clear/conversation.ts) 第 57–73、89、232–235、302、356 行
> - 类型定义：[`source/src/types/command.ts`](../../source/src/types/command.ts) 第 62–65 行
> - 调用方：[`source/src/utils/processUserInput/processSlashCommand.tsx`](../../source/src/utils/processUserInput/processSlashCommand.tsx) 第 668–669 行
>
> **这节课只解决一件事**：`async` 到底标注了函数的什么性质；`await` 拿掉之后，程序会「错」在哪里。

---

## 1. 七行原文

```ts
import type { LocalCommandCall } from '../../types/command.js'
import { clearConversation } from './conversation.js'

export const call: LocalCommandCall = async (_, context) => {
  await clearConversation(context)
  return { type: 'text', value: '' }
}
```

这是 `/clear` 的全部执行逻辑：把清理委托给 `clearConversation`，再返回一个空文本结果。**先记住一句话**：`/clear` 看起来「瞬间完成」，实际上第 5 行在等一件几百行的事做完（清消息、清缓存、换会话 ID、跑钩子）。

---

## 2. 精读正文（逐行）

### 2.1 第 1–2 行：一条只要类型，一条要真东西

```ts
import type { LocalCommandCall } from '../../types/command.js'
import { clearConversation } from './conversation.js'
```

**念法**：「第一行只取一个**类型** `LocalCommandCall`（编译后整行消失，讲义 [§4.1](../00a-TypeScript地基.md)）；第二行取的是运行时真的要调用的函数 `clearConversation`。」

`.js` 后缀不是笔误，是这个仓库的 ESM 约定（讲义 [§1.5](../00a-TypeScript地基.md)）：源码是 `conversation.ts`，引用写 `.js`。

### 2.2 第 4 行：一行里四个信息

```ts
export const call: LocalCommandCall = async (_, context) => {
```

**念法**：
> 「导出一个叫 `call` 的值，它的类型是 `LocalCommandCall`；这个值是一个**异步**箭头函数，收两个参数——第一个我不用，第二个叫 `context`。」

| 片段 | 含义 |
| --- | --- |
| `export const call` | 定义一个常量并导出。它是个**值**（函数也是值，L0-07） |
| `: LocalCommandCall` | 类型标注：必须符合「本地命令执行函数」的形状 |
| `async` | **标注函数性质：内部有等待，所以一定返回 `Promise`** |
| `(_, context)` | 两个参数；`_` 是「占位但不用」的约定名 |
| `=> {` | 函数体开始（多语句，必须显式 `return`） |

`LocalCommandCall` 长什么样（第 62–65 行）：

```ts
export type LocalCommandCall = (
  args: string,
  context: LocalJSXCommandContext,
) => Promise<LocalCommandResult>
```

**念法**：「收一个字符串 `args` 和一个上下文，返回 `Promise<LocalCommandResult>`。」

两行对上了：`_` 就是 `args`（用户敲 `/clear` 后面跟的原始文本），`context` 是上下文。**为什么写 `_`**：`/clear` 不关心参数，但**位置不能省**——想拿第二个，就得先占住第一个（L0-07 的 `_stdout` 同理）。

### 2.3 第 5 行：这里等

```ts
  await clearConversation(context)
```

**念法**：「调用 `clearConversation`，**等它彻底做完，再走下一行**。」

`clearConversation` 是 `async` 函数，调用它立刻得到一张「取货单」（`Promise`），不是「清完了」这个事实。`await` 就是在取货单上等：等到兑现，才继续。**它只暂停当前这个 async 函数**，不冻结整个进程——等待期间，界面渲染、按键响应照常跑（讲义 [§3.3](../00a-TypeScript地基.md)）。

### 2.4 第 6 行：返回值被自动打包

```ts
  return { type: 'text', value: '' }
```

**念法**：「返回一个对象，`type` 是 `text`，内容是空字符串。」

两个细节：

1. **`async` 函数里的 `return` 会被自动包进 `Promise`**。函数体 `return` 的是裸对象，调用方 `await` 之后拿到才是对象；不 `await` 拿到的是 Promise。所以 `LocalCommandCall` 才敢声明返回 `Promise<...>`。
2. **`value: ''` 是空的**。批注版第 16–18 行解释：消息列表已被清空，再塞一条「已清空」会让用户看到一条孤零零的系统提示。**返回空串是一个决定，不是漏写。**

### 2.5 被等的那一头：`conversation.ts`

第 57 行（批注版）：

```ts
export async function clearConversation({
```

第 73 行（参数类型写完之后）：

```ts
}): Promise<void> {
```

`async` 写在 `function` 前面，位置和箭头函数的 `async` 不同，作用一样：**这个函数一定返回 `Promise`**。返回类型显式写 `Promise<void>`：`void` 表示「没有有意义的返回值」，`Promise<void>` 表示「等它做完，但不给你结果」。

```ts
  await executeSessionEndHooks('clear', {
```

第 89 行在等 SessionEnd 钩子跑完。批注版第 95–97 行点明为什么必须等：**不等的话，钩子会和后面的清理并发跑，钩子读到的是「清到一半」的状态**——钩子的用户脚本可能还要归档对话，清完再跑就什么也读不到了。

同样的 `await` 还出现在第 302 行（`await resetSessionFilePointer()`）和第 356 行（`await processSessionStartHooks('clear')`），`grep -c "await"` 数出来正好 **3** 处。**顺序在这里就是语义**：先收尾钩子，再清，再开场钩子。

### 2.6 故意不等的两处

```ts
        } catch (error) {
          logError(error)
        }
        void evictTaskOutput(taskId)
```

第 232–235 行：单个后台任务清理失败，只记日志，**不往上抛**。批注版第 237–241 行给了理由：清理要「尽力做完」，一个任务杀不掉不能让整个 `/clear` 失败。

`void evictTaskOutput(taskId)` 的 `void` 是另一种表态（讲义 [§2.11](../00a-TypeScript地基.md)）：**它返回 Promise，我故意不等**。清输出文件是后台活，不该拖慢 `/clear`。

同一个文件里两种态度，判断标准是「这件事没做完，用户会不会受损」：SessionEnd 钩子必须等（否则读到半清状态），文件指针必须等（否则新会话写进旧文件），`evictTaskOutput` 不必等（失败无害）。

### 2.7 调用方也得等

```ts
            const mod = await command.load();
            const result = await mod.call(args, context);
```

第 668–669 行。`command.load()` 是懒加载（返回 Promise），`mod.call(...)` 就是本课的主角 `call`。

**念法**：「先等模块加载完；再等命令执行完；`result` 才是真正的结果。」

这两行是「`async` 会传染」的证据：`call` 是异步的，调用它的地方必须 `await`；调用者自己也就被拉进异步链，一直往上传染到界面层。

---

## 3. 三个问题（路线图 L0-8 卡片）

### 问题 1：第 4 行的 `_` 是什么？

`_` 是**第一个参数的变量名**，值是用户敲 `/clear` 后面跟的原始文本（类型 `string`，来自 `LocalCommandCall` 的第一个参数 `args`）。

三个要点：

1. **它只是名字，不是特殊语法**。写成 `_args`、`unused` 都合法；`_` 是社区约定，让人一眼知道「这里的东西不用」。
2. **位置不能省**。想拿第二个参数 `context`，必须在第一个位置放占位符——JS 没有「跳过第一个参数」的语法。它和 L0-07 的 `_stdout` 是同一约定：那个是「形状要三个参数，只用第一个」，这里是「形状要两个参数，只用第二个」。

### 问题 2：把第 5 行的 `await` 删掉会发生什么？

**不会报错，但行为是错的**——这是它最阴的地方。

删掉后这一行变成 `clearConversation(context)`：仍然会**发起**清理，但**立刻返回一张取货单**，执行流马上去跑第 6 行 `return`。于是：

| 后果 | 具体表现 |
| --- | --- |
| 命令「秒完成」 | 调用方以为 `/clear` 结束了，清理还在后台跑 |
| 顺序错乱 | 紧接着开始的新对话，可能被仍在进行的旧清理波及（清消息、换 session ID） |
| 错误丢失 | `clearConversation` 抛的错没人接，变成「未处理的 Promise 拒绝」 |
| 状态不可预期 | 用户看到界面已清空 / 或清了一半，取决于两边速度 |

**为什么 `try/catch` 也救不了**（讲义 [§3.3](../00a-TypeScript地基.md)）：没有 `await`，`catch` 捕获不到那个 Promise 内部的异常，异常会逃到全局。

**一句话**：删掉 `await`，删的不是「等待时间」，是「**因果顺序**」。

### 问题 3：`async` 函数一定返回 `Promise` 吗？

**一定**。这是 `async` 关键字的定义，不是习惯。三种情况都会被包成 Promise（教学示例，不在仓库里）：

```ts
async function a() { return 1 }        // 调用得到 Promise<number>
async function b() { return { x: 1 } } // Promise<{x: number}>
async function c() { }                 // 没有 return，得到 Promise<void>
```

所以：

1. `clear.ts` 的 `call` 声明类型是 `LocalCommandCall`，其返回是 `Promise<LocalCommandResult>`，而函数体 `return` 的是裸对象——**能对上，因为 `async` 已经帮你包了一层**。
2. `conversation.ts` 第 73 行直接写 `Promise<void>`，是在**明说**「等它做完，但没有结果给你」。
3. **调用方必须 `await`**（或 `.then`），否则拿到的是 Promise 而不是结果——第 669 行就是标准写法。

反向不成立：返回 Promise 的函数不一定带 `async`，但 `async` 函数一定返回 Promise。

---

## 4. 常见误读

| ❌ 0 基础最可能这样读 | ✅ 实际是什么 |
| --- | --- |
| `async` 表示「多线程 / 并行执行」 | 不是。JS 单线程，`async` 只表示「内部可能要等，返回 Promise」 |
| 删掉 `await` 会立刻报错 | 多数情况不报错，只是逻辑错——比报错更难查 |
| `async` 函数 `return` 对象，调用方拿到的就是对象 | 拿到的是 `Promise<对象>`，要 `await` 才是对象 |

---

## 5. 动手验证（以下输出是我在本仓库真实跑出来的）

**① 数清这七行里哪些是异步关键字**

```bash
grep -n "async\|await" source/src/commands/clear/clear.ts
```

实际输出：

```
4:export const call: LocalCommandCall = async (_, context) => {
5:  await clearConversation(context)
```

一行 `async`（标记函数性质），一行 `await`（标记等待点）。

**② 数被等的那一头有几个 `await`**

```bash
grep -c "await" source/src/commands/clear/conversation.ts
```

实际输出：

```
3
```

分别在第 89、302、356 行。

**③ 找调用方，确认它也 `await`**

```bash
grep -rn "mod.call(args, context)" source/src
```

实际输出：

```
source/src/utils/processUserInput/processSlashCommand.tsx:669:            const result = await mod.call(args, context);
```

---

## 6. 合书自测

1. `async` 标注的是函数的什么性质？它一定返回什么？
2. 第 5 行删掉 `await`，代码还能编译吗？运行时会错在哪？
3. `_` 是什么？能不能把它删掉、直接写 `(context)`？
4. `clearConversation` 的返回类型为什么能写成 `Promise<void>`？
5. 第 235 行 `void evictTaskOutput(taskId)` 为什么不写成 `await`？

<details>
<summary>参考答案（先自己写，再展开）</summary>

1. 标注「这个函数内部会等待异步操作」，连带性质是**一定返回 `Promise`**；`return` 的值会被自动包进 Promise。
2. 能编译（TS 允许不 await 的调用，最多 lint 警告）。错在顺序：命令立刻报告完成，清理仍在后台；错误变成未处理的 Promise 拒绝；新会话可能与旧清理交叠。
3. `_` 是第一个参数的变量名，约定表示「不用」。不能删——删掉后 `context` 变成第一个参数，类型对不上（第一位置是 `string`）。
4. 它 `async` 且没有有意义的返回值（不 `return` 数据），所以是 `Promise<void>`：等它完成，但不产出结果。
5. 它是后台活、失败无害（下次读输出会重新解析），不该拖慢 `/clear`。判断标准是「这件事没做完，用户会不会受损 / 会不会破坏后续步骤的状态」。

</details>

## 7. 下一课时

- 下一课：[L0-09 三个最容易读错的符号 `?.` `??` `!`](./L0-09-三个易错符号.md)
- 这一课卡住，回看讲义：[§3 异步：0 基础最大的坎](../00a-TypeScript地基.md)
- 想往前复习：[L0-07 函数也是值](./L0-07-函数也是值.md)
