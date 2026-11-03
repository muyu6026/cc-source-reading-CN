# 数据文件：src/components/ManagedSettingsSecurityDialog/ManagedSettingsSecurityDialog.tsx
# slug = src_components_ManagedSettingsSecurityDialog_ManagedSettingsSecurityDialog_tsx
ANNOTATIONS = [
    (9, 'after', '''从同级 utils 取出两个纯函数：抽取危险设置、把危险设置格式化成展示用的字符串列表'''),
    (15, 'before', '''受管设置安全确认弹窗：企业 IT 下发的托管设置可能执行任意代码或拦截提示，需用户明确批准才生效'''),
    (22, 'after', '''先抽取危险设置（危险 shell 设置、不在白名单的环境变量、hooks），再格式化成展示列表'''),
    (34, 'after', '''绑定 confirm:no 键直接触发 `onReject`，context 为 Confirmation 与确认键互斥'''),
    (37, 'after', '''变更处理：选 exit 即拒绝并退出；否则接受托管设置'''),
    (61, 'after', '''警告正文：说明组织配置可能执行任意代码或拦截你的提示与回复，需谨慎'''),
    (75, 'after', '''把每个危险设置项映射成一个带缩进的列表行（左侧点号 + 内容）'''),
    (95, 'after', '''两个选项：接受（信任并继续）或退出（直接退出 Claude Code）'''),
    (108, 'after', '''渲染选项选择框；取消等价于选择 exit，确保用户总能退出'''),
    (116, 'after', '''底部提示：等待退出时显示「再次按下退出键」，否则显示「Enter 确认 · Esc 退出」'''),
]
