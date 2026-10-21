# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (27, 'after', '''// 渲染错误界面的组件，本身必须是**绝不会失败**的 —— 所以它只用了
// Box / Text 两个最基础的东西，没有任何状态、没有 effect。
//
// 三块内容：错误消息、出错的那行源码、调用栈。下面按这三块标。'''),
    (51, 'after', '''// 【在 render 里同步读文件】
//
// 注释里给了理由："error overlay can't go async without suspense
// restructuring" —— 要异步就得用 Suspense 包起来，而 Suspense 的
// fallback 会先渲染一次空界面，错误界面闪一下反而更糟。
//
// 这一整段被 try 包住，读失败就跳过源码上下文（不显示而已）。
// 这也是错误界面的通则：**它显示的信息不全，远好过它自己崩掉**。'''),
    (60, 'after', '''// 第一行：红色底的 ERROR 徽章 + 消息。
//
// `{' '}` 包在 ERROR 两侧不是排版洁癖：背景色只铺在**有字符的格子**上，
// 所以 ` ERROR ` 里的两个空格必须是真的字符，否则红色块会紧贴字母。
//
// 下面两处 `backgroundColor={cond ? 'ansi:red' : undefined}` 显式传
// undefined 而不是省略 —— 这是内联对象字面量，省略键和传 undefined
// 在 diff 里最终等价（reconciler 会把「键消失」表达成 {key: undefined}），
// 显式写出来只是让「这一行有底色、其他行没有」这件事一眼可见。'''),
]
