# -*- coding: utf-8 -*-
"""src/commands/install-github-app/CheckExistingSecretStep.tsx 批注数据（第 161 批）。"""

ANNOTATIONS = [
    (7, 'before', '''本步骤的入参：是否复用已有 secret、secret 名、以及几个切换与提交回调'''),
    (14, 'before', '''编译产物步骤组件：用 React 编译器的记忆化缓存重建每个派生值，避免重复计算'''),
    (23, 'before', '''光标偏移与主题等 UI 状态用普通 hook 持有'''),
    (69, 'before', '''第一组键位：在确认上下文里绑定上一步、下一步、确认三个动作'''),
    (94, 'before', '''第二组键位：当不复用已有 secret 时，把三个动作绑到另一个上下文'''),
    (97, 'before', '''标题区：固定文案 Install GitHub App 与副标题，记忆化一次'''),
    (151, 'before', '''新建 secret 输入框：只有在不复用时才渲染，带占位符与光标控制'''),
    (164, 'before', '''把前面几段组装进一个圆角边框盒子，记忆化一次'''),
    (174, 'before', '''底部提示行：上下键选择、回车继续'''),
    (188, 'before', '''最终返回：把主盒子与提示行包在一起输出'''),
]
