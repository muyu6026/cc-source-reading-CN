# -*- coding: utf-8 -*-
"""src/utils/fileOperationAnalytics.ts 的中文批注数据。"""

ANNOTATIONS = [
    (1, 'before', '''文件操作的隐私保护分析：用截断或完整的 SHA256 哈希代替真实路径与内容，既能统计又不泄露用户数据。'''),
    (9, 'before', '''`hashFilePath` 取路径的十六字符截断 SHA256，作为可去标识的分析键；类型被显式标注为非代码或非路径，防止被误用。'''),
    (22, 'before', '''`hashFileContent` 取内容的完整六十四字符 SHA256，用于去重与变更检测，同样以专用类型约束用途。'''),
    (32, 'after', '''`MAX_CONTENT_HASH_SIZE` 把哈希上限设为百 KB，避免为大文件（如 base64 编码图片）做哈希时耗尽内存。'''),
    (37, 'before', '''`logFileOperation` 汇总操作类型、工具名与路径哈希后上报；仅当内容存在且未超上限时才附内容哈希，否则跳过。'''),
    (71, 'after', '''最终以 `tengu_file_operation` 事件名上报，内容哈希按需附带，路径永远只以哈希形式出现。'''),
]
