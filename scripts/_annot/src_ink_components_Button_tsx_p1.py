# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (38, 'after', '''// 【children 是 render prop，这是这个组件唯一的「设计」】
//
//   children: ((state: ButtonState) => ReactNode) | ReactNode
//
// Button 自己**不设任何样式** —— 没有 hover 变亮、没有 focus 描边。
// 它只负责把三态（focused / hovered / active）算出来交给调用方。
//
// 这么做的原因很实际：终端的「按钮」长什么样，取决于它在界面里的角色
// （工具栏图标、对话框主按钮、列表项）。内置一套样式必然有一半场景
// 不合适，而不合适的样式比没有样式更难覆盖。
//
// 代价：每个 Button 的调用方都要写一遍 `(s) => <Text ...>`，
// 实际项目里通常再包一层自己的 Button。'''),
    (71, 'after', '''// tabIndex 默认 **0** —— 和其他组件相反。
//
// 对照 Box：Box 的 tabIndex 是可选无默认（不传就不进 Tab 环），
// 而 Button 不传就是 0（进 Tab 环）。理由是语义：Button 的存在意义
// 就是被激活，不进 Tab 环的 Button 是无用的；Box 大多只是布局容器。
//
// -1 的含义是「可编程聚焦，但不参与 Tab 环」—— 用于「点了才聚焦」的
// 场景（比如画布上的节点）。'''),
    (102, 'after', '''// active 态是个 100ms 的定时器：按下去 → setIsActive(true) → 100ms 后
// 自动设回 false。
//
// 这不是「按下期间保持」，而是「按一下闪一下」。因为没有 keyup：
// onKeyDown 已经到了，但终端没有稳定的「松开」事件可言
// （键盘的 release 只有 kitty 协议才报）。所以只能用定时器假装。
//
// 副作用：按住不放不会持续 active（只有第一次按下会闪）。这在
// 终端里反而更符合直觉 —— 终端的「长按」本来就没有语义。'''),
    (110, 'after', '''// `e.key === 'return' || e.key === ' '` —— 这两个字符串来自
// keyboard-event.ts 的 keyFromParsed：
//
//   Return 的 sequence 是控制字节 0x0d（不可打印）→ 用 name 'return'
//   空格是单字符可打印 → 直接用 sequence ' '
//
// 也就是同一个判断里混了两种来源。如果哪天 normalize 成 'Enter'/'Space'
// （浏览器风格），这里和所有调用方都要跟着改 —— 而现在用的是
// parse-keypress 的表里的名字，不是 DOM 的 standard key values。
//
// preventDefault：拦掉 Tab 导航那种「默认行为」。对 return/space 来说
// 拦的是……什么都没有（没有默认动作），但写上无害，也防止未来
// 加了默认行为后忘记。'''),
    (160, 'after', '''// state 对象每次渲染都新造（在 memo 分支里，所以只有三态变化时才造），
// 然后整个交给 render prop。
//
// 这意味着调用方**不能**把它放进依赖数组（引用每次都变）。
// 实际用法都是解构：`({focused}) => ...`，不持有对象本身。'''),
    (173, 'after', '''// `{...style}` 放在所有 handler **之后**，覆盖优先级最高 ——
// 但因为 Props 是 `Except<Styles, 'textWrap'> & {...}`，而 Styles 里
// 没有 on* 字段，style 里不可能包含 handler。所以这个顺序实际不产生
// 覆盖，只是「把剩下的样式统统交给 Box」的写法。
//
// 也正因为如此，Button 能透传 Box 的所有布局属性（width、margin、
// borderStyle…），而不用一个个列举 —— 这是 render prop 之外的第二个
// 灵活性来源。'''),
]
