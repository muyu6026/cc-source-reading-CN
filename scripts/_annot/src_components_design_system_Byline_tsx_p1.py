# -*- coding: utf-8 -*-
# annotations for src/components/design-system/Byline.tsx (77 lines)
ANNOTATIONS = [
    (4, 'before', 'Props 只有 children：需要串联的若干项'),
    (9, 'before', 'doc 注释解释命名来源（出版业的 byline 署名行），并强调自动过滤 null/undefined/false，分隔符只出现在有效元素之间'),
    (45, 'after', 'early_return_sentinel：编译器把提前 return 重写成哨兵值加 break bb0，配合后面的 t2 判断'),
    (47, 'after', 'Children.toArray 会滤掉 null/undefined/布尔：这正是「条件子元素只剩一项时不出现多余分隔符」的实现基础'),
    (48, 'after', '没有有效子元素时整体返回 null，调用方不必自己判空'),
    (52, 'after', 'map 出带分隔符的片段序列'),
    (61, 'after', '哨兵比对成立说明走了提前 return，直接返回 null'),
    (75, 'after', '_temp 负责加分隔符：index 大于 0 才加中间点，key 优先用子元素自带的 key 否则用下标'),
]
