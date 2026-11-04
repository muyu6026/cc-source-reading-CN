# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (18, 'before', '预览区固定 6 行、年龄列定宽 8——两个常量先定死版面，列表行宽与预览宽度都从它们反推。'),
    (20, 'before', 'Item 结构在加载时一次性算好四个展示字段：原文 display、预降序的 lower、首行 firstLine、右补空格到定宽的 age。查询是高频操作，把 toLowerCase 提前到加载期做一次。'),
    (32, 'before', '注册覆盖层：历史搜索弹窗打开期间接管全局键位（如 ctrl+r），关闭时自动注销。'),
    (38, 'before', '挂载异步加载：for await 流式读取历史迭代器，边读边装 Item。cancelled 标志配合清理函数——卸载时不只停止 setState，还调用 reader.return 提前终结迭代器，让底层文件句柄及时释放。'),
    (50, 'before', '相对时间格式化后按 stringWidth（显示宽而非字符数）补空格到 8 列——CJK 时间词宽度不同，按字符数补会错位。'),
    (65, 'before', '过滤 useMemo：空查询直接返回全量；否则分两桶——精确子串命中进 exact，未命中再测子序列进 fuzzy，exact.concat(fuzzy) 保证精确匹配永远排在模糊匹配前面。'),
    (80, 'before', '布局三算：终端够 100 列才开右侧预览分栏；列表取一半宽，行宽再减年龄列；预览宽度保底 20。全部在渲染前算成数字传给 FuzzyPicker。'),
    (84, 'before', 'FuzzyPicker direction 为 up：历史搜索从输入行向上展开，与 ctrl+r 的方向语义一致。'),
    (89, 'before', '选中时先打点（结果数与查询长度，供搜索质量分析），再调 entry.resolve()——历史条目是惰性封装，选中此刻才把显示文本解析成完整 HistoryEntry 交给上层。'),
    (90, 'before', '空态文案三态：items 还在加载显示 Loading、有查询无结果显示无匹配、无历史显示空。用一个函数按状态切换而不是三个分支组件。'),
    (96, 'before', '预览渲染：wrapAnsi 硬折行后滤掉空行；超过 6 行就少显一行、把名额让给 plusN more lines 提示——预览宁缺一行也要让「还有更多」可见。容器高度固定 PREVIEW_ROWS 加 2（上下边框），抖动为零。'),
    (111, 'before', 'isSubsequence 双指针：query 的字符按序能否都在 text 里找到。O(n) 且无回溯，模糊匹配只判「字符都在、顺序对」，不评分数——排序交给 exact 优先再加原有顺序。'),
]
