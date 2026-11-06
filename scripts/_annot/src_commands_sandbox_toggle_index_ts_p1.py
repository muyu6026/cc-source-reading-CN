# 批注数据：source/src/commands/sandbox-toggle/index.ts
# slug: src_commands_sandbox_toggle_index_ts_p1

ANNOTATIONS = [
    (1, 'after', '引入终端符号库、命令类型与沙箱适配器。'),
    (5, 'after', '定义 sandbox 命令对象，末尾用 satisfies Command 做类型校验。'),
    (7, 'after', '动态 description getter：根据沙箱当前状态拼装图标与文案。'),
    (8, 'after', '一次性读取五项状态：是否启用、是否自动放行 bash、是否允许未沙箱命令、是否被策略锁定、依赖是否齐全。'),
    (14, 'after', '注释：依赖缺失时显示警告图标，否则按启用状态显示对勾或圆圈。'),
    (22, 'after', '拼装状态文案，默认值为 sandbox disabled。'),
    (23, 'after', '启用时区分 auto-allow 与普通启用两种文案。'),
    (28, 'after', '注释：启用且允许未沙箱命令时追加 fallback allowed。'),
    (32, 'after', '被策略锁定时追加 (managed) 标记。'),
    (36, 'after', '最终返回「图标 + 状态 + 配置提示」的字符串。'),
    (38, 'after', '参数提示：排除命令模式。'),
    (39, 'after', '隐藏判定 getter：不支持的平台或不在启用列表时隐藏命令。'),
    (45, 'after', '设为立即执行命令（immediate），无需回车触发。'),
    (46, 'after', '命令类型为本地 JSX 渲染。'),
    (47, 'after', '懒加载实际实现模块 sandbox-toggle.js。'),
]
