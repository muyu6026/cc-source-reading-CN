# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (10, 'after', '''// 三个 prop 对应三条降级路径：
//
//   children     链接文字（不给就用 url 本身）
//   url          OSC 8 的目标
//   fallback     不支持超链接时显示什么（默认还是链接文字）
//
// 支持时走 `<ink-link href>`，外面**必须**包一层 Text —— ink-link 是
// 文本类节点（像 ink-text 一样挂在父 Text 里），不能直接放 Box。'''),
    (19, 'after', '''// 【supportsHyperlinks() 在渲染期调用】
//
// 它读环境变量（TERM_PROGRAM / VTE_VERSION / TERM…），是同步的纯查询，
// 所以放渲染期没问题。但要注意：**每次渲染都查一次**，不是缓存。
// 对一个充满链接的长列表，这是每帧几百次 env 读 —— 成本不高（对象属性
// 访问），但确实存在。
//
// 判断依据在 supports-hyperlinks.ts：GUI 终端基本都支持，
// Linux 控制台和部分老终端不支持 → 走 fallback。'''),
    (30, 'after', '''// 不支持时也还是渲染成 Text（而不是裸字符串），因为它可能被放在
// 任何地方，而裸字符串只有在 Text 内部才合法。'''),
]
