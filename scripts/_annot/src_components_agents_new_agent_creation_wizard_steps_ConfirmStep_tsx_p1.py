# 批注数据：src/components/agents/new-agent-creation/wizard-steps/ConfirmStep.tsx
# slug: src_components_agents_new_agent_creation_wizard_steps_ConfirmStep_tsx
ANNOTATIONS = [
    (1, 'after', '''引入 React 编译器运行时：本文件是经过 React Compiler 自动记忆化（自动插入 $ 缓存）的产物，不是手写源码。'''),
    (20, 'after', '''Props 类型：确认步骤需要的原始数据——工具集合、已有 agent 列表、保存回调、保存并编辑回调，以及可选的外部错误。'''),
    (27, 'after', '''ConfirmStep 组件：agent 创建向导的最后一步，把前面收集的信息汇总成一个可读的确认界面。'''),
    (28, 'after', '''$ 是 React Compiler 生成的记忆化缓存，_c(88) 声明本组件最多缓存 88 个派生值，避免每次渲染重复计算。'''),
    (49, 'after', '''绑定 confirm:no 键（通常是 Esc）到 goBack，让用户随时退回上一步。'''),
    (69, 'after', '''handleKeyDown 处理键盘提交：s/Enter 直接保存，e 保存并打开编辑器继续编辑。'''),
    (70, 'after', '''从向导状态取出最终生成的 agent 定义，作为本页展示与校验的数据源。'''),
    (91, 'after', '''调用 validateAgent 校验 agent：检查工具权限、命名冲突等，返回警告与错误列表。'''),
    (94, 'after', '''把系统提示词截断到 240 列宽，避免在终端里溢出。'''),
    (113, 'after', '''若自动记忆已开启，展示 Memory 的作用域说明，让用户知道该 agent 能读写哪些记忆。'''),
    (120, 'after', '''T1 固定为 WizardDialogLayout，提供向导统一的标题与底部提示栏外壳。'''),
    (159, 'after', '''根据来源目录与 agent 类型，算出该 agent 文件应写入的相对路径。'''),
    (244, 'after', '''校验有警告时，渲染一列警告条目（带 warning 配色）。'''),
    (245, 'after', '''校验有错误时，渲染一列错误条目（带 error 配色），错误会阻止保存。'''),
    (293, 'after', '''若父级传入 error（例如保存失败），在底部以 error 配色提示。'''),
    (315, 'after', '''底部提示操作键：按 s/Enter 保存，e 保存并编辑。'''),
    (322, 'after', '''把名称、路径、工具、模型、记忆、描述、系统提示、警告、错误等节点拼成主内容区。'''),
    (346, 'after', '''用向导布局外壳包裹主内容，副标题为 confirm and save，底部提示栏来自 Byline。'''),
    (355, 'after', '''返回最终要渲染的节点树。'''),
    (363, 'after', '''_temp 把工具名数组格式化成人类可读串：未定义显示 All tools，0 个显示 None，多个用 and 连接。'''),
]
