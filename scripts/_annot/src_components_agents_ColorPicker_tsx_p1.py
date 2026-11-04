# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (9, 'before', 'COLOR_OPTIONS：automatic 排第一，后接全部内置代理色。automatic 是「让系统按代理名哈希自动分配」，确认时要映射回 undefined。'),
    (15, 'before', 'ColorPicker：给代理挑标识色的自绘列表。不用通用 Select 是因为每个选项要渲染真实色块预览，通用选项行装不下。'),
    (22, 'before', 'currentColor 的 undefined 归一成 automatic：props 缺省与「用户选了自动」在内部是同一个状态，确认时再逆向映射回 undefined。'),
    (24, 'before', '初始下标由当前色查找得到，Math.max 防 findIndex 返回 -1——找不到就从第一项开始，绝不带负下标进场。'),
    (34, 'before', '自绘键盘处理：up、down 循环移动（钳制函数见文件尾 _temp 系列，到头绕回另一端），return 确认。preventDefault 防止按键继续冒泡。'),
    (46, 'before', '确认时 automatic 映射回 undefined：存储层里 undefined 才是「未指定、自动分配」的表示，列表层的 automatic 只是它的展示名。'),
    (63, 'before', '列表渲染：选中行前是箭头指针否则空格对齐；automatic 加粗显示；具体颜色渲染一个背景色空格色块加首字母大写的颜色名——色块用真实主题色，所见即所得。'),
    (87, 'before', '预览行：用实际的 @代理名 加选中背景色渲染——挑色时看到的就是聊天里将出现的样子。automatic 用反色白底。'),
    (96, 'before', '容器 tabIndex 为 0 且 autoFocus：获得焦点后 onKeyDown 才生效。自绘列表的键盘焦点管理完全落在这一层，与 Select 体系并行。'),
    (106, 'before', '两个环形钳制：down 到尾绕回头、up 到头绕回尾。提取为模块级函数让 setSelectedIndex 的更新器引用稳定。'),
]
