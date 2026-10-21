# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (44, 'after', '''// 【默认值里有一个真的 EventEmitter】
//
// 这不是占位符：`new EventEmitter()` 是**模块级单例**，在 Ink 树外
// 调用 useInput 时，监听者会真实地挂到它上面。
//
// 后果：useInput 在树外不报错、不警告，只是永远收不到输入。
// 排查时的表现是「这个组件的键盘没反应」，而代码看起来完全正常。
//
// 三个 internal_ 字段（exitOnCtrlC / eventEmitter / querier）都是
// 内部约定，但 useInput、useTabStatus、useSelection 全都依赖它们 ——
// 公开 API 建在未公开字段上，这在库里很常见，代价是重构时没有
// 类型层面的保护（它们只是 StdinContext 的字段，改名就全改）。'''),
]
