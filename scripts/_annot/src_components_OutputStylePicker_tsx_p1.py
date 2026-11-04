# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (11, 'before', '默认样式的名称与描述常量：自定义样式目录里缺配置的条目回退到这两个值——选项列表永远不出现空 label。'),
    (13, 'before', 'mapConfigsToOptions：把样式配置表转成 Select 选项。config 为 null 的条目（目录里有文件但解析失败或无元数据）就地回退默认文案，不让一个坏文件拖垮整个列表。'),
    (28, 'before', 'OutputStylePicker：选择 Claude 的输出风格（简洁代码向、解释型等）。既可嵌在设置菜单里也可作为独立命令，isStandaloneCommand 区分两种形态。'),
    (37, 'before', 'styleOptions 初始空数组进哨兵槽：所有渲染里的空数组共用同一引用，配合 isLoading 的加载文案，列表为空期间 Select 不渲染。'),
    (47, 'before', '挂载加载与依赖数组一起进哨兵槽：getAllOutputStyles 按当前工作目录扫描自定义样式；失败回退内置 OUTPUT_STYLE_CONFIG——扫描出错也要能选内置风格，catch 里同样收尾 loading。'),
    (68, 'before', 'handleStyleSelect 依赖 onComplete 记忆化：值直接透传为 OutputStyle，无转换。'),
    (79, 'before', '两个布尔在渲染体里算两次（t5 与 t6 同值）：非独立命令时隐藏输入引导与边框——嵌在菜单里的选择器要去掉弹窗的装饰层，两个 hide 参数各自取值，编译器不合并。'),
    (90, 'before', '主体：加载中显示暗色文案，就绪后渲染 Select。visibleOptionCount 为 10：样式多时列表内部滚动，弹窗高度封顶。defaultValue 用 initialStyle 回显当前选择。'),
    (101, 'before', 'Dialog：onCancel 原样透传。标题 Preferred output style——输出风格改的是 Claude 与你交流的方式，不是代码行为。'),
]
