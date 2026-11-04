# -*- coding: utf-8 -*-
# annotations for src/components/agents/new-agent-creation/wizard-steps/MethodStep.tsx (80 lines)
ANNOTATIONS = [
    (11, 'before', '向导的创建方式步：让 Claude 生成 vs 手动配置'),
    (21, 'after', '两个选项：生成（文案里标 recommended）与手动——推荐是靠「排第一加文案标注」，不是独立开关'),
    (35, 'after', '页脚提示：↑↓ 导航、Enter 选择，Esc 走可配置键位'),
    (42, 'after', '选择回调先写 method 与 wasGenerated 两个字段'),
    (46, 'after', 'wasGenerated 是 method 的派生值：冗余存一份，后续步骤不必再判断 method 就知道来源'),
    (48, 'after', '生成走 goNext，手动直接 goToStep(3) 跳到提示词步——跳步是按索引硬编码的，插入新步骤要同步改这里'),
    (63, 'after', 'onCancel 包一层无参函数'),
    (71, 'after', 'Select 的 key 用 method-select：换实例时重置内部光标位置'),
]
