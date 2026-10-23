# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (9, 'after', '''// 块注释：选区完成（拖拽松手 / 多击选词行）自动复制到剪贴板（仿 iTerm2）；只留高亮不动，让用户看见复制了什么；仅在 alt-screen 模式生效——原生终端选区时本 hook 经 ink stub 成 no-op。'''),
    (39, 'after', '''// onCopied 每次渲染都是新闭包，经 onCopiedRef 读，避免 effect 依赖变化重订阅（重订阅会经 unmount 重置 copiedRef，破坏防双触发）。'''),
    (69, 'after', '''// 默认开启：macOS 下 cmd+c 被终端 Edit>Copy 拦截（鼠标追踪禁了原生选区），auto-copy 让剪贴板保留正确内容使 paste 正常工作。'''),
    (82, 'after', '''// 订阅状态机四态：isDragging（等 finish 重置 copiedRef）/ !has（重置）/ 已 copied（防 spurious 双触发）/ 最终 copySelectionNoClear + onCopiedRef.current?.(text)。'''),
    (98, 'after', '''// useSelectionBgColor：把主题 selectionBg 注入 Ink StylePool 以替代 SGR-7 反显（Ink 主题不可知，这是桥）；mount 与 /theme 翻转时重设，选区色实时跟随主题。'''),
]
