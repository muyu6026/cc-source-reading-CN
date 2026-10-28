# source: src/utils/notebook.ts
ANNOTATIONS = [
    (19, 'after', '''大输出阈值：单个 cell 的输出累计超过 1 万字符就视为「过大」，转成提示用 Bash 自行查看。'''),
    (32, 'after', '''判断一组输出是否过大：累加文本与图片字节，超过阈值即返回真。'''),
    (39, 'after', '''把输出文本统一截断（经 formatOutput），数组形式先拼接再处理。'''),
    (57, 'after', '''从输出 data 里抽取 png 或 jpeg 图片并去掉空白，转成统一图片结构。'''),
    (81, 'after', '''按 output_type 分派处理：stream、execute_result、display_data、error 四种。'''),
    (117, 'after', '''把单个 cell 处理成 NotebookCellSource：文本 cell 不戴代码语言；代码 cell 有输出且过大时只留提示。'''),
    (132, 'after', '''把 cell 内容包成文本块，附带 cell_type 与 language 元信息（非 Python 才标语言）。'''),
    (153, 'after', '''把 cell 输出转成文本块与图片块（图片走 base64）。'''),
    (159, 'after', '''组合一个 cell 的内容块与其输出块，得到该 cell 的工具结果片段列表。'''),
    (183, 'after', '''读取并解析 ipynb 为处理后的 cell 数据；指定 cellId 时只返回那一个 cell。'''),
    (215, 'after', '''把全部 cell 映射成工具结果块，并合并相邻的文本块以减少块数量。'''),
    (224, 'after', '''把 cell-N 形式的 cellId 解析成数字下标，解析失败返回 undefined。'''),
]
