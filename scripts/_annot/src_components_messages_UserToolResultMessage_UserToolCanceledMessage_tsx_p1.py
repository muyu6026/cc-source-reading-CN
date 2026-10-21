# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// 【和 RejectedToolUseMessage 几乎完全一样，但语义不同】
//
//      RejectedToolUseMessage   「工具调用被拒绝」—— 权限框点了 No
//      UserToolCanceledMessage  「被用户打断」  —— 执行中按了 Esc
//
//  两者都渲染成 MessageResponse 里的一行，但文案一个是
//  「Tool use rejected」，一个是 InterruptedByUser 组件（那条虚线）。
//
//  为什么不合并成一个带文案参数的组件？
//  因为**不同的文案对应不同的语义**，合并之后调用点会变成
//  `<OneLineMessage text="…" />` —— 文案离开定义处，grep 就不好找了。
//
//  这条取舍值得记住：**当两个组件只差一句文案时，
//  分成两个未必是坏设计**（尤其文案同时是「搜代码的入口」时）。'''),

    (8, 'before', '''// 【它 import 的是 `src/components/InterruptedByUser.js`（绝对路径）】
//
//  而同目录的其它文件用的是 `../../../ink.js` 这类相对路径。
//  同一个文件里混用两种路径风格，说明它们是**不同时期写的**
//  （或者由不同的人写的）。
//
//  这不是问题，但在产物里很常见：绝对路径 src/... 通常出现在
//  后来修改过的 import 上（IDE 自动补全默认用 tsconfig 的 baseUrl）。
//
//  读的时候只要注意别以为是两个不同模块。'''),
]
