# -*- coding: utf-8 -*-
# 批注数据：src/commands/bridge-kick.ts
# 锚点 (行号, pos, 中文)。pos ∈ before/after/after_block。
ANNOTATIONS = [
    (1, 'after', '模块：ant 专属的桥接故障注入命令，用于手动触发各种恢复路径以便测试。'),
    (40, 'before', '`USAGE` 字符串：列出所有子命令及其参数格式，作为错误回显的帮助文本。'),
    (51, 'before', '`call`：命令主体，拿到桥接调试句柄后按子命令分发注入故障。'),
    (61, 'after', '把参数按空白拆分，取子命令与两个可选参数。'),
    (63, 'after', '`switch` 按子命令分发到各注入分支。'),
    (69, 'after', '`close` 分支：触发传输层关闭并指定 WebSocket 错误码（如 1002、1006）。'),
    (76, 'after', '`poll` 分支：注入下一次轮询的故障（瞬时拒绝或致命错误），再唤醒轮询循环。'),
    (116, 'after', '`register` 分支：注入下一次注册环境的故障（致命 403 或连续 N 次瞬时失败）。'),
    (182, 'after', '`status` 分支：打印当前桥接状态。'),
    (191, 'before', '`bridgeKick` 命令定义对象：本地命令，仅 `USER_TYPE=ant` 时启用。'),
]
