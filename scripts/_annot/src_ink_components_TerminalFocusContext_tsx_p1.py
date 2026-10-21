# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (19, 'after', '''// 【用 useSyncExternalStore，而不是 context + setState】
//
// 焦点状态活在模块级的 terminal-focus-state.ts 里（一个 Map/Set of
// 订阅者 + 一个值），不活在 React state 里。理由和 selection 那一套
// 一样：变化源在 React 之外（stdin 来的 CSI I / CSI O），而且变化频率
// 不可控（切换窗口可能一瞬间多次）。
//
// 用 useSyncExternalStore 的好处是「只有真正订阅的组件重渲染」——
// App 不会因为切窗口而整树重画（见 App.tsx:385 的批注）。
//
// 注意这里**订阅了两次同一个 store**，一次取 boolean、一次取三态
// （'unknown' | 'focused' | 'unfocused'）。两个 getSnapshot 是不同
// 函数、返回不同值，所以两条订阅互不干扰 —— 只是多了一次 store 访问。'''),
]
