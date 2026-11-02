ANNOTATIONS = [
    (1, 'after', '''文件级：根据当前模型与 1M 上下文访问权限，给出可升级提示（opus[1m] / sonnet[1m]，倍数 5x）。'''),
    (9, 'before', '''getAvailableUpgrade（私有）：读用户所选模型，opus 且通过 checkOpus1mAccess 则给 opus[1m]，sonnet 同理给 sonnet[1m]，否则 null。'''),
    (30, 'after', '''getAvailableUpgrade 收尾：无可用升级时返回 null（已是最满上下文或无权升级）。'''),
    (35, 'before', '''getUpgradeMessage：按 context 是 warning 还是 tip 返回不同文案；warning 给「/model 别名」，tip 给带倍数说明的提示句。'''),
    (47, 'after', '''收尾：无升级时返回 null，default 分支同样兜底返回 null。'''),
]
