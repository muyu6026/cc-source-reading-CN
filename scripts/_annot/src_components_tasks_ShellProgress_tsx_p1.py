# -*- coding: utf-8 -*-
# annotations for src/components/tasks/ShellProgress.tsx (87 lines)
ANNOTATIONS = [
    (13, 'before', 'TaskStatusText：把任务状态渲染成括号包裹的暗色文本，label 可覆盖状态名，suffix 可附加后缀'),
    (20, 'after', 'displayLabel 回落链：没给 label 就用 status 原文'),
    (21, 'after', '嵌套三元映射颜色：completed 用 success、failed 用 error、killed 用 warning，pending 与 running 不着色（undefined）'),
    (34, 'before', 'ShellProgress：按 shell.status 分派，五个状态归成四种展示（pending 与 running 共用一种）'),
    (40, 'after', '每个 case 各占一个 memo 槽（$[0] 到 $[3]）：四种返回结果互不干扰地缓存'),
    (44, 'after', 'completed 传 label=done：状态码是内部词汇，界面上说 done 更自然'),
    (56, 'after', 'failed 显示 error、killed 显示 stopped——都是用户视角的措辞，不是枚举名直译'),
    (74, 'after', 'running 与 pending 连续两个 case 空体：case 落空即穿透到下一个 case，两者都显示 running'),
    (85, 'after', 'switch 无 default：status 联合类型已被四组 case 穷尽，TypeScript 保证不会兜底返回 undefined'),
]
