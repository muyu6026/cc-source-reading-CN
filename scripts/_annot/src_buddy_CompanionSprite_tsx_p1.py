# -*- coding: utf-8 -*-
"""buddy/CompanionSprite.tsx 批注数据（陪伴精灵渲染，React 编译器产物）。"""

ANNOTATIONS = [
    (1, 'before', '陪伴精灵的终端渲染：在窄屏折叠成一行脸 + 名字，宽屏画出带名字的精灵图与对话气泡，并负责气泡的淡出与宠物爱心动画'),
    (16, 'before', '一组时间常量：刷新间隔、气泡显示时长与淡出窗口、宠物爱心持续时间'),
    (23, 'before', 'IDLE_SEQUENCE：空闲动画序列，索引对应精灵帧，-1 表示在首帧上眨眼'),
    (27, 'before', 'PET_HEARTS：宠物互动时向上飘散的爱心图案'),
    (28, 'before', 'wrap：按宽度把气泡文字折行'),
    (43, 'before', 'SpeechBubble：气泡组件，按是否淡出与朝向（右 / 下）渲染边框与尾标'),
    (152, 'before', '宽屏精灵所需的最小列数，以及精灵主体宽度、各类内边距与气泡宽度'),
    (158, 'before', 'spriteColWidth：精灵列宽取主体宽度与名字宽度加内边距的较大者'),
    (167, 'before', 'companionReservedColumns：精灵区域占用的列数，PromptInput 据此收缩文字换行；全屏时气泡浮在回滚区上方不占宽'),
    (176, 'before', 'CompanionSprite：主组件，根据是否发言、是否全屏、列宽决定画完整精灵还是单行脸'),
    (201, 'before', '两个副作用定时器：一个驱动帧动画，一个在反应出现后定时清掉气泡'),
    (215, 'before', '未开启陪伴特性或被静音时直接不渲染'),
    (227, 'before', '窄屏：折叠成一行脸 + 名字（发言时名字让位给气泡内文字）'),
    (242, 'before', '宽屏：根据是否在反应 / 宠物中决定动画帧，眨眼用替换眼睛字符实现'),
    (266, 'before', '精灵列：竖向画精灵每一行与名字行，flexShrink 为 0 防止被内联气泡挤扁'),
    (274, 'before', '无反应时只画精灵，不画气泡'),
    (283, 'before', '全屏：气泡由 FullscreenLayout 的浮动槽位单独渲染，这里只画精灵主体'),
    (296, 'before', 'CompanionFloatingBubble：全屏模式下的浮动气泡，只读 companionReaction 并渲染淡出，清除定时器在别处'),
]
