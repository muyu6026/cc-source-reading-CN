# -*- coding: utf-8 -*-
"""AskUserQuestionTool/AskUserQuestionTool.tsx 第 1 部分"""

ANNOTATIONS = [
    (18, 'after', '''单个选项的 schema：label 是展示文本（建议 1-5 个词）、description 解释含义与代价、
preview 是可选的「聚焦预览」内容（mockup / 代码片段），供用户横向对比方案用。'''),
    (24, 'after', '''单个问题的 schema：question 完整问句、header 是 chip 标签（限 12 字符）、
options 强制 2-4 个且互斥（multiSelect 除外）、multiSelect 控制是否可多选。'''),
    (31, 'after', '''annotations schema：用户在选项之外附加的自由笔记与所选预览内容，
按问题文本为键的 record，可选。这些信息会随工具结果回传给模型。'''),
    (54, 'after', '''UNIQUENESS_REFINE：去重校验器——问题文本不得重复，同一问题内选项 label 不得重复。
用 Set 尺寸对比实现 O(n) 判重，配合下面的 .refine() 挂到 inputSchema 上。'''),
    (61, 'after', '''commonFields：输入输出共用字段。answers 是权限组件（交互 UI）收集到的用户答案；
metadata.source 仅用于埋点（如 /remember 命令来源），不展示给用户。'''),
    (67, 'after', '''inputSchema：1-4 个问题 + 共用字段，strictObject 拒绝多余键；
.refine(UNIQUENESS_REFINE.check) 在 schema 层面强制问题与选项去重。'''),
    (74, 'after', '''outputSchema：回传「问题 + 答案 + 注释」。答案是 question 文本 → answer 字符串的
record，多选时用逗号拼接。这是模型在后续轮次里读到的数据形状。'''),
    (79, 'after', '''SDK schema 直接复用内部 schema：preview 与 annotations 已公开
（可通过 toolConfig.askUserQuestion 配置），内外形状一致，无需镜像维护。'''),
    (82, 'after', '''导出类型别名，供权限组件与 UI 复用。'''),
    (94, 'after', '''React Compiler 编译产物：$ 是 memo 槽数组，Symbol.for("react.memo_cache_sentinel")
是首哨兵。$[0] 只算一次静态 JSX；$[1] 依赖 answers 变化才重算列表。'''),
    (108, 'after', '''_temp：单条答案渲染「· 问题 → 答案」，用问题文本作 key。'''),
    (113, 'after', '''工具定义入口。searchHint 供工具搜索排序；maxResultSizeChars 10 万上限；
shouldDefer: true 表示该工具可被「延迟执行」机制推迟到批次末尾（先跑完非交互工具再问）。'''),
    (125, 'after', '''prompt() 按预览格式拼接提示词：SDK 消费方没启用 preview（format 为 undefined）
时不注入 preview 说明——对方可能根本不渲染这个字段；启用了才追加对应格式的指引。'''),
    (144, 'after', '''isEnabled：--channels 模式下用户在 Telegram/Discord 上而非终端前，
多选对话框会永远挂着没人答，所以直接禁用；频道权限中继也不会给它备用审批路径。'''),
    (157, 'after', '''requiresUserInteraction: true——这是「必须有人在场」的工具，
交互式审批（权限弹窗）由此标记接管，也用于上文 channels 场景的跳过判断。'''),
    (181, 'after', '''validateInput：仅当 preview 格式是 html 时逐个校验选项的 preview 片段，
违规（错误码 1）直接打回并指明是哪个问题哪个选项。markdown 格式无需校验。'''),
    (188, 'after', '''checkPermissions 恒为 ask：这个工具的全部意义就是弹出交互组件让用户作答，
updatedInput 原样透传，由权限层渲染问题界面并回填 answers。'''),
    (205, 'after', '''被拒时渲染「用户拒绝回答」一行；use/error/progress 渲染均为 null——
这个工具没有中间态，答案直接出现在结果里。'''),
    (223, 'after', '''call() 本身不问任何人：answers 在权限交互阶段已被收集进 input，
这里只是把 questions/answers/annotations 原样打包成工具结果。'''),
    (244, 'after', '''mapToolResultToToolResultBlockParam：把答案压成一行文本回给模型——
每条为「"问题"="答案"」，注释了 preview / notes 的追加在后面，整体逗号分隔。'''),
    (249, 'after_block', '''validateHtmlPreview 是轻量正则检查而非 HTML 解析器：HTML5 解析器按规范
容错一切输入，这里只验证「模型是否真发了 HTML」以及是否违反了我们明令禁止的事。'''),
    (265, 'after', '''三条硬规则：① 禁止完整文档（<html>/<body>/<!DOCTYPE>）；② 禁止 <script>/<style>
（SDK 消费方常用 innerHTML 注入，防止执行代码或改样式；内联 onclick 仍可能，需消费方自行消毒）；
③ 必须真的包含 HTML 标签（既然声明了 html 格式就要有标签）。'''),
]
