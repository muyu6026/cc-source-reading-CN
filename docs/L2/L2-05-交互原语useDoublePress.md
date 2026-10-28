# L2-05 · 一个交互原语：`useDoublePress`

> **课时号**：L2-05　**标题**：一个交互原语 `useDoublePress`　**⏱ 时长**：30 分钟（读 18 + 动手 12）
> **前置课时**：[L0-07 函数也是值](../L0/L0-07-函数也是值.md)、[L0-09 三个易错符号](../L0/L0-09-三个易错符号.md)、[L1-04 一个 14 行的 React Hook](../L1/L1-04-十四行ReactHook.md)（状态 + 定时器 + 清理，本课的骨架就是它）
> **上一课时**：[L2-04 一个纯算法 `wrap-text`](./L2-04-纯算法wrap-text.md)
> **本课目标**：见到「双击 / 长按 / 连击」这类交互，先问「它要记住哪几件事」，再决定放 ref 还是 state
> **教材清单**：
> - A：批注版 [`annotated/src/hooks/useDoublePress.ts`](../../annotated/src/hooks/useDoublePress.ts)（66 行，主教材）
> - B：原文 [`source/src/hooks/useDoublePress.ts`](../../source/src/hooks/useDoublePress.ts)（62 行，逻辑相同、无讲解）
> - C：[`annotated/src/hooks/useExitOnCtrlCD.ts`](../../annotated/src/hooks/useExitOnCtrlCD.ts#L63-L72)（第 63–72 行，最典型的调用方）
> - D：[`annotated/src/hooks/useTextInput.ts`](../../annotated/src/hooks/useTextInput.ts#L112)（第 112、131、161 行，同一 hook 用了三次）
>
> 行号说明：路线图写「62 行」指原文，批注版 66 行。下文行号一律用批注版。

## 1. 先看签名

```ts
// annotated/src/hooks/useDoublePress.ts:10-14
export function useDoublePress(
  setPending: (pending: boolean) => void,
  onDoublePress: () => void,
  onFirstPress?: () => void,
): () => void {
```

| 位置 | 名字 | 类型 | 一句话 |
| --- | --- | --- | --- |
| 参数 1 | `setPending` | `(pending: boolean) => void` | 让**调用方**去改「正在等第二击」这个状态 |
| 参数 2 | `onDoublePress` | `() => void` | 窗口内第二击时执行 |
| 参数 3 | `onFirstPress` | `() => void`（可选） | 第一击时执行，多数调用方不传 |
| 返回值 | —— | `() => void` | **一个按键处理器**，挂到键盘事件上 |

两个容易忽略的设计：**它自己不持有 UI 状态**（pending 在调用方，`useExitOnCtrlCD` 里叫 `exitState`），hook 只负责判定与计时；**它返回一个函数而不是布尔值**，用法是 `const handler = useDoublePress(...)`，然后在按键回调里 `handler()`。

## 2. 它到底要记住什么：文字状态机

「双击」听着简单，真正要记的只有两件事——也就是路线图卡片给的答案：**上次按是什么时候**（`lastPressRef`，第 15 行）、**现在是不是还在等第二击**（`timeoutRef` 有没有值，第 16 行）。按第 34–64 行的分支画出来是这样：

```
空闲（timeoutRef=undefined）
  │ 按键
  ├─ 距上次 ≤800ms 且 timeoutRef 有值 ──► 双击：clearTimeout → setPending(false)
  │                                        → onDoublePress() → 回空闲
  └─ 否则 ───────────────────────────► 首击：onFirstPress?.() → setPending(true)
                                           → 起 800ms 定时器
                                              │ 到点：setPending(false)
                                              │      timeoutRef=undefined → 空闲
```

三个能对上代码的结论：

- 连按**三下** = 一次双击 + 一次新的首击。双击分支的 `clearTimeoutSafe()` 把 `timeoutRef` 清成了 `undefined`（第 43 行），第三击自然走「否则」那一侧。
- 超时不是「丢弃状态」，是**回到空闲**：定时器回调把 `setPending(false)`，提示语消失。
- 两个条件必须**同时**成立：时间（第 37 行）+ 定时器还在（第 38 行）。只看时间会误判——刚完成一次双击后 800ms 内再按一下，距上次可能只有几十毫秒，但这次必须是新的首击；拦住它的正是被清空的 `timeoutRef`。

## 3. 逐段精读

### 3.1 第 5、15–16 行：两个 ref

```ts
import { useCallback, useEffect, useRef } from 'react'
```

这里**没有 `useState`**——一个负责双击判定的 hook，自己一个 state 都不存。记忆全在两个 ref 里：

```ts
// annotated/src/hooks/useDoublePress.ts:15-16
  const lastPressRef = useRef<number>(0)
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
```

`lastPressRef` 初值 `0`：`Date.now() - 0` 是巨大正数，第一击必然「超过窗口」，于是自然落入首击分支——**用初值把首次判断变成不用特判**。`timeoutRef` 存定时器句柄，`undefined` 有语义：没有正在等待的第二次。

### 3.2 第 18–30 行：安全清理

```ts
// annotated/src/hooks/useDoublePress.ts:18-23
  const clearTimeoutSafe = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = undefined
    }
  }, [])
```

两件事一起做：取消定时器 + 把 ref 置空。后者才是关键——只 `clearTimeout` 不置空，第 38 行的判定就永远成立。

```ts
// annotated/src/hooks/useDoublePress.ts:26-30
  useEffect(() => {
    return () => {
      clearTimeoutSafe()
    }
  }, [clearTimeoutSafe])
```

`useEffect` 返回函数 = 卸载时执行。组件没了定时器必须跟着没，否则 800ms 后回调会对已卸载组件调 `setPending`。它的依赖 `[clearTimeoutSafe]` 本身依赖是 `[]`，所以这个 effect 实际上只在挂载/卸载各跑一次。

### 3.3 第 34–39 行：判定

```ts
// annotated/src/hooks/useDoublePress.ts:34-39
    const now = Date.now()
    const timeSinceLastPress = now - lastPressRef.current
    const isDoublePress =
      timeSinceLastPress <= DOUBLE_PRESS_TIMEOUT_MS &&
      timeoutRef.current !== undefined
```

第 32 行是 `return useCallback(() => {`，所以这三行**每次按键**都跑。`&&` 两侧就是前面说的两个要件，缺一不可。常量在第 7 行：`export const DOUBLE_PRESS_TIMEOUT_MS = 800`——记住这个数，第 6 节会讲一个和它矛盾的注释。

### 3.4 第 41–45 行：双击分支

```ts
// annotated/src/hooks/useDoublePress.ts:41-45
    if (isDoublePress) {
      // Double press detected
      clearTimeoutSafe()
      setPending(false)
      onDoublePress()
    } else {
```

顺序值得记：**先取消定时器，再撤提示，最后执行动作**。如果先 `onDoublePress()`（比如退出应用），后面的 `setPending(false)` 可能落在正在卸载的组件上。

### 3.5 第 46–62 行：首击分支

```ts
// annotated/src/hooks/useDoublePress.ts:46-62
    } else {
      // First press
      onFirstPress?.()
      setPending(true)

      // Clear any existing timeout and set new one
      clearTimeoutSafe()
      timeoutRef.current = setTimeout(
        (setPending, timeoutRef) => {
          setPending(false)
          timeoutRef.current = undefined
        },
        DOUBLE_PRESS_TIMEOUT_MS,
        setPending,
        timeoutRef,
      )
    }
```

四个动作：调可选的首击回调 → 点亮「等待中」→ 清残留定时器 → 起新的 800ms 定时器。

注意 `setTimeout` 后面两个**额外实参**（第 59–60 行）：`setTimeout(fn, ms, a, b)` 会把 `a`、`b` 原样传给 `fn`，于是回调写成 `(setPending, timeoutRef) => ...` 时不依赖外层闭包，只用到这两样东西，读代码不用往上翻它捕获了什么。`timeoutRef` 是 ref 对象本身（身份永久稳定），回调里改 `.current` 和外面读的是同一格。`onFirstPress?.()` 的 `?.` 说明第三个参数可以完全不传——`useExitOnCtrlCD` 就没传。

### 3.6 第 64–65 行：收尾与依赖

```ts
// annotated/src/hooks/useDoublePress.ts:64-65
    lastPressRef.current = now
  }, [setPending, onDoublePress, onFirstPress, clearTimeoutSafe])
```

`lastPressRef.current = now` 在**两个分支之外**，所以不管首击还是双击都会更新时间戳。只在首击分支更新的话，双击之后时间戳停在上一次，下一击会拿很旧的 `now` 去比，判定就飘了。

依赖数组里没有那两个 ref——**ref 不需要进依赖**，React 保证同一个组件实例上 `useRef` 返回的对象身份不变。

## 4. 为什么是 `useRef` 而不是 `useState`

答案不是「ref 性能好」，而是三条硬理由：

1. **它们不影响画面。** 两个值只影响「下一次按键怎么判」，屏幕上没有像素依赖它们。用 `useState` 存，每按一次键就多一次整树渲染，而在终端里一次重渲染要重排整棵 yoga 树。
2. **判定必须读到同步的最新值。** `setState` 是异步批处理的：连按两下时，第二次按键的回调里 `lastPress` 可能还是旧值（第一次的 setState 还没提交），「距上次多久」算错，双击直接失效。`ref.current` 立刻写、立刻读。
3. **定时器句柄要跨渲染保持同一身份**：`timeoutRef` 的对象身份永久稳定。反过来，**pending 必须走 state**：它决定屏幕上要不要显示「Press Ctrl-C again to exit」。而这个 state 住在调用方：

```ts
// annotated/src/hooks/useExitOnCtrlCD.ts:63-66
  const handleCtrlCDoublePress = useDoublePress(
    pending => setExitState({ pending, keyName: 'Ctrl-C' }),
    exitFn,
  )
```

`setPending` 一调用，`exitState` 变，UI 重渲染。**该重渲染的走 state，不该重渲染的走 ref**。

## 5. 核心问题（路线图原卡片）

**卡片原文**：「问题：为什么需要 `useRef` 而不是 `useState`？（改了不需要重渲染的值放 ref）。自测：说出『双击』在实现上需要记住哪两件事（上次按的时间、是不是在等第二次）。」

**完整解答**：

1. **两件事**：上次按键的时间（`lastPressRef`）、是否还在等第二次（`timeoutRef !== undefined`）。
2. **为什么用 ref**：不参与渲染；`setState` 异步会让连击判定读到旧值；定时器句柄需要跨渲染稳定。三条里第二条是决定性的——就算不在乎性能，用 state 也会算错。
3. **第一击**：`onFirstPress?.()` → `setPending(true)` → 清旧定时器 → 起 800ms 定时器 → 记下时间。
4. **第二击（窗口内）**：`clearTimeoutSafe()` → `setPending(false)` → `onDoublePress()` → 记下时间。
5. **800ms 内没人再按**：定时器回调 `setPending(false)` 并把 ref 置空，回到空闲——提示消失，下一击重新算首击。

## 6. 常见误读

**一、以为窗口是 500ms。** [`annotated/src/components/PromptInput/PromptInput.tsx`](../../annotated/src/components/PromptInput/PromptInput.tsx#L1965) 的注释写「useDoublePress 内部一定有个超时窗口（通常在 500ms 左右）」——那是凭印象写的，真值是第 7 行的 `800`。**注释会骗人，常量不会**。

**二、以为两个回调都会执行。** 第 41 行的 `if / else` 互斥：双击时 `onFirstPress` 不调，首击时 `onDoublePress` 不调。想「两击都做事」，得自己在 `onDoublePress` 里补。

**三、以为换成 `useState` 只是「慢一点」。** 后果是**判错**：批处理让第二击读到旧的 `lastPress`，双击可能永远不成立。性能只是次要损失。

## 7. 动手验证

**7.1 窗口到底是多久**

```bash
grep -rn "DOUBLE_PRESS_TIMEOUT_MS" annotated/src
```

```
annotated/src/hooks/useDoublePress.ts:7:export const DOUBLE_PRESS_TIMEOUT_MS = 800
annotated/src/hooks/useDoublePress.ts:37:      timeSinceLastPress <= DOUBLE_PRESS_TIMEOUT_MS &&
annotated/src/hooks/useDoublePress.ts:58:        DOUBLE_PRESS_TIMEOUT_MS,
```

三处：定义、判定、起定时器。**判定和定时器用同一个常量**，两边不一致就会出现「窗口 800、定时器 500」的错位。

**7.2 这个 hook 里有没有 `useState`**

```bash
grep -n "import" annotated/src/hooks/useDoublePress.ts
```

```
5:import { useCallback, useEffect, useRef } from 'react'
```

只有 `useCallback`、`useEffect`、`useRef`。一个负责让 UI 变化的 hook，自己不存任何 UI 状态。

**7.3 谁在用它**

```bash
grep -rn "useDoublePress(" annotated/src --include=*.ts --include=*.tsx
```

```
annotated/src/components/PromptInput/PromptInput.tsx:1974:  const doublePressEscFromEmpty = useDoublePress(() => {}, () => onShowMessageSelector());
annotated/src/hooks/useDoublePress.ts:10:export function useDoublePress(
annotated/src/hooks/useExitOnCtrlCD.ts:63:  const handleCtrlCDoublePress = useDoublePress(
annotated/src/hooks/useExitOnCtrlCD.ts:69:  const handleCtrlDDoublePress = useDoublePress(
annotated/src/hooks/useTextInput.ts:112:  const handleCtrlC = useDoublePress(
annotated/src/hooks/useTextInput.ts:131:  const handleEscape = useDoublePress(
annotated/src/hooks/useTextInput.ts:161:  const handleEmptyCtrlD = useDoublePress(
```

三个文件、六处调用（`useTextInput` 一个文件就用了三次）——**交互原语的价值就在复用**。

## 8. 合书自测

**1.** 「双击」在实现上要记住哪两件事？分别存在哪？

<details><summary>参考答案</summary>
上次按键的时间（`lastPressRef`）和「是否还在等第二次」（`timeoutRef` 是否为 `undefined`）。两个都是 ref：不参与渲染，且判定时要读同步最新值。
</details>

**2.** 第一击完整发生了什么？按顺序说四个动作。

<details><summary>参考答案</summary>
`onFirstPress?.()` → `setPending(true)` → `clearTimeoutSafe()` → 起 800ms 定时器（回调里 `setPending(false)` 并把 ref 置空）；最后统一更新 `lastPressRef.current`。
</details>

**3.** 连按三下，第三下算什么？

<details><summary>参考答案</summary>
算新的首击。双击分支里的 `clearTimeoutSafe()` 已把 `timeoutRef` 清成 `undefined`，第三下不满足第 38 行条件，走 else——会再调一次 `onFirstPress` 并重新点亮 pending。
</details>

**4.** 把两个 ref 换成 `useState`，会出现哪两个问题？

<details><summary>参考答案</summary>
（1）每次按键多一次整树重渲染；（2）更严重的是 `setState` 异步批处理，第二次按键的回调可能读到旧时间戳，导致「距上次多久」算错、双击判不出来。
</details>

## 9. 下一步

- **下一课时**：[L2-06 · 一个时钟：`use-interval`](./L2-06-时钟use-interval.md)——同样要「记住一个值」，但那一次记的是时间，而且要和别人共享。
- **回看地基**：函数作为参数与可选参数 → [`L0-07`](../L0/L0-07-函数也是值.md)；`?.` 与 `!` → [`L0-09`](../L0/L0-09-三个易错符号.md)。
- **想看双击退出的完整链**：[`annotated/src/hooks/useExitOnCtrlCD.ts`](../../annotated/src/hooks/useExitOnCtrlCD.ts#L46-L101)。
