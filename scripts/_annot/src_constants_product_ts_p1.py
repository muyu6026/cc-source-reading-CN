# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''产品相关常量与远端会话环境判定 / URL 构造'''),
    (4, 'after', '''远端会话各环境基址：生产 / 预发 / 本地'''),
    (5, 'after', '''预发环境基址（staging）'''),
    (6, 'after', '''本地开发环境基址'''),
    (12, 'after', '''isRemoteSessionStaging：按会话 ID 格式或入口 URL 判断是否预发环境'''),
    (26, 'after', '''isRemoteSessionLocal：判断是否本地开发环境'''),
    (39, 'after', '''getClaudeAiBaseUrl：按环境返回对应的 claude.ai 基址'''),
    (65, 'after', '''getRemoteSessionUrl：拼接完整远端会话 URL'''),
    (71, 'after', '''延迟 require sessionIdCompat（保持常量模块在加载期处于 DAG 叶子）'''),
    (73, 'after', '''先转兼容会话 ID 再拼基址与路径'''),
]
