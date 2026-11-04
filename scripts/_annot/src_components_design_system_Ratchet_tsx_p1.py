# -*- coding: utf-8 -*-
# annotations for src/components/design-system/Ratchet.tsx (80 lines)
ANNOTATIONS = [
    (10, 'before', 'Ratchet：只增不减的高度棘轮——内容长到多高就锁住多高，避免流式输出时整屏布局抖动'),
    (16, 'after', 'lock 默认 always；offscreen 表示只在滚出视口时才锁'),
    (17, 'after', 'useTerminalViewport 同时给出 ref 与 isVisible'),
    (24, 'after', 'innerRef 用来量内容真实高度；maxHeight 用 ref 存历史最大值（不触发渲染）'),
    (29, 'after', 'outerRef 把 viewport 的 ref 回调包一层：编译器对 useCallback 的缓存展开'),
    (38, 'after', 'engaged：always 恒真；offscreen 时只在内容不可见时生效'),
    (47, 'after', 'measureElement 量真实高度，只有比历史最大值更大才更新状态'),
    (49, 'after', 'Math.min(height, rows)：棘轮上限不超过一屏，防止内容把终端顶穿'),
    (59, 'after', 'minHeight 只在 engaged 时生效，否则给 undefined 让高度自然塌缩'),
    (70, 'after', '外层 Box 用 minHeight 撑住，内层 Box 承载真实内容——撑高的是外壳，内容照旧'),
]
