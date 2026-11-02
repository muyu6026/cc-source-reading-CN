# -*- coding: utf-8 -*-
"""src/utils/telemetryAttributes.ts 的中文批注数据。"""

ANNOTATIONS = [
    (1, 'before', '''组装遥测指标属性的统一入口，并在「是否包含会话 id、版本、账户 uuid」上做基数控制，避免高基数维度拖垮指标管道。'''),
    (14, 'after', '''`METRICS_CARDINALITY_DEFAULTS` 给出三项开关的默认取向：默认带会话 id 与账户 uuid，不带版本。'''),
    (16, 'before', '''`shouldIncludeAttribute` 读取对应环境变量覆盖默认；变量未设置时用默认值，设置后用「真值判断」解析。'''),
    (29, 'before', '''`getTelemetryAttributes` 先放用户 id，再按开关追加会话 id 与版本，最后在确实走 OAuth 时附上组织、邮箱与账户标识。'''),
    (63, 'after', '''仅在真正使用 OAuth 时才附账户维度；账户 uuid 还要再过一次基数开关，且优先用带标签的标识以降低再识别风险。'''),
    (68, 'after', '''最后把终端类型（若可探测）作为属性附上，方便按客户端环境切分指标。'''),
]
