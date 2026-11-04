# -*- coding: utf-8 -*-
# annotations for src/components/MessageResponse.tsx (78 lines)
ANNOTATIONS = [
    (10, 'before', 'MessageResponse：给响应内容加行首的 ⎿ 前缀，并保证同一响应块内不重复加'),
    (16, 'after', '读上下文判断自己是否已在另一个 MessageResponse 里：是则直接返回 children，避免层层嵌套 ⎿'),
    (22, 'after', '前缀包在 NoSelect 里：鼠标选中复制时不会被带上；flexShrink 为 0 保证不被压缩'),
    (29, 'after', '内容区 flexShrink 1 加 flexGrow 1：占满剩余宽度，长行可以换行'),
    (37, 'after', 'Provider 包住整个响应块：内部再出现的 MessageResponse 会读到 true'),
    (45, 'after', '给了 height 就直接返回：固定高度的场景不需要棘轮，高度由外部控制'),
    (50, 'after', '没给 height 时套 Ratchet 且 lock 为 offscreen：滚动出屏才锁高，流式追加时不抖动'),
    (62, 'after', 'MessageResponseContext 默认 false：最外层永远会画 ⎿'),
    (70, 'after', 'Provider 组件只负责把 value 置 true，children 原样透传'),
]
