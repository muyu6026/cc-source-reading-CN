# 数据文件：src/components/agents/new-agent-creation/wizard-steps/GenerateStep.tsx
# slug = src_components_agents_new_agent_creation_wizard_steps_GenerateStep_tsx
ANNOTATIONS = [
    (16, 'before', '''新建代理向导的「生成」步骤：用户输入对代理的描述，调用生成接口产出代理定义后跳到工具步骤'''),
    (27, 'after', '''四个状态：生成提示词、是否生成中、错误、光标偏移（用于外部编辑器回写后还原光标）'''),
    (31, 'before', '''生成中按 Esc 取消：中止控制器并标记取消错误'''),
    (41, 'after', '''生成中把 confirm:no 绑定为取消（context=Settings 让 n 键不触发取消输入），仅在生成态激活'''),
    (45, 'before', '''呼出外部编辑器编辑提示词：写回内容并同步光标偏移'''),
    (58, 'before', '''未生成时按 Esc 返回：清空已填向导数据并重置错误'''),
    (77, 'before', '''生成主流程：校验非空 → 建中止控制器 → 调 generateAgent → 写回代理数据并跳到第 6 步（工具步）'''),
    (105, 'after', '''成功后跳过中间步骤直接到第 6 步（工具步），与原流程一致'''),
    (108, 'after', '''捕获异常：用户取消不报错，只有非「找不到助手消息」的其它错误才展示'''),
    (122, 'after', '''生成中界面：转圈 + 「正在根据描述生成代理」，底部提示按 Esc 取消'''),
    (130, 'after', '''常态界面：文本框输入描述，底部三键提示（提交 / 外部编辑器 / 返回）'''),
]
