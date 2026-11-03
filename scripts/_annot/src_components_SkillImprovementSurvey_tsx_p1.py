# 数据文件：src/components/SkillImprovementSurvey.tsx
# slug = src_components_SkillImprovementSurvey_tsx
ANNOTATIONS = [
    (17, 'before', '''外层组件：仅做守卫判断，未打开或输入非法时直接返回 null，合法才渲染真正的交互视图'''),
    (27, 'after', '''两道守卫：未打开直接不渲染；输入内容若不是合法反馈输入（如中文）也不渲染，避免把任意按键当成选择'''),
    (56, 'after', '''合法输入仅两种：1 表示采纳建议、0 表示忽略；用 `as const` 锁成只读元组以保证类型收窄'''),
    (69, 'after', '''用 `useRef` 保存初始输入值作为基准：只有当前输入相对初始值有新增字符时才处理，避免重复触发'''),
    (78, 'after', '''提交逻辑：取输入最后一个字符，若是合法数字则截掉它并回传 good（采纳）或 dismissed（忽略）'''),
    (102, 'after', '''标题行：左侧青色实心圆 `BLACK_CIRCLE` 作标记，右侧展示「为某技能建议了改进」'''),
    (110, 'after', '''把每条改进项 `updates` 映射成列表行，左侧用项目符号 `BULLET_OPERATOR` 引出具体变更内容'''),
    (126, 'after', '''选项行：1 对应 Apply（采纳建议），按下即触发采纳流程'''),
    (133, 'after', '''选项行：0 对应 Dismiss（忽略建议），与 Apply 共用同一提交入口、由回传值区分'''),
]
