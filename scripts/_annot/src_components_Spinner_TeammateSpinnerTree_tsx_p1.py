ANNOTATIONS = [
    (1, 'before', '''React Compiler 运行时，提供 `$` 记忆化缓存数组（编译产物标志）。'''),
    (8, 'before', '''引入 figures 图标、React、终端尺寸、应用状态与队友任务相关组件。'''),
    (10, 'before', '''Props：选中索引、是否处于选择模式、是否全部空闲，以及 leader（主控）的活动动词、token 数、空闲态文案。'''),
    (21, 'before', '''TeammateSpinnerTree：在输入栏旁渲染「主控 + 各队友」的旋转状态树。无运行中的队友时返回 null（由 early_return_sentinel 提前返回）。'''),
    (44, 'before', '''计算可见队友并按开始时间排序；判断主控是否被前台化或选中、是否高亮，以及是否要隐藏「hide」行（选择模式下聚焦末项时）。'''),
    (49, 'before', '''主控行是否前台化：viewingAgentTaskId 为 undefined 表示主控在前台；是否被选中等状态决定前缀与高亮。'''),
    (69, 'before', '''绘制主控行的连接线与名称：高亮时用不同圆角线（├─ 或 ┌─），非高亮用普通角；名称取 team-lead，颜色随是否选中变化。'''),
    (149, 'before', '''把每个队友映射成 TeammateSpinnerLine：传入是否最后一项、是否选中、是否前台化、是否全部空闲、是否显示消息预览。'''),
    (176, 'before', '''early_return_sentinel：若前面已决定提前返回（如 null），直接返回；否则继续渲染「hide」行与外层 Box。'''),
    (212, 'before', '''HideRow：选择模式下的「hide」折叠行，显示圆角线与 hide 字样，选中时提示 enter 折叠。'''),
]
