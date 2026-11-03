# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (12, 'after', '''Props 类型：onComplete 在完成（或跳过）时回传结果与展示选项。'''),
    (58, 'after', '''主组件按优先级分流：沙箱未启用→提示开启；被策略锁定→只读展示当前设置；否则渲染选择器。'''),
    (83, 'after', '''根据当前模式拼出选项标签，已在用的模式追加「(current)」标记。'''),
    (132, 'after', '''handleSelect 将用户选择写入沙箱设置（open=允许逃逸 / closed=严格沙箱），再回调 onComplete。'''),
    (192, 'after', '''OverridesSelect 渲染模式选择 + 两种模式的说明文案与文档链接，
拆分出来是为让 useTabHeaderFocus 只在真正渲染选择时才注册方向键聚焦。'''),
]
