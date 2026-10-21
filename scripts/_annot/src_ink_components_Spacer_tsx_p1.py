# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (8, 'after', '''// 无 props 的组件，所以 React Compiler 用了 `Symbol.for("react.memo_cache_sentinel")`
// 这个哨兵来判断「第一次渲染」。元素只创建一次，之后永远复用同一个
// React element 对象。
//
// 顺带解释 `flexGrow={1}` 的两个用途，读代码时容易只想到第一个：
//   · 一行里两个元素之间插一个 Spacer → 把后面的推到右边
//   · 在 ScrollBox 的内容容器里（flexDirection: column）插一个 →
//     把后面的内容推到底部（内容比视口短时）'''),
]
