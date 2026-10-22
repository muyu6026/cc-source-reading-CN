# -*- coding: utf-8 -*-
"""REPLTool/primitiveTools.ts 第 1 部分"""

ANNOTATIONS = [
    (11, 'after', '''模块级缓存：首次调用后把原语工具数组缓存住，后续直接返回同一实例。'''),
    (28, 'before', '''getReplPrimitiveTools：REPL_ONLY_TOOLS 对应的工具实例表——REPL 模式下被藏起
但 REPL VM 内部仍可调用的原语。'''),
    (39, 'after', '''三个实现细节：
① 惰性 getter（??= 延迟初始化）：import 链 collapseReadSearch → primitiveTools → FileReadTool
   会绕回工具注册表，模块顶层 const 会撞 TDZ「Cannot access before initialization」；
② 直接列实例而非走 getAllBaseTools()：后者在 hasEmbeddedSearchTools() 时会剔除 Glob/Grep；
③ 导出是为了展示侧（collapseReadSearch、渲染器）能给这些被隐藏工具的虚拟消息分类/渲染。'''),
]
