# 数据文件：src/utils/mcpOutputStorage.ts

ANNOTATIONS = [
    (12, 'after', '''文件级：处理 MCP 工具结果（尤其大输出与二进制内容）的落盘、格式描述、mime 到扩展名映射，以及给模型的读取指引。'''),
    (28, 'after', '''getFormatDescription：按 MCP 结果类型与 schema 返回人类可读的格式描述（纯文本 / JSON / JSON 数组）。'''),
    (59, 'after', '''getLargeOutputInstructions：构造给模型的指令，要求它分块顺序读完被截存的超大输出文件，并明确声明已读范围，避免跳读。'''),
    (66, 'after', '''extensionForMimeType：把 mime 类型映射到扩展名，已知类型给正确扩展名、未知给 bin；扩展名决定 Read 工具如何派发（PDF / 图片等需要正确后缀）。'''),
    (118, 'after', '''extensionForMimeType 收尾：覆盖常见文档 / 音频 / 视频 / 图片 mime，未知一律 bin。'''),
    (125, 'after', '''isBinaryContentType：启发式判断内容类型是否二进制（应存盘而非进模型上下文）；文本类、json、xml、表单数据视为非二进制。'''),
    (136, 'after', '''isBinaryContentType 收尾：用后缀或精确匹配而非子串，保证 openxmlformats（docx / xlsx）仍被当二进制。'''),
    (174, 'after', '''persistBinaryContent：把原始二进制字节按 mime 推导的扩展名写入工具结果目录；mime 与扩展名是固定词表，安全可记录遥测。'''),
    (189, 'after', '''getBinaryBlobSavedMessage：生成一句简短提示，告知模型二进制内容已保存到哪里（不规定模型该怎么做，取决于 provider / 工具）。'''),
]
