# -*- coding: utf-8 -*-
"""src/utils/systemDirectories.ts 的中文批注数据。"""

ANNOTATIONS = [
    (1, 'before', '''跨平台系统目录（桌面、文档、下载等）的解析工具；它把 Windows、macOS、Linux 与 WSL 的差异统一成同一套路径，并允许测试时通过参数覆盖环境、家目录与平台。'''),
    (6, 'before', '''`SystemDirectories` 是带索引签名的类型，除固定字段外兼容任意字符串键，能与 `Record<string, string>` 直接互用。'''),
    (27, 'before', '''`getSystemDirectories` 按平台分支返回目录：默认用家目录拼出三件套，Windows 改读 `USERPROFILE`，Linux/WSL 优先取 XDG 基目录规范里的变量。'''),
    (35, 'after', '''`defaults` 是大多数平台共用的基础路径，Mac 与未知平台直接返回它，Windows 与 Linux 在其上做覆盖。'''),
    (42, 'before', '''`switch (platform)` 把四套平台的差异集中在此；未知平台回落到默认路径并打日志提示。'''),
    (65, 'before', '''macOS 与未知平台分支直接返回默认路径；若平台识别为未知，仅记一条调试日志而不改变行为。'''),
]
