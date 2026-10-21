# -*- coding: utf-8 -*-
"""compactWarningHook.ts 批注：为什么一个 6 行的 hook 要单独一个文件。"""

ANNOTATIONS = [
(1, 'before', '''// ═══════════════════════════════════════════════════════════════
// 第 6 步 · 服务层 · 补小件 5/6 —— 压缩警告的 React hook
//                                （src/services/compact/compactWarningHook.ts，16 行）
//
// 这个文件**只有 6 行有效代码**。它存在的唯一理由是分隔依赖 ——
// 而那条理由值得单独看，因为它是一个常被忽略的性能/启动路径问题。
// ═══════════════════════════════════════════════════════════════'''),

(4, 'before', '''// 【核心：为什么 React 必须被隔离在这个文件里】
//
//   "Lives in its own file so that compactWarningState.ts stays React-free:
//    microCompact.ts imports the pure state functions, and pulling React
//    into that module graph would drag it into the print-mode startup path."
//
// ── 链条还原 ──
//
//   microCompact.ts  ──import──>  compactWarningState.ts（纯状态，无 React）
//                                        ▲
//                                        │ 如果 hook 和 state 写在同一个文件
//                                        │
//   compactWarningHook.ts ──import──>  （同一文件）→ 于是也牵进 React
//
//   一旦 state 文件顶部出现 `import { useSyncExternalStore } from 'react'`，
//   那么**任何** import 了这个 state 文件的模块，都会把整个 React
//   拖进自己的依赖图 —— 哪怕它一次都不用 hook。
//
// ── 后果具体是什么 ──
//
//   `microCompact.ts` 被 **print mode**（`claude -p "..."`）的启动路径引用。
//   print mode 是非交互的一次性执行：不需要任何 UI、不需要 React、
//   启动速度直接影响体验（每次调用都要付启动成本）。
//
//   把 React 拖进去的代价：
//     · 启动时要加载并初始化 React（几十毫秒到上百毫秒）
//     · 内存占用（React 的模块级对象）
//     · 打包产物变大
//
//   而这一切只为了一个 UI 布尔量 —— 而 print mode 里根本没有 UI。
//
// ── 这个模式叫什么 ──
//
//   依赖隔离 / 分层。但关键点不是"分层"这个名词，而是：
//   **依赖是传递的、不可见的**。你在 A 文件写一行 import，
//   影响的是所有 import 了 A 的地方，而不是 A 自己。
//
//   所以"这个文件该不该 import React"从来不是关于这个文件的问题，
//   是关于**谁会 import 这个文件**的问题。
//
// ── 怎么在真实项目里发现这类问题 ──
//
//   · 看启动耗时：某个 CLI 命令启动慢，但功能简单 → 怀疑依赖图
//   · 看打包产物：某个 chunk 里出现了不可能用到的库
//   · 静态分析：找出"被非 UI 模块 import 但依赖了 UI 库"的文件
//
//   这三个信号里，最实用的是第二个 —— 打包器的产物分析能直接
//   画出依赖图，比人肉追 import 靠谱得多。'''),

(11, 'before', '''// `useSyncExternalStore` 是 React 18 引入的官方 API，
// 专门用来订阅**外部**（React 之外）的可变状态。
//
// 【为什么必须用它，不能 useState + useEffect】
//
//   经典错误写法：
//       const [v, setV] = useState(store.getState())
//       useEffect(() => store.subscribe(() => setV(store.getState())), [])
//
//   这个写法的两个问题：
//     ① 首次渲染和订阅之间有一个**空档**：如果状态在这期间变了，
//        组件永远看不到那次变化（称为 tearing / 丢更新）
//     ② 并发渲染下，多个组件可能读到不同时刻的值（不一致）
//
//   `useSyncExternalStore` 就是为这两个问题设计的：它在渲染阶段
//   同步读取快照，保证同一次渲染里所有组件看到同一个值。
//
// 【这也是为什么 store 必须先做成"subscribe + getState"的形状】
//   上一个文件里 `createStore` 那个自研实现，接口就是照
//   useSyncExternalStore 的要求设计的 —— 先有消费方的约束，才有生产方的形状。'''),

(13, 'after', '''// 三行，没有 dependencies 数组、没有 cleanup、没有 memo。
//
// 【这个简洁是有代价换来的】
//
//   它把三件事都推给了调用方：
//     ① 订阅/取消订阅 → 由 useSyncExternalStore 内部管
//     ② 何时重渲染    → 由 getState 返回值的引用比较决定（布尔量天然稳定）
//     ③ 状态本身      → 由 createStore 那个自研实现管
//
//   如果 store 返回的是对象而不是布尔量，这里就会每次渲染都触发更新
//   （新对象引用不相等）。用 boolean 是刻意的选择，不是偶然。
//
//   【可迁移】把状态设计成 primitive（布尔 / 数字 / 字符串）而不是对象，
//   能免掉一大类浅比较、memo、useMemo 的麻烦。'''),

]
