# 批注数据：src/utils/autoRunIssue.tsx
# slug: src_utils_autoRunIssue_tsx
ANNOTATIONS = [
    (11, 'after', '''自动运行 /issue 通知与判定：提供在反馈调查后自动触发问题上报的 UI 组件与原因判定辅助函数（仅内部 ant 构建使用）。'''),
    (17, 'after', '''AutoRunIssueNotification 签名：反馈捕获通知组件，挂载时立即尝试运行 /issue，并支持按 Esc 随时取消。'''),
    (76, 'after', '''AutoRunIssueNotification 收尾：用 React 编译器缓存渲染提示文案与取消提示，组合出通知界面。'''),
    (77, 'after', '''AutoRunIssueReason：自动运行原因类型，区分「反馈差评」与「反馈好评」。'''),
    (82, 'after', '''shouldAutoRunIssue 签名：判定是否对内部用户自动运行 /issue。'''),
    (95, 'after', '''shouldAutoRunIssue 收尾：当前实现对所有原因均返回 false，即默认不自动运行。'''),
    (101, 'after', '''getAutoRunCommand 签名：根据原因返回应自动运行的命令。'''),
    (107, 'after', '''getAutoRunCommand 收尾：好评且为内部构建时返回 /good-claude，否则返回 /issue。'''),
    (112, 'after', '''getAutoRunIssueReasonText 签名：把自动运行原因转换为可读说明文字。'''),
    (121, 'after', '''getAutoRunIssueReasonText 收尾：按原因返回对应的用户提示文案。'''),
]
