# -*- coding: utf-8 -*-
"""NotebookEditTool/NotebookEditTool.ts 第 1 部分"""

ANNOTATIONS = [
    (57, 'after', '''输入 schema（strictObject）：notebook_path 必须绝对路径；cell_id 定位目标单元格
（插入时作为「插在其后」的锚点，缺省插到开头）；new_source 新内容；cell_type 只在
insert 时必填；edit_mode 三态 replace/insert/delete，默认 replace。'''),
    (85, 'after', '''输出 schema 带归因字段：original_file / updated_file 保存改动前后完整内容
（供 attribution/回滚追踪），error 为空字符串表示成功。'''),
    (108, 'after', '''getActivityDescription：活动流里显示「Editing notebook <路径>」。'''),
    (121, 'after', '''toAutoClassifierInput：TRANSCRIPT_CLASSIFIER 特性开启时用「路径 模式: 新内容」
作为分类器输入；否则返回空串（不参与分类）。'''),
    (132, 'after', '''权限检查直接复用文件写入权限链（checkWritePermissionForTool），
与 FileEditTool/FileWriteTool 共用同一套 allowlist 规则。'''),
    (171, 'after', '''工具结果文本按 edit_mode 分三种措辞（Updated/Inserted/Deleted cell）；
error 非空时标记 is_error 回传。'''),
    (187, 'after', '''SECURITY：UNC 路径（\\\\ 或 // 开头）直接短路跳过所有文件系统操作——
防止 SMB 访问触发 NTLM 凭据泄露。与 FileEditTool/FileWriteTool 同款防护。'''),
    (196, 'after', '''错误码 2：扩展名必须是 .ipynb；改其他文件请用 FileEdit。'''),
    (208, 'after', '''错误码 4：edit_mode 三值校验。zod schema 已限枚举，这里是纵深防御
（Schema 可能被绕过或旧调用方传入任意字符串）。'''),
    (216, 'after', '''错误码 5：insert 模式必须显式给 cell_type——新单元格没有「当前类型」可继承。'''),
    (229, 'after', '''错误码 9：强制 Read-before-Edit（与 FileEditTool/FileWriteTool 一致）。
没有这条，模型可能改一个从没看过的 notebook，或对着过期视图编辑——静默丢数据。'''),
    (237, 'after', '''错误码 10：mtime 新鲜度检查——文件在读取后被用户或 linter 改过，必须重读再写。'''),
    (251, 'after', '''错误码 1：文件不存在（ENOENT）；其他读取异常原样上抛。'''),
    (259, 'after', '''错误码 6：notebook 不是合法 JSON。safeParseJSON 返回 null 即打回。'''),
    (267, 'after', '''错误码 7（上）：非 insert 模式必须指定 cell_id——替换/删除不能没有目标。'''),
    (291, 'after', '''cell 定位两段式：先按真实 id 精确匹配；找不到再按 cell-N 格式解析为数字下标
（旧版 notebook 没有 id 字段时的兼容路径），下标越界或解析失败均报错误码 7/8。'''),
    (317, 'after', '''文件历史开启时先记录编辑快照（fileHistoryTrackEdit），支持回滚到改动前。'''),
    (325, 'after', '''readFileSyncWithMetadata 一次 pass 拿到 content + encoding + lineEndings，
取代旧的 detectFileEncoding + readFile + detectLineEndings 三连
（每步都要重做 safeResolvePath 或 4KB readSync）。'''),
    (330, 'after_block', '''必须用非记忆化 jsonParse：safeParseJSON 按内容字符串缓存并返回共享引用，
而下面会原地改 notebook（cells.splice、targetCell.source=...）。
用记忆化版本会毒化缓存，污染 validateInput 和同内容的后续 call()。'''),
    (348, 'after', '''call 阶段 JSON 解析失败（validate 之后文件又变坏的竞态）：返回带 error 的结果，
original/updated 置空串。'''),
    (368, 'after', '''cellIndex 解析与 validateInput 同款两段式；与 validateInput 的差异：
insert 模式下 cellIndex += 1——语义是「插到该单元格之后」。'''),
    (377, 'after', '''replace→insert 自动转换：想替换「末尾+1」位置的单元格 = 追加新单元格，
此时若未指定 cell_type 默认 code。'''),
    (379, 'after', '''语言取 notebook 元数据 language_info.name，缺省 python。'''),
    (390, 'after', '''nbformat >= 4.5 才有单元格 id：insert 生成随机短 id（base36）；
replace/delete 沿用原 id。旧格式 notebook 不写 id 字段。'''),
    (394, 'after', '''delete：splice 删掉目标单元格。'''),
    (415, 'after', '''insert：按 cell_type 构造新单元格——code 型带 execution_count/outputs 空值，
markdown 型只要 source 与 metadata；splice 插入到 cellIndex。'''),
    (428, 'after', '''replace：覆盖 source；code 单元格同时清空 execution_count 与 outputs
（源码变了旧输出已无意义）；显式给了不同 cell_type 就地改型。'''),
    (431, 'after', '''Jupyter 官方工具链用 1 空格缩进序列化 .ipynb——保持与其一致，diff 最小。'''),
    (442, 'after', '''写后更新 readFileState（记录 post-write mtime，与 FileEditTool/FileWriteTool 一致）。
offset:undefined 会打断 FileReadTool 的去重匹配——没有这步，
同一毫秒内 Read→NotebookEdit→Read 会拿 file_unchanged 桩顶替过期内容。'''),
    (453, 'after', '''成功结果带 original_file/updated_file 全文（归因用）与 new_cell_id。'''),
    (488, 'after', '''异常兜底：Error 实例带 message，非 Error 一律「Unknown error」；
两种都返回带 error 字段的结构化结果而不是抛出——让模型看到可读失败信息。'''),
]
