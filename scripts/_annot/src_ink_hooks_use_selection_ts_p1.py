# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (13, 'after', '''// 这个 hook 的返回类型是一张**平铺的方法表**，不是「返回 state」。
// 原因在实现里：所有状态都活在 Ink 实例上（selection.ts 那个可变对象），
// React 这边只是个转发层。所以这里既没有 useState 也没有 reducer，
// 只有一堆 `() => ink.xxx()`。
//
// 好处：拖选是每帧都在变的高频状态，走 React state 会把每次鼠标移动
// 变成一次重渲染。走实例 + 屏幕缓冲改写，React 只在「有没有选区」
// 这种粗粒度变化时才被通知（useHasSelection）。'''),
    (50, 'after', '''// 这一行看着莫名其妙：调用 useContext 但把返回值丢掉。
//
// 作者的原话是「anchor to App subtree for hook rules」。能确定的实际
// 效果有两个，两个都有代价：
//
//   1. 建立了一条**真实的** context 订阅。而 App.render 里
//      StdinContext 的 value 是**内联对象字面量**（App.tsx:162），
//      每次 App 重渲染都是新引用 → 这个组件跟着重渲染。
//      「锚定」不是无成本的
//   2. hook 调用顺序里多占一个槽位
//
// 能确定的**没有**发生的：它没有解决「拿不到 ink 实例」的问题 ——
// 第 51 行取的是 instances 表，跟 context 无关。所以这行的作用
// 老实说是「保证这个 hook 被用在 Ink 树里」的运行时声明，
// 而拿不到实例时仍然静默降级（见下一条）。'''),
    (51, 'after', '''// 【单实例假设】
//
// instances 是用 **stdout** 做键的表（见 instances.ts），而这里用
// process.stdout 去取 —— 假设「一个进程只有一个 Ink 实例，且挂在
// 标准输出上」。测试或多实例场景（比如一个进程里跑两个 ink 树、
// 或者把 ink 输出到自定义 stream）取不到，于是所有方法退化成空实现，
// **不报错**。这是「静默降级」：好处是不会崩，坏处是排查时没有任何信号。
//
// useToggleMcpServer 那一类 hook 用的是同一套取法，所以约束是全局的。'''),
    (86, 'after', '''// 依赖只有 ink。注释说得很清楚：ink 是 per-stdout 的单例，跨渲染稳定。
// 所以这张表在整个生命周期里**只创建一次** —— 调用方可以把它放进
// 依赖数组而不引起循环重渲染（这是 useMemo 的主要目的，不是省分配）。'''),
    (99, 'after', '''// ⚠️ 这里有两处**直接传裸方法**给 useSyncExternalStore：
//
//     ink.subscribeToSelectionChange      （用到 this.selectionListeners）
//     ink.hasTextSelection                （用到 this.selection）
//
// 而 ink.tsx 里这两个都是**原型方法**（`hasTextSelection(): boolean {`，
// 不是箭头函数类字段）。React 调用 getSnapshot() 时没有接收者，
// 严格模式下 this 是 undefined，读 this.selection 会抛 TypeError。
//
// 同一份文件上面第 71-84 行，作者对每个方法都包了一层箭头函数
// （`() => ink.hasTextSelection()`）—— 唯独这里没包。要么 Ink 的方法
// 在实际构建里被绑定过（源码看不出这一点），要么这是一处潜伏的崩溃。
// 光读源码无法判定，但**这种不一致本身就是信号**：同文件里两种写法
// 并存时，其中一种通常是漏了。
//
// 对照：useSearchHighlight / useSelection 的非 hook 版本全都包了箭头。'''),
    (104, 'after', '''// 兜底用的两个常量函数放在模块级，不是每次渲染现造 ——
// useSyncExternalStore 的第二个参数（getSnapshot）如果每次都是新函数，
// React 会认为快照可能变了而反复重渲染。'''),
]
