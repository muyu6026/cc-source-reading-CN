# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (18, 'after', '''// 【为什么要有这一层，而不是直接给每个事件类写 target/bubbles】
//
// 因为**冒泡需要一条链**，而链上的每个节点都要能回答「我有没有这个
// 事件的 handler」。把这三件东西（type / phase / 传播控制）收在一个
// 基类里，Dispatcher 就只认这一个类型 —— dispatcher.ts 的参数写的是
// TerminalEvent，不是 Event。这是「用类型把契约钉住」的做法：
// 想让一个事件走 DOM 派发，必须继承它，没有第二条路。'''),
    (34, 'after', '''// performance.now() 而不是 Date.now()：前者单调递增，不受系统时钟
// 调整（NTP 校时、用户手动改时间、笔记本休眠唤醒）影响。
// 事件时间戳会被用来做「两次点击间隔」这类判断，回拨一次时钟就可能
// 让间隔变成负数。'''),
    (35, 'after', '''// 注意这里的默认值和浏览器**相反**：DOM 的 Event 默认 bubbles = false，
// 这里默认 true。不是笔误 —— 终端事件几乎全都希望冒泡到根（
// onKeyDown 挂在顶层容器上是常见写法），逐个写 bubbles: true 只会
// 更容易漏。少数不冒泡的（hover）干脆不进这个类，走 hit-test 手写。'''),
    (59, 'after', '''// 这一行是「两个标志必须同时置」的地方。super 把基类的
// _didStopImmediatePropagation 置上（emitter 读那个），这里再把
// _propagationStopped 置上（Dispatcher 读这个）。为什么不在基类里
// 合成一个？因为基类的 Event 不认识「冒泡」这个概念 —— 它服务的
// 是 EventEmitter，那个东西根本没有树。'''),
    (64, 'after', '''// cancelable 为 false 时 preventDefault 静默无效 —— 和 DOM 一致。
// 这不是形式主义：KeyboardEvent 是可取消的，而 Tab 键的「默认行为」
// 是切换焦点，判据就是 event.defaultPrevented（见 ink.tsx:1276）。
// 如果这里无条件置位，任何一次 preventDefault 都会吞掉 Tab 导航。'''),
    (101, 'after', '''// ⚠️ 这个钩子**全仓库零覆写**。Dispatcher 在每个监听者触发前都调它
// （processDispatchQueue 第 104 行），但没有任何子类实现。
//
// 它是给「事件对象需要按节点做准备工作」留的位置 —— 典型场景是
// ClickEvent 的 localCol/localRow（相对当前 handler 的坐标）。
// 那个需求真实存在，只是最后没走这条路：点击根本没进 Dispatcher，
// 而是在 hit-test.ts 的 dispatchClick 里手写了一个 while 循环，
// 顺手把坐标算在循环里。
//
// 所以这是「扩展点建好了、需求从旁边绕过去了」的样本。留着不算错，
// 但它让人读 Dispatcher 时误以为有子类在用。'''),
    (104, 'after', '''// EventTarget 故意写得比 DOM 的窄得多：只要「能往上走」和「能存
// handler」两件事。_eventHandlers 用 Record<string, unknown> 而不是
// EventHandlerProps，是为了不让这个底层文件依赖上层的 props 类型
// （那会绕回 components/，形成循环 import）。代价是取出来时每处都得
// 自己断言一次类型 —— dispatcher.ts:33 和 hit-test.ts:72 都有自己的 as。'''),
]
