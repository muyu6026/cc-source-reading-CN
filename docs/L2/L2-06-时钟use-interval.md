# L2-06 · 一个时钟：`use-interval`

> **课时号**：L2-06　**标题**：一个时钟 `use-interval`　**⏱ 时长**：30 分钟（读 18 + 动手 12）
> **前置课时**：[L0-08 async 与 await](../L0/L0-08-async与await.md)、[L1-04 一个 14 行的 React Hook](../L1/L1-04-十四行ReactHook.md)（同样的「状态 + 定时器 + 清理」骨架，本课把它换成共享时钟）
> **上一课时**：[L2-05 一个交互原语 `useDoublePress`](./L2-05-交互原语useDoublePress.md)
> **本课目标**：分清「定时器 hook」和「`setInterval`」的差别；知道什么时候该问「这个时钟是谁在驱动」
> **教材清单**：
> - A：批注版 [`annotated/src/ink/hooks/use-interval.ts`](../../annotated/src/ink/hooks/use-interval.ts)（94 行，主教材）
> - B：原文 [`source/src/ink/hooks/use-interval.ts`](../../source/src/ink/hooks/use-interval.ts)（67 行，路线图说的「第 15 行」「第 67 行」都按这个文件）
> - C：[`annotated/src/ink/components/ClockContext.tsx`](../../annotated/src/ink/components/ClockContext.tsx)（第 99 行是默认值，第 35–50 行是 `keepAlive` 的判定）
> - D：[`annotated/src/ink/hooks/use-animation-frame.ts`](../../annotated/src/ink/hooks/use-animation-frame.ts#L66)（第 66 行，唯一传 `keepAlive: true` 的地方）
>
> 行号说明：下文行号一律用批注版；凡是路线图按原文行号提问的，会明确写「原文第 N 行」。

## 1. 先看签名

```ts
// annotated/src/ink/hooks/use-interval.ts:62-65
export function useInterval(
  callback: () => void,
  intervalMs: number | null,
): void {
```

| 位置 | 名字 | 类型 | 一句话 |
| --- | --- | --- | --- |
| 参数 1 | `callback` | `() => void` | 到点了要做什么 |
| 参数 2 | `intervalMs` | `number \| null` | 间隔毫秒；**`null` = 暂停** |
| 返回值 | —— | `void` | 什么都不返回 |

返回值是 `void` 这一点常被忽略：同文件的 `useAnimationTimer` 返回 `number`（当前时间），而 `useInterval` **不生产时间，只生产「到点了」这个事件**。所以它没有 state，也就不会因为自己而重渲染——第 5 节要用到这句话。

同一个文件里还有个「兄弟」：

```ts
// annotated/src/ink/hooks/use-interval.ts:20-22
export function useAnimationTimer(intervalMs: number): number {
  const clock = useContext(ClockContext)
  const [time, setTime] = useState(() => clock?.now() ?? 0)
```

这两个 hook 结构几乎一样，唯一区别是：`useAnimationTimer` 把时间存进 state 并返回，`useInterval` 只调回调。

## 2. 它和直接 `setInterval` 的三点区别

### 区别一：它不自己起定时器，而是挂在共享时钟上

```ts
// annotated/src/ink/components/ClockContext.tsx:35-49
  function updateInterval(): void {
    const anyKeepAlive = [...subscribers.values()].some(Boolean);
    if (anyKeepAlive) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (startTime === 0) {
        startTime = Date.now();
      }
      interval = setInterval(tick, currentTickIntervalMs);
    } else if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }
```

整个进程只有**一个** `setInterval`（在 Clock 里，间隔 `FRAME_INTERVAL_MS = 16`，见 `constants.ts` 第 15 行）。所有 `useInterval` 订阅者是被这个 tick 挨个叫醒的。收益：一屏十个每秒轮询的东西，事件循环只醒一次（第 53–57 行注释）。代价：精度被 16ms 的 tick 网格限制。

### 区别二：回调不进依赖，靠 ref 转一手

直接 `setInterval` 常见的坑是「回调写进依赖 → 每次渲染重建定时器 → 计时永远从头开始」。这里用 `callbackRef` 规避：第 66–67 行每次渲染把最新回调塞进 ref，effect 的依赖只有 `[clock, intervalMs]`。所以调用方传内联箭头函数也不会反复订阅。

### 区别三：可暂停，而且是「先清后建」

`intervalMs === null` 时 effect 直接 `return`（第 80 行），不订阅。依赖变化时 React 会先跑上一轮 cleanup（第 92 行返回的 unsubscribe），再跑新 effect——**先拆旧的，再建新的**，不会两个订阅同时活着。

## 3. 逐段精读

### 3.1 第 66–67 行：在渲染阶段写 ref

```ts
// annotated/src/ink/hooks/use-interval.ts:66-67
  const callbackRef = useRef(callback)
  callbackRef.current = callback
```

第 68–75 行的注释自己承认了：在**渲染阶段**写 ref 严格来说属于副作用，规范做法是放进 effect。这里这么做换来两个好处——effect 里读到的永远是最新回调，且 `callback` 不必进依赖（否则调用方传内联箭头时每次都重新订阅）。

注释还标了边界：并发渲染下被丢弃的那次渲染也会写这个 ref；对「定时器回调」这种幂等场景无害。**作者把已知风险写在旁边，而不是假装没有**——这是读代码时值得学的态度。

### 3.2 第 79–83 行：两道守卫

```ts
// annotated/src/ink/hooks/use-interval.ts:79-83
  useEffect(() => {
    if (!clock || intervalMs === null) return

    let lastUpdate = clock.now()
```

`!clock` 处理「不在 `ClockProvider` 里」；`intervalMs === null` 处理「调用方要求暂停」。两者都直接 `return`，也就是**不订阅、不返回 cleanup**——暂停期间这个 hook 完全不存在于时钟的订阅表里。`lastUpdate = clock.now()` 是这套节流算法的基准点。注意它在**每次 effect 重建时都会被重置**，所以改了 `intervalMs` 之后，计时从当前时刻重新开始，不会「补发」之前欠的次数。

### 3.3 第 84–90 行：自己数拍子

```ts
// annotated/src/ink/hooks/use-interval.ts:84-90
    const onChange = (): void => {
      const now = clock.now()
      if (now - lastUpdate >= intervalMs) {
        lastUpdate = now
        callbackRef.current()
      }
    }
```

每次 Clock tick（16ms）都会调 `onChange`，但只有「距上次触发够了 `intervalMs`」才真正执行回调。这就是「定时器 hook」和「裸 `setInterval`」在算法上的根本差别：**`setInterval` 让系统替你计时，这里是自己数**。

副作用是精度：触发时刻必然落在 16ms 的网格上。按代码推演，`intervalMs = 100` 时实际间隔约 112ms（第 7 个 tick 才满足 `>= 100`），而且因为写的是 `lastUpdate = now` 而不是 `lastUpdate += intervalMs`，误差**不会**累积成漂移，只会稳定在这套网格上。

### 3.4 第 92–93 行：交回退订函数

```ts
// annotated/src/ink/hooks/use-interval.ts:92-93
    return clock.subscribe(onChange, false)
  }, [clock, intervalMs])
```

`clock.subscribe` 返回一个函数，把它交给 React 当 cleanup，于是「依赖变化 / 卸载」时自动退订。第二个参数 `false` 是 `keepAlive`，下一节专讲。

## 4. 为什么是 `clock?.now() ?? 0`

路线图说的「第 15 行」是**原文**的行号，对应批注版第 22 行：

```ts
// annotated/src/ink/hooks/use-interval.ts:22
  const [time, setTime] = useState(() => clock?.now() ?? 0)
```

三个问题依次回答：

**为什么 `clock` 可能是 null？** 因为 [`ClockContext.tsx`](../../annotated/src/ink/components/ClockContext.tsx#L99) 第 99 行是 `createContext<Clock | null>(null)`——默认值就是 null。任何没被 `ClockProvider` 包住的组件，`useContext` 拿到的就是 null。这不是异常路径，是「组件可以脱离 Provider 单独渲染/测试」的正常设计。

**为什么必须在 `useState` 里兜，而不是 effect 里？** 惰性初始化函数在**第一次渲染时**就执行，比任何 effect 都早。此时还没有机会「等 Provider 就绪」，所以第一帧的初始值必须自己给。若写成 `clock!.now()`，脱离 Provider 就直接崩——一个纯展示组件不该因为没包 Provider 就白屏。

**为什么 `??` 不是 `||`，为什么兜底值是 0？** Clock 的时间本质是 `Date.now() - startTime`，而 `startTime` 在第一次 `now()` 时才被设成 `Date.now()`（`ClockContext.tsx` 第 60–63 行），所以「时钟刚起步」的合法值**恰好就是 0**。0 不是魔术数，是时间轴的原点；用 `||` 会把合法的 0 当缺失值，语义就错了。

## 5. 「每帧都重渲染」的隐患，到底有没有

路线图问「第 67 行里有没有每帧都重渲染的隐患」——原文第 67 行是文件的最后一个 `}`，也就是 `useInterval` 的收尾。所以这个问题实际问的是**整个 `useInterval`**。如实分析：

1. **`useInterval` 自己不会引起任何重渲染。** 它没有 `useState`，返回值是 `void`。每次 tick 它只做一次 `clock.now()` 调用和一次减法比较，成本 O(1)。这是 `grep` 能直接证明的（第 8 节 8.1）。
2. **重渲染来自 `callback`。** 回调里 `setState` 多少次，就重渲染多少次；频率由调用方传的 `intervalMs` 决定，hook 不背这个锅。
3. **真正的风险在兄弟 hook `useAnimationTimer`。** 它每次触发都 `setTime(now)`，而 `now` 每次都不同，所以必定重渲染。如果 `intervalMs` 传得比 tick 间隔还小（≤16），条件每帧成立 → **每帧一次 setState → 每帧重渲染**。这不是 bug，是「按需求驱动」：要 60fps 的动画就得付这个代价。
4. **还有个隐性成本**：Clock 每 16ms 遍历所有订阅者（`tick()` 第 31–33 行）。订阅者越多，每帧固定开销越大——即使它们都不触发回调。所以「合并定时器」省的是唤醒次数，不是订阅者数量。

结论：**`useInterval` 本身没有每帧重渲染隐患；隐患在「传多小的 `intervalMs`」和「回调里干了什么」**。读这类 hook，别停在「它有没有 state」，要顺着「谁会 setState」往上追一层。

## 6. 核心问题（路线图原卡片）

**卡片原文**：「问题：第 15 行 `clock?.now() ?? 0` 为什么要可空？第 67 行里有没有『每帧都重渲染』的隐患？自测：说出『定时器 hook』和『`setInterval` 直接用』的三点区别。」

**完整解答**：

1. **可空的原因**：`ClockContext` 的默认值就是 `null`（第 99 行），没有 Provider 时 `useContext` 返回 null；而 `useState` 的惰性初始化发生在首帧，没法等 Provider。兜底 `0` 是时钟的原点（`Date.now() - startTime` 起步即 0），不是随便挑的占位符。
2. **重渲染隐患**：`useInterval` 无 state、返回 `void`，自己不触发重渲染；`useAnimationTimer` 在 `intervalMs ≤ 16` 时才会每帧 `setTime`。风险取决于参数与回调，不取决于 hook 结构。
3. **三点区别**：① 不自己起 `setInterval`，挂在单个共享 Clock 上（一次唤醒、同一时间快照）；② 回调走 ref、不进依赖，依赖变化时先退订再订阅（先清后建）；③ 可暂停（`intervalMs = null` 或不在 Provider 内），且暂停期间不占订阅表。

## 7. 常见误读

**一、以为「没传 `null` 就一定会跑」。** 还有第二道闸：`keepAlive` 传的是 `false`（第 92 行），而 Clock 只在「订阅者里至少有一个 `true`」时才维持 `setInterval`（第 36 行）。所以**一个页面如果只有 `useInterval`、没有动画在跑，它可能永远不触发**。第 13–19 行的注释专门警告过这个坑。

**二、以为它和 `usehooks-ts` 的 `useInterval` 是一回事。** 仓库里五处 `useInterval(...)` 调用**全部** import 自 `usehooks-ts`（第 8 节 8.2），那个版本是自己 `setInterval` 的。ink 这个版本是「搭便车」的，两者语义不同。

**三、以为精度就是 `intervalMs`。** 实际精度被 Clock 的 16ms tick 网格量化，`intervalMs = 100` 大约 112ms。要精确计时不能用它。

## 8. 动手验证

**8.1 `useInterval` 里到底有没有 state**

```bash
grep -n "useState\|setTime" annotated/src/ink/hooks/use-interval.ts
```

```
1:import { useContext, useEffect, useRef, useState } from 'react'
22:  const [time, setTime] = useState(() => clock?.now() ?? 0)
33:        setTime(now)
```

三处 `useState`／`setTime` **全部**在第 20–44 行的 `useAnimationTimer` 里；`useInterval`（第 62–94 行）一处都没有。这就是「它自己不重渲染」的硬证据。

**8.2 谁在用它（注意 import 来源）**

```bash
grep -rn "import.*useInterval" annotated/src
```

```
annotated/src/components/messages/SystemAPIErrorMessage.tsx:22:import { useInterval } from 'usehooks-ts';
annotated/src/hooks/notifs/useLspInitializationNotification.tsx:3:import { useInterval } from 'usehooks-ts';
annotated/src/hooks/useInboxPoller.ts:3:import { useInterval } from 'usehooks-ts'
annotated/src/hooks/useMemoryUsage.ts:2:import { useInterval } from 'usehooks-ts'
annotated/src/hooks/useSwarmPermissionPoller.ts:14:import { useInterval } from 'usehooks-ts'
```

**五处全部来自 `usehooks-ts`**，没有一个用 ink 这个版本。它只被 `source/src/ink.ts` 第 76 行作为 ink 的公开 API 导出（`export { useAnimationTimer, useInterval } from './ink/hooks/use-interval.js'`）。所以读它的时候要分清：**这是「库的接口」，不是「应用的热路径」**。

**8.3 `keepAlive` 的两副面孔**

```bash
grep -n "subscribe(onChange" annotated/src/ink/hooks/use-animation-frame.ts annotated/src/ink/hooks/use-interval.ts
```

```
annotated/src/ink/hooks/use-animation-frame.ts:66:    return clock.subscribe(onChange, true)
annotated/src/ink/hooks/use-interval.ts:37:    return clock.subscribe(onChange, false)
annotated/src/ink/hooks/use-interval.ts:92:    return clock.subscribe(onChange, false)
```

只有 `use-animation-frame.ts` 那条是 `true`——全仓唯一「负责驱动时钟」的地方。

**8.4 默认值确实是 null**

```bash
grep -n "createContext" annotated/src/ink/components/ClockContext.tsx
```

```
2:import React, { createContext, useEffect, useState } from 'react';
99:export const ClockContext = createContext<Clock | null>(null);
```

第 99 行就是 `clock?.` 里那个 `?` 的全部理由。

## 9. 合书自测

**1.** `useInterval` 和直接 `setInterval` 的三点区别是什么？

<details><summary>参考答案</summary>
① 挂在单个共享 Clock 上，不自己起定时器（一次唤醒、同一时间快照）；② 回调走 ref 不进依赖，依赖变化时先退订再订阅；③ 可暂停（`intervalMs = null` 直接 return），暂停期间不在订阅表里。
</details>

**2.** `clock?.now() ?? 0` 里的 `?.` 在什么情况下真的会短路？

<details><summary>参考答案</summary>
组件没有被 `ClockProvider` 包住时。`ClockContext` 的默认值是 `null`（第 99 行），`useContext` 直接返回它。
</details>

**3.** 为什么兜底值是 `0`，而不是 `-1` 或 `Date.now()`？

<details><summary>参考答案</summary>
Clock 的时间是 `Date.now() - startTime`，`startTime` 在首次 `now()` 时被设为当下，所以「刚起步」的合法值就是 0——它是时间原点，不是占位符。用 `-1` 表示「未开始」会和真实值混淆，用 `Date.now()` 则和 Clock 的时间轴不是同一个基准。
</details>

**4.** `useInterval` 会每帧重渲染吗？谁才可能每帧重渲染？

<details><summary>参考答案</summary>
不会——它没有 state、返回 `void`，只做一次减法比较。可能每帧重渲染的是 `useAnimationTimer`：`intervalMs ≤ 16` 时每个 tick 都满足条件，每帧 `setTime`。
</details>

**5.** `intervalMs` 传 100，实际多久触发一次？为什么不是 100？

<details><summary>参考答案</summary>
约 112ms。Clock 每 16ms tick 一次，`now - lastUpdate >= 100` 在第 7 个 tick（112ms）才成立。触发时刻被量化到 tick 网格上。
</details>

**6.** 只有 `useInterval`、页面上没有任何动画，会发生什么？

<details><summary>参考答案</summary>
可能永远不触发。`useInterval` 订阅时传 `keepAlive: false`，Clock 的 `updateInterval` 只有在「存在 `true` 订阅者」时才维持 `setInterval`。没有驱动者，时钟就不跑。
</details>

## 10. 下一步：L2 结束，进 L3

- **L2 过关标准**：[`docs/00-零基础学习路线.md`](../00-零基础学习路线.md) 的「L2 过关标准」——给你一个 60–150 行的新文件，30 分钟内说出「入口函数是哪个、它调了谁、数据怎么流」。
- **进 L3（小模块协作）**：同一份路线图的「L3 · 小模块协作」一节，从 `commands/clear/` 四件套开始，第一次同时看多个文件，只学一件事——**谁引用谁**。
- **回看本层**：[`L2-04`](./L2-04-纯算法wrap-text.md)（纯函数）、[`L2-05`](./L2-05-交互原语useDoublePress.md)（ref 与 state 的选型）。
- **想读时钟的全部细节**：[`annotated/src/ink/components/ClockContext.tsx`](../../annotated/src/ink/components/ClockContext.tsx)（`tick`、`updateInterval`、`now` 三个函数就是全部）。
