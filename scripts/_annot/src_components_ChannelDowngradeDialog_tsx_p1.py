# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (6, 'before', 'ChannelDowngradeChoice 三值：downgrade 接受可能降级、stay 留在当前版本等 stable 追上、cancel 取消切换。'),
    (16, 'before', 'ChannelDowngradeDialog：从 latest 渠道切到 stable 时的确认——stable 版本可能比当前运行的旧，直接切等于降级，必须明说并让用户选。'),
    (24, 'before', 'handleSelect 透传 onChoice；handleCancel 映射为 cancel——Esc 不默认接受降级也不默认留下，交回上层决定。'),
    (46, 'before', '风险说明依赖 currentVersion 单值缓存：明确告诉用户 stable 可能比当前版本旧，括号里是当前版本号——用户能自己判断差距多大。'),
    (61, 'before', '选项数组两进两出：第一项（允许降级）进哨兵槽；第二项的 label 动态拼当前版本号，依赖版本单值缓存。stay 文案精确描述了后果——版本不回退，只是停更到 stable 追上。'),
    (92, 'before', 'Dialog permission 色、隐藏边框与输入引导——这是嵌在渠道切换流程里的确认步骤，不是独立弹窗，装饰层全去掉。'),
]
