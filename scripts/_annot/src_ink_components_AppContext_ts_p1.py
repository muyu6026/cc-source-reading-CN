# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (16, 'after', '''// 默认值是空函数 —— 在 Ink 树外调 exit() 什么也不会发生，**不报错**。
//
// 这个取舍对库来说是对的（组件可以被单独测试），但它掩盖了一个常见
// 错误：在树外（比如模块顶层、或者一个没有被 Provider 包住的组件里）
// 调 useApp().exit，表现是「点了退出没反应」。
//
// 对照 StdinContext 的默认值更糟一点：它默认造了一个真的 EventEmitter，
// 于是 useInput 在树外会**正常注册**监听者，只是永远没人 emit。'''),
]
