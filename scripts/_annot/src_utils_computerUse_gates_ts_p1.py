# -*- coding: utf-8 -*-
"""src/utils/computerUse/gates.ts 的中文批注数据。"""

ANNOTATIONS = [
    (1, 'before', '''计算机操控（代号 Chicago）的能力门控与子开关：决定功能是否启用、用像素还是归一化坐标，并把细粒度子开关暴露给工具描述。'''),
    (7, 'before', '''`ChicagoConfig` 在子开关类型之上补了启用标志与坐标模式两个字段，整体作为一份完整配置。'''),
    (21, 'after', '''`DEFAULTS` 是功能关闭、像素坐标、各子开关开启的保守默认；部分 JSON 也能靠展开默认值继承其余字段。'''),
    (26, 'before', '''`readConfig` 把默认值与远程配置（特性开关）展开合并，后者缺失的字段由默认补全，避免暴露未定义。'''),
    (39, 'before', '''`hasRequiredSubscription` 决定是否具备使用资格：内部用户绕过档位直接放行，外部仅 Max 与 Pro 档可用。'''),
    (45, 'before', '''`getChicagoEnabled` 综合订阅资格与远程开关判定启用与否；并特判「继承了单体仓库开发配置的蚂蚁用户」默认关闭，除非显式放行。'''),
    (69, 'before', '''`getChicagoCoordinateMode` 在首次读取后冻结坐标模式，避免会话中途远程翻转导致模型收到的坐标语义与点击换算不一致。'''),
]
