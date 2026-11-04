# -*- coding: utf-8 -*-
# annotations for src/components/permissions/FileWritePermissionRequest/FileWriteToolDiff.tsx (89 lines)
ANNOTATIONS = [
    (16, 'before', '文件写入工具的 diff 预览：已存在的文件显示结构化 diff，新文件直接高亮全文'),
    (26, 'after', 'bb0 标签块是编译器对 useMemo 提前 return 的重写：!fileExists 时置 null 跳出块——非业务 goto 语法'),
    (34, 'before', 'getPatchForDisplay 把「整文件替换」包成一次 edit：old_string 为旧全文、new_string 为新全文，复用通用 diff 管线'),
    (56, 'after', 'firstLine 取新内容首行：diff 显示时辅助定位上下文'),
    (65, 'after', '有 hunks 走 StructuredDiff 列表（intersperse 用 _temp 插入省略号分隔），无 hunks（新文件）走 HighlightedCode 全文预览，空内容显示 (No content)'),
    (78, 'after', '虚线边框容器：borderColor=subtle、只留上下边框，视觉上圈出 diff 区域'),
    (86, 'before', '_temp 即省略号分隔项：key 为 ellipsis-i 的 NoSelect 暗色省略号——hunks 之间的视觉间隔'),
]
