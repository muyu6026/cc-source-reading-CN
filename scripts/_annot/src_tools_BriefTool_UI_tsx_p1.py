# -*- coding: utf-8 -*-
"""BriefTool/UI.tsx 第 1 部分"""

ANNOTATIONS = [
    (14, 'after', '''renderToolUseMessage 返回空串：工具调用本身不留痕迹，
消息正文才是全部输出（userFacingName 也是空串，双保险去工具外壳）。'''),
    (22, 'after', '''三种渲染模式按 options 分流；空消息且无附件直接不渲染。'''),
    (36, 'after', '''transcript 模式（ctrl+o）：模型文本不做过滤，保留 ⏺ 圆点
让 SendUserMessage 与周围文本块在视觉上可区分。'''),
    (53, 'after', '''brief-only（chat）视图：Claude 标签 + 两列缩进，与用户消息的 You 标签对称
（#20889）。「N in background」的转圈状态在 BriefSpinner（Spinner.tsx）里，
这里是无状态的静态标签 + 时间戳。'''),
    (67, 'after', '''默认视图：dropTextInBriefTurns（Messages.tsx）会隐藏本轮冗余的助手文本——
SendUserMessage 是本轮唯一的文本类内容。无侧栏记号，读作纯文本；
空 minWidth=2 盒子对齐 AssistantTextMessage 的 ⏺ 槽位。'''),
    (100, 'after', '''AttachmentList：memo 化的附件列表，每条「· [image]/[file] 路径 (大小)」。'''),
]
