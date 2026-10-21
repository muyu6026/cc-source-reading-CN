# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// 【用户按 ExitPlanMode 交上来的计划，在对话里长什么样】
//
//  它走的是「用户消息」通道（UserPlanMessage），因为计划是**用户**提交的 ——
//  哪怕内容是模型写的。这个区分很重要，后面 UserTextMessage 靠
//  有没有 planContent 来决定走这个渲染器（见 UserTextMessage 第 42 行）。
//
//  视觉上是一个 planMode 色的圆角框：边框 + 加粗标题 + Markdown 正文。'''),

    (15, 'before', '''// 【`borderColor="planMode"` 不是一个具体颜色，是一个语义色名】
//
//  全仓的颜色名分两类：
//    · 语义色  planMode / success / error / warning / subtle / suggestion / text
//    · 具体色  若干终端 16 色名（cyan / red …）
//
//  语义色由主题（ThemeName）映射成实际颜色，所以用户在 /config 里换主题时，
//  plan 模式的框会一起变。具体色名不会变。
//
//  写组件时优先用语义色 —— 这是这套 UI 能做到「一处理解成一套主题」的原因。'''),

    (18, 'before', '''// 【第 17 行的静态标题节点用了 sentinel，第 23 行的正文跟着 planContent 变】
//
//  注意 t2（标题）在 $[0]，t3（正文）在 $[1]/$[2]，最后 $[3]/$[4]/$[5] 存整框。
//  三层缓存对应三个变化频率：
//
//      标题      永不重算（sentinel）
//      正文      只在 planContent 变时重算（Markdown 解析很贵）
//      整框      在 marginTop 或正文变时重算
//
//  **Markdown 是这里最贵的一步**：一次 parse 要跑完整的 tokenizer。
//  缓存的关键作用就是「滚动时不要重新解析同一个 plan」。'''),
]
