# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (15, 'before', '文件编辑工具的「更新消息」组件：顶部一行增删行数统计，按 style 与 verbose 组合决定是只给一行摘要还是展开完整结构化 diff。Props 里的 fileContent 可选，传入时 diff 列表能对齐真实文件内容。'),
    (18, 'before', '组件入口。注意 t0 是解构前的 props 对象——编译器产物把解构延后到第 20 行，便于把整个 props 作为单一依赖参与缓存比较。'),
    (19, 'before', '_c(22)：申请 22 个记忆槽。本组件的渲染输出被拆成 8 段独立缓存的 JSX（统计行、逗号、移除行、外层文本、previewHint、摘要文本、diff 列表、最终容器），段间靠槽位串联。'),
    (32, 'before', '增删行数统计：reduce 遍历每个 hunk，数以加号/减号开头的行。两条统计的归并函数被编译器提取为模块级 _temp2 与 _temp4（及其行判定 _temp 与 _temp3），见文件尾。'),
    (33, 'before', '提取成模块级函数的关键收益：reduce 的回调引用在多次渲染间保持同一，编译器对 numAdditions 只需做值比较，不必担心回调身份变化击穿缓存。'),
    (42, 'before', '分隔符只在「既有增又有删」时才给逗号，否则为 null——三段文本按 t1 加 t2 加 t3 直接拼接，空段自然消失。'),
    (45, 'before', '单数时大写 Removed、复数时小写 removed——because 两段统计拼接时，第一段后接逗号加小写续行更自然；只有删除没有新增时它才是句子开头，所以首字母按位置切换大小写。'),
    (63, 'before', 'previewHint 分支：预览模式（还没真正落盘的编辑）不展示 diff，只给一行暗色提示。此分支在非 condensed 且非 verbose 时早退，直接返回不再往下走。'),
    (76, 'before', 'condensed 且非 verbose：只返回前面拼好的统计行 text，完整 diff 不渲染——这是聊天流里默认的紧凑视图。'),
    (88, 'before', 'diff 列表宽度减 12：为 MessageResponse 的左侧竖线与缩进留出边距，否则宽 diff 会溢出触发重绘闪烁。'),
    (90, 'before', 'StructuredDiffList 是重组件，依赖数组给全五个入参：fileContent、filePath、firstLine、structuredPatch 与宽度。任一不变就复用 $[18] 的旧节点，大列表不会因父组件其他状态变化而重建。'),
    (103, 'before', '最终容器：MessageResponse 包一列，统计行在上、diff 列表在下。注意 text 在第 82 行又被包了一层 Text——t5 与第 77 行直接返回的 text 不是同一个节点，两处缓存互不影响。'),
    (115, 'before', '行判定函数：减号开头即删除行。编译器把内联箭头函数提升为模块级常量，四个 _temp 按引用顺序倒着编号（_temp2 定义在后、先被引用）。'),
]
