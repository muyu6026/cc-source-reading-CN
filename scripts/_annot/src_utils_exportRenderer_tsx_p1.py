# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'after', '''导出渲染器：在无交互终端的环境下，把整段会话消息渲染成 ANSI 文本，供导出命令落盘或复制到别处。'''),
    (10, 'after', '''renderToAnsiString 是真正的渲染出口：静态渲染复用同一套 Ink 组件树，因此导出内容与屏幕上看到的一致。'''),
    (31, 'after', '''StaticKeybindingProvider 是精简版上下文：省掉 ChordInterceptor，因为它依赖 useInput，在没有 stdin 的无头渲染里会永久挂起。'''),
    (41, 'after', '''normalizedUpperBound 给出单个 Message 可能展开的最大条数：normalize 按内容块一比一拆分，字符串内容算一块，附件类消息没有 message 字段也按一块算。'''),
    (65, 'after', '''streamRenderedMessages 是分块渲染的核心：每块单独调一次 renderToAnsiString，让布局树与屏幕缓冲只按「最高的那一块」分配，而不是整段会话。实测 538 条消息的会话内存峰值下降约 55%。'''),
    (78, 'after', '''ceiling 是保守上界：normalize 之后的数组长度在这里看不到，只能按每个消息的内容块数累加，再留出 chunkSize 的余量，保证循环一定能走到空切片而退出。'''),
    (84, 'after', '''终止条件取「剥掉 ANSI 后为空」：collapse 只会让数组变短，真实末尾必定先于 ceiling 出现，靠空切片自然收口，不需要精确长度。'''),
    (97, 'after', '''renderMessagesToPlainText 是导出用包装：逐块剥掉 ANSI 再拼接，得到纯文本而不是带转义序列的原始流。'''),
]
