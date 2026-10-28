# -*- coding: utf-8 -*-
# 批注：src/utils/permissions/shadowedRuleDetection.ts
ANNOTATIONS = [
    (14, 'after', '遮蔽类型：被 ask 规则或 deny 规则挡住'),
    (19, 'before', '一条不可达规则的描述：原规则、原因、遮蔽者、类型与修复建议'),
    (30, 'before', '检测选项：是否开启 Bash 沙箱自动放行（决定个人设置的 ask 规则是否遮蔽具体 allow 规则）'),
    (61, 'before', '判断设置来源是否「共享」（项目/策略/命令），即是否对其他用户可见'),
    (72, 'before', '把设置来源格式化成告警里展示用的字符串'),
    (79, 'before', '按遮蔽类型生成修复建议：deny 类要移除 deny 或具体 allow，ask 类要移除 ask 或具体 allow'),
    (111, 'before', '判断一条具体 allow 是否被「工具级 ask 规则」遮蔽（用户总先被询问，allow 永远到不了）'),
    (146, 'after', 'bash 沙箱自动放行时按 ask 来源分流：个人设置不遮蔽，共享设置仍判为遮蔽以告警'),
    (160, 'before', '判断一条具体 allow 是否被「工具级 deny 规则」彻底挡死（deny 优先于 allow，allow 永远到不了）'),
    (193, 'before', '总入口：取三类规则，逐条 allow 先查 deny 遮蔽（更严重）再查 ask 遮蔽，返回不可达清单'),
    (216, 'after', '被 deny 遮蔽就不再重复报 ask 遮蔽，避免同一条规则出两条告警'),
]
