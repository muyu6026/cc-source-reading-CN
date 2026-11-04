# -*- coding: utf-8 -*-
# annotations for src/components/agents/new-agent-creation/wizard-steps/LocationStep.tsx (80 lines)
ANNOTATIONS = [
    (12, 'before', '向导的保存位置步：项目级 .claude/agents 或用户级 ~/.claude/agents'),
    (21, 'after', '第一项单独缓存（$[0]），第二项数组复用第一项（$[1]）：编译器的分层缓存'),
    (23, 'after', 'value 用 SettingSource 类型标注：与设置系统共用同一套来源枚举，不引入自定义字符串'),
    (31, 'after', '两项顺序即优先级展示：项目级在前'),
    (42, 'after', 'Esc 提示的 description 是 cancel，而同目录的 MethodStep 写 go back：同一步的语义差异体现在文案上'),
    (49, 'after', '选择即写 location 并前进，没有二次确认'),
    (63, 'after', '取消包一层无参函数'),
    (71, 'after', 'key 用 location-select，与 MethodStep 同一做法'),
]
