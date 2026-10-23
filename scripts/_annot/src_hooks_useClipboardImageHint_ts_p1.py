# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (10, 'after', '''// 三个常量：通知 key 固定为 clipboard-image-hint；FOCUS_CHECK_DEBOUNCE_MS=1s 防抖快速焦点变化；HINT_COOLDOWN_MS=30s 冷却防 spam。'''),
    (12, 'after', '''// 块注释：终端重新获得焦点且剪贴板含图片时显示提示；isFocused 当前聚焦态，enabled 即 image paste 开（onImagePaste 已定义）。'''),
    (22, 'after', '''// 返回 void，纯副作用；isFocused 变化触发（effect dep），enabled 为 image paste 开关。'''),
    (35, 'after', '''// 仅 unfocused→focused 转变触发：lastFocusedRef 跟踪上次态，wasFocused 即当前聚焦则 return（避免重复或失焦触发）。'''),
    (68, 'after', '''// 1s 防抖批处理快速焦点变化；冷却 30s 防 spam；hasImageInClipboard（async osascript 调用）命中则发 8s 提示（含 getShortcutDisplay 拼出的 paste 快捷键）。'''),
]
