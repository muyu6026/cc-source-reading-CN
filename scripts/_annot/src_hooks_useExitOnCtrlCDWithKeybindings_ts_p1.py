# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (18, 'before', '''// 便利封装：把 useExitOnCtrlCD 与 useKeybindings 接好，是组件里用退出双按的标准入口。'''),
    (23, 'after', '''// 拆分是为避 import 循环：useExitOnCtrlCD 不直接引 keybindings 模块，这里再注入。'''),
]
