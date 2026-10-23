ANNOTATIONS = [
    (17, 'after', r'''stripEmptyLines 与 trim() 的区别：只去掉首尾的纯空白行，内容行内的空白不动。'''),
    (46, 'after', r'''isImageOutput 判 data URI 图片——shell 命令可以直接往 stdout 打 base64 图片。'''),
    (67, 'after', r'''buildImageToolResult 把 data URI 组装成 API 的 image tool_result 块。解析失败返回 null，调用方回落到文本处理。'''),
    (93, 'after', r'''文件读取 20MB 硬顶：比这更大的 data URI 远超 API 的 5MB base64 上限，读进内存直接 OOM。'''),
    (98, 'after', r'''resizeShellImageOutput 的两个坑都写在注释里：① stdout 从 shell 输出文件回读时有长度上限，截断的 base64 解出来是 corrupt image（要么这里抛错要么被 API 拒），所以输出溢写到磁盘时要重读原文件；② compressImageBuffer 只查字节大小，小尺寸高 DPI 的 PNG（matplotlib dpi=300）能全分辨率蒙混过关，毒化多图请求（CC-304）。'''),
    (133, 'after', r'''formatOutput 是输出截断逻辑：图片不截（原样带回）；文本超 getMaxOutputLength() 就切前段 + 剩余行数提示。'''),
    (156, 'after', r'''截断提示数的是剩余行数，从截断点起算。'''),
    (167, 'after', r'''stderr 追加 shell cwd 重置提示——cd 到项目外被拉回时要让用户知道。'''),
    (170, 'after', r'''resetCwdIfOutsideProject：cd 到允许工作目录之外时拉回原目录。快路径注释说明 originalCwd 恒在 allWorkingDirectories 里，cwd 没动时跳过 syscall 密集的 pathInAllowedWorkingPath。'''),
    (194, 'after', r'''createContentSummary 给 MCP 的图片+文本结果生成人类可读摘要，UI 展示用。文本块取前 200 字符预览。'''),
]
