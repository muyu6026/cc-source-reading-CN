# -*- coding: utf-8 -*-
# annotations for src/components/design-system/ProgressBar.tsx (86 lines)
ANNOTATIONS = [
    (5, 'before', 'ProgressBar 的 props：ratio 规定在 0 到 1，width 是字符宽，fillColor 与 emptyColor 可选'),
    (26, 'before', 'BLOCKS 是九级部分块字符（空格到全块）：用八分之一块的粒度画出亚字符精度'),
    (35, 'after', 'ratio 先夹紧到 0 到 1：外部传入越界值也不会画出负宽或超宽'),
    (36, 'after', 'whole 是整块个数：ratio 乘 width 向下取整'),
    (39, 'after', '满块段用最后一级字符（全块）重复 whole 次'),
    (48, 'after', '未满一格时补一个部分块：remainder 乘 BLOCKS 长度取整，决定画 ▏▎▍▌▋▊▉ 里的哪一个'),
    (52, 'after', 'empty 等于 width 减 whole 再减 1：那个部分块已经占掉一格'),
    (76, 'after', '空段用 backgroundColor 加空格实现，而不是画浅色字符——背景色块不受字体字符宽度影响，对齐更稳'),
]
