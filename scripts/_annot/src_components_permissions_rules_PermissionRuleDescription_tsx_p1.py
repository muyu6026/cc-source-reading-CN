# -*- coding: utf-8 -*-
# annotations for src/components/permissions/rules/PermissionRuleDescription.tsx (76 lines)
ANNOTATIONS = [
    (9, 'before', '权限规则的人话描述：把 ruleValue 翻成一句话，Bash 走特殊分支，其它工具通用处理'),
    (14, 'before', '按 toolName 分派：只有 Bash 的规则内容带前缀语义'),
    (18, 'after', '以冒号星号结尾表示前缀匹配：去掉末尾两字符后说成「任何以此开头的 Bash 命令」'),
    (21, 'after', 'slice 到负数二剥掉通配后缀：展示时不该出现通配语法'),
    (39, 'after', '非前缀规则说成 The Bash command 加具体命令，命令本身加粗'),
    (50, 'after', 'Bash 但无 ruleContent：任意 Bash 命令，整句哨兵缓存'),
    (63, 'after', '其它工具且无 ruleContent：任何对该工具的使用'),
    (71, 'after', '其它工具有 ruleContent 时返回 null：这类规则没法一句话讲清，交给调用方的原始展示兜底'),
]
