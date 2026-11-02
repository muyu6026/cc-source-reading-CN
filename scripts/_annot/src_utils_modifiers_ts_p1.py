# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''本文件封装 macOS 原生修饰键检测模块 modifiers-napi 的加载与调用，提供预热与同步查询接口，且仅在 darwin 平台生效。'''),
    (9, 'before', '''prewarmModifiers：提前加载原生模块以避免首次使用时的延迟。非 darwin 平台或已预热则直接返回；加载失败静默忽略。'''),
    (27, 'before', '''isModifierPressed：同步查询某个修饰键（shift / command / control / option）当前是否被按住。非 darwin 平台直接返回 false；通过动态 require 避免顶层加载原生模块。'''),
]
