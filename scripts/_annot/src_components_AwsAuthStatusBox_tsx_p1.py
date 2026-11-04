# -*- coding: utf-8 -*-
# annotations for src/components/AwsAuthStatusBox.tsx (82 lines)
ANNOTATIONS = [
    (5, 'before', 'URL_RE：匹配 http 或 https 链接，用于把输出行里的 URL 变成可点击链接'),
    (6, 'before', 'AWS 云认证状态框：只在认证中或出错时显示'),
    (15, 'after', '初值直接取单例当前状态：首次渲染不用等订阅回调'),
    (20, 'after', '订阅单例的状态变化，unsubscribe 作为 effect 清理函数'),
    (31, 'after', '第一道早退：非认证中、无错误、且无输出——完全没事可报'),
    (34, 'after', '第二道早退：非认证中且无错误——认证已成功，界面收起（输出留着但不再占屏）'),
    (46, 'after', '只显示最近 5 行输出（slice 负 5）：终端里不需要全量日志'),
    (54, 'after', 'error 单独一行红字'),
    (62, 'after', '圆角边框加 permission 主题色：与权限类提示的视觉语言统一'),
    (72, 'after', '_temp 逐行渲染：正则找出第一个 URL，切成前中后三段，中段套 Link 保持可点击'),
]
