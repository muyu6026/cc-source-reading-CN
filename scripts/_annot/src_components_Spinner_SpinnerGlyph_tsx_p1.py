# -*- coding: utf-8 -*-
# annotations for src/components/Spinner/SpinnerGlyph.tsx (80 lines)
ANNOTATIONS = [
    (6, 'before', 'DEFAULT_CHARACTERS 在模块加载时求值一次：字符表取决于 TERM 与平台，运行期不会变'),
    (7, 'after', 'SPINNER_FRAMES 是正向加反向拼接：六帧正放再六帧倒放，视觉上是来回摆动而不是循环跳回'),
    (8, 'after', 'reducedMotion 模式只用一个实心点，不用字符动画'),
    (9, 'after', '两秒一周期：一秒亮一秒暗，取 time 的一半判奇偶即得明暗'),
    (10, 'after', 'ERROR_RED 是固定深红 RGB（171 43 63）：卡顿渐变的终点色，不取主题色以免主题切换时终点漂移'),
    (22, 'before', 'SpinnerGlyph：单帧 spinner 字符的渲染，三条分支——减动效、卡顿渐变、常规'),
    (37, 'after', 'isDim 由时间算出：每半周期翻转一次，纯函数不存 state'),
    (49, 'after', '取模取帧：frame 可无限增长，索引永远落在字符表内'),
    (54, 'after', '卡顿渐变：把消息色与 ERROR_RED 按 intensity 插值——前提是主题色能解析成 RGB'),
    (57, 'after', '解析不出 RGB 时的降级：强度过半直接切 error 语义色，否则保持原色——两档而非连续渐变'),
    (71, 'after', '常规分支：字符直接用 messageColor，不加 dim'),
]
