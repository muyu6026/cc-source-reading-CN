# -*- coding: utf-8 -*-
# annotations for src/components/permissions/PermissionDialog.tsx (72 lines)
ANNOTATIONS = [
    (7, 'before', '权限对话框外壳：圆角上边框、标题行（可带右侧附加内容）、内容区'),
    (17, 'before', 'PermissionDialog 被几十个权限请求复用，本文件只定义骨架'),
    (29, 'after', '默认边框色 permission：权限类弹窗统一主题色'),
    (30, 'after', 'innerPaddingX 默认 1：内容区左右各留一格'),
    (33, 'after', '标题交给 PermissionRequestTitle：标题、副标题、标题色、worker 徽章都在那里渲染'),
    (44, 'after', '标题行 justify space-between：titleRight 被推到最右'),
    (53, 'after', '内容区单独一层 Box：paddingX 可被调用方覆盖（例如需要贴边的表格）'),
    (62, 'after', '只保留上边框（左 右 底全为 false）：视觉上是一条顶部横线加圆角而不是完整卡片；marginTop 1 与上方内容留白'),
]
