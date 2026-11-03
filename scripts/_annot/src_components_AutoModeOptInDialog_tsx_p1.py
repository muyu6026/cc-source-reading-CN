# 数据文件：src/components/AutoModeOptInDialog.tsx
# slug = src_components_AutoModeOptInDialog_tsx
ANNOTATIONS = [
    (10, 'after', '''法务审阅过的自动模式说明常量：上方 NOTE 标明清经法务批准才能改，故这段文案（含选项措辞）不得随意改动'''),
    (17, 'before', '''自动模式启用确认弹窗：给用户选择「启用并设为默认 / 仅本次启用 / 退出」，并把选择落到设置与回调'''),
    (31, 'after', '''挂载即上报「对话框已展示」事件（tengu_auto_mode_opt_in_dialog_shown），用于漏斗统计'''),
    (35, 'after', '''变更分发用带标签的 switch（标签 bb3）：按用户选择 accept / accept-default / decline 走不同分支'''),
    (44, 'after', '''accept / accept-default 都写入 `skipAutoPermissionPrompt: true`；后者额外把默认模式设为 auto'''),
    (61, 'after', '''decline 分支只上报事件并调用 `onDecline`，不写任何设置'''),
    (73, 'after', '''主体：上方说明文案 + 一个安全文档链接（code.claude.com/docs/en/security）'''),
    (87, 'after', '''「设为默认」选项：用恒真三元构造，值为 accept-default'''),
    (98, 'after', '''拒绝文案随场景变化：启动门（decline 退出进程）显示「No, exit」，否则显示「No, go back」'''),
    (112, 'after', '''把选项值包一层类型断言回调，提交时转成 accept/accept-default/decline 之一'''),
    (130, 'after', '''最外层 Dialog：标题「Enable auto mode?」，警告配色，取消键等价于 decline'''),
]
