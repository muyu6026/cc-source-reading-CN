# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (42, 'before', '''// 【两条 effect，各管一件，不能合并】
//
//   useLayoutEffect  管 raw mode（开/关终端的逐字节模式）
//   useEffect        管监听者注册（挂到 internal_eventEmitter 上）
//
// 为什么 raw mode 必须用 layout：layout effect 在 React 的 commit 阶段
// **同步**跑，而 useEffect 会被调度到下一个 tick。用一个 tick 的窗口
// 就足够让终端的行规程把按键回显一遍 —— 用户看到自己敲的字闪一下，
// 光标也露出来了。注释里这段写得很具体，不是理论问题。
//
// 反过来监听者注册用普通 useEffect 就行：晚一个 tick 注册，只是
// 「这一 tick 里的按键收不到」，不会造成视觉问题。'''),
    (60, 'after', '''// raw mode 是**引用计数**的（App.rawModeEnabledCount），不是布尔开关。
// 所以这里放心地「挂载时 +1、卸载时 -1」，多个 useInput 同时存在
// 不会互相关掉。isActive === false 时干脆不计数 —— 否则一个
// 被禁用的输入框也会让终端停在 raw 模式，Ctrl+C 就交给应用而不是
// 交给 shell 了。
//
// 注意第 51 行的早退：isActive 为 false 时连 cleanup 都不返回。
// 这是对的（没加过就不该减），但读的时候容易以为漏了 cleanup。'''),
    (68, 'after', '''// 【为什么不把 isActive 放进下面那个 effect 的依赖里】
//
// EventEmitter 的监听顺序 = 注册顺序。如果 isActive 变化时重新注册，
// 这个监听者会被**追加到数组末尾** —— 于是它从「先注册者」变成了
// 「后注册者」，stopImmediatePropagation 的语义跟着变：
// 本来它能挡住后面的监听者，现在变成了被前面的人挡住。
//
// 正确做法是「注册一次，用闭包读最新的 isActive」。useEventCallback
// 提供稳定引用 + 最新闭包（它自己也靠 layout effect 同步，所以对
// React Compiler 是安全的）。
//
// 这是「顺序即契约」的又一例：数组下标被当成了优先级。'''),
    (80, 'after', '''// 这一行的布尔逻辑值得拆开看，因为它看着像「允许 ctrl+c」，
// 实际是**吞掉** ctrl+c：
//
//   !(input === 'c' && key.ctrl)   → 不是 ctrl+c，正常处理
//   !internal_exitOnCtrlC          → ctrl+c 但应用不负责退出，也正常处理
//
// 两个都不成立（= 是 ctrl+c 且 exitOnCtrlC 为 true）时，handler 不被调用。
// 也就是说：**exitOnCtrlC 为 true 时，组件收不到 ctrl+c**。
// 想在退出前做点事（比如存草稿），只能把 exitOnCtrlC 关掉自己处理 ——
// 这是个真实的行为约束，不在文档里，只在代码里。'''),
]
