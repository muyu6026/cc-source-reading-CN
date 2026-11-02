# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''本文件是「基于分类器的权限系统」共享基础设施：为 bashClassifier（语义化 Bash 命令匹配）与 yoloClassifier（YOLO 模式安全分类）提供共用的类型、zod 校验器与工具函数。模块本身不依赖具体分类器实现。'''),
    (15, 'before', '''extractToolUseBlock：从消息内容数组中按工具名查找并返回对应的工具调用块（tool_use）。找不到或类型不符时返回 null。'''),
    (30, 'before', '''parseClassifierResponse：用给定 zod schema 安全解析工具调用块的输入字段。解析失败时返回 null，调用方据此回退到默认分类逻辑。'''),
]
