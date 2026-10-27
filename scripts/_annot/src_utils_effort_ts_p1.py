ANNOTATIONS = [
    (9, 'after', '''effort（推理强度）参数的解析、持久化与解析判定，串联环境覆盖、应用状态与模型默认之间的优先级链。'''),
    (18, 'after', '''EFFORT_LEVELS 与 EffortValue：四级字符串档位加数字档，数字档仅作模型默认、不持久化。'''),
    (49, 'after', '''modelSupportsEffort：判断模型是否支持 effort 参数，优先环境变量与三方覆盖，Claude 4 部分模型默认支持。'''),
    (65, 'after', '''modelSupportsMaxEffort：公开模型仅 Opus 4.6 支持 max，蚂蚁内部模型另判。'''),
    (87, 'after', '''parseEffortValue：把任意输入解析为档位或数字，空值与非法值返回 undefined。'''),
    (167, 'after', '''resolveAppliedEffort：按 环境覆盖→应用状态→模型默认 解析最终发给 API 的 effort，非 Opus-4.6 上的 max 自动降为 high。'''),
    (216, 'after', '''convertEffortValueToLevel：把值转成展示档位，未知字符串与默认情形归为 high，数字档按区间映射到四级。'''),
    (329, 'after', '''getDefaultEffortForModel：按订阅类型与模型返回默认 effort，Opus 4.6 对 Pro/Max/Team 默认 medium，其余回退到 high。'''),
]
