# 源文件: src/commands/feedback/index.ts
ANNOTATIONS = [
    (6, 'after', '''反馈/报错命令定义；别名 bug，type 为 local-jsx（会弹出反馈界面）。'''),
    (12, 'after', '''启用条件是一长串否定的「都不满足」：排除 Bedrock/Vertex/Foundry 等后端、两个禁用开关、仅必要流量模式、内部 ant 用户，且策略层允许产品反馈才显示。'''),
    (23, 'after', '''按需懒加载真正的实现 feedback.js。'''),
    (24, 'after', '''满足 Command 类型约束。'''),
]
