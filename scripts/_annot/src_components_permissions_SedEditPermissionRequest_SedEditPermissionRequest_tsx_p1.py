# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (14, 'before', '''SedEditPermissionRequestProps：在权限请求通用属性上追加 sed 编辑信息。'''),
    (21, 'before', '''外层组件：读取目标文件原文（或标记不存在），挂 Suspense 交给 Inner 渲染。'''),
    (43, 'before', '''异步读取文件原文：先探测编码，再读入并把 CRLF 统一换成 LF。'''),
    (70, 'before', '''_temp：读取失败且非 ENOENT 时原样抛出，ENOENT 视为文件不存在。'''),
    (79, 'before', '''内层组件：拿到文件内容后计算 sed 替换结果并渲染差异预览。'''),
    (108, 'after', '''对原文施加 sed 替换，得到新内容。'''),
    (117, 'before', '''若原文与新内容相同，则没有可展示的编辑（空数组）。'''),
    (157, 'before', '''parseInput：把审批通过后的输入包成带 _simulatedSedEdit 的解析结果。'''),
    (179, 'before', '''用相对路径（相对 cwd）作为副标题展示文件位置。'''),
    (195, 'before', '''提示文案：询问是否对某个文件做此编辑。'''),
    (203, 'before', '''有编辑则展示差异组件，否则展示「未匹配」提示。'''),
]
