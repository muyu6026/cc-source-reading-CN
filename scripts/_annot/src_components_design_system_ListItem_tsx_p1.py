# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '设计系统的基础列表项：把所有选择类界面共有的「焦点指针、选中对勾、滚动提示箭头、状态配色」收敛到一处。'),
    (104, 'before', '32 个记忆槽位。props 默认值不用解构默认语法而用三元补齐（117-119 行），是因为编译器需要稳定的比较语义。'),
    (117, 'before', '三个布尔 prop 补默认值：isSelected 默认 false、styled 默认 true、disabled 默认 false。用 undefined 比较而不是 ?? 是编译器展开后的形态。'),
    (122, 'before', '指示器渲染优先级：禁用 > 焦点指针 > 下滚动箭头 > 上滚动箭头 > 空格占位。占位空格保证所有行左缘对齐。'),
    (127, 'before', '焦点指针用 suggestion 色——聚焦表示「光标在这」，与「已选中」是两个正交状态。'),
    (148, 'before', '文字颜色同样是四态优先级：禁用 inactive、styled 关掉时不着色（返回 undefined 交出控制权）、选中 success、聚焦 suggestion。'),
    (153, 'before', 'styled 为 false 时返回 undefined：调用方自定义样式时组件完全不干预文字颜色，只保留指示器。'),
    (172, 'before', '光标声明条件：聚焦、未禁用、且调用方没有声明「子组件自带光标」三者同时成立才由本项接管终端光标位置。'),
    (176, 'before', '光标描述对象：声明在第 0 行第 0 列，即本列表项的左上角。active 才是真正的开关字段。'),
    (185, 'before', 'useDeclaredCursor 把声明注册到渲染树，终端据此放置真实的物理光标——Ink 没有全局光标管理，靠各组件协商声明。'),
    (196, 'before', 'styled 为 true 时用状态色包一层 Text，disabled 附加灰显；styled 为 false 时 children 原样输出，一字不改。'),
    (207, 'before', '对勾只看「选中且未禁用」，与是否聚焦无关——多选列表里可以同时有多行打勾。'),
    (226, 'before', '描述文本缩进两格渲染在主行下方，用 inactive 色弱化，形成主次层级。'),
]
