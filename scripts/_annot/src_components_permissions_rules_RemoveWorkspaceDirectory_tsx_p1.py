# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (16, 'before', 'RemoveWorkspaceDirectory：把目录从当前工作区移除的确认弹窗。Dialog 用 error 色——收权操作比授权操作更需要确认。'),
    (26, 'before', 'handleRemove 记忆化依赖四值：核心是 applyPermissionUpdate 的 removeDirectories 更新，destination 为 session——移除只影响本会话的权限上下文，磁盘上的设置文件不动，重启会话后目录不会自动回来。'),
    (47, 'before', 'handleSelect：只有 yes 走移除，no 与 Esc 都走 onCancel——确认弹窗的非肯定路径一律等价于取消，不留第三态。'),
    (62, 'before', '目录路径加粗单独渲染，依赖路径单值缓存——路径是用户需要核对的关键信息，其余文案全静态。'),
    (70, 'before', '后果说明进常量槽：移除后 Claude 不再能访问该目录下的文件——讲清「移除」的实际含义是收权，不只是从列表里划掉。'),
    (77, 'before', '选项数组 yes 与 no 进哨兵槽，整个组件生命周期不变。'),
]
