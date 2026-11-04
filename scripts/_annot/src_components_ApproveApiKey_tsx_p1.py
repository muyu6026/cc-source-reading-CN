# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (7, 'before', 'Props：customApiKeyTruncated 是脱敏后的密钥尾部（sk-ant 开头加末几位），用于展示与配置记录；onDone 把 yes 与 no 归一成布尔回调。'),
    (11, 'before', '环境变量里检测到自定义 API key 时的确认弹窗。默认选项是拒绝——弹窗的色彩也用了 warning。整个组件就是一个 Dialog 加一个双选项 Select。'),
    (18, 'before', 'onChange 依赖两个 props，被编译器包进记忆槽：只有密钥或回调变化才重建函数。函数体内按选择写全局配置。'),
    (20, 'before', 'bb2 标签块：编译器把 switch 的 break 重写成 break bb2（跳出带标签的块），不是业务代码里的标签语法——与前批 DiffDialog 里的 bb0 同源，读反编译产物时的固定套路。'),
    (23, 'before', '同意分支：把脱敏密钥追加进全局配置的 approved 数组。saveGlobalConfig 接收函数式更新器，基于当前值展开追加，避免读改写竞态。'),
    (35, 'before', '拒绝分支：结构对称，密钥进 rejected 数组。approved 与 rejected 两个列表后续用于跳过对同一密钥的重复询问。'),
    (55, 'before', 'onCancel 也走 no：Esc 关闭弹窗等价于拒绝，不留下「没回答」的第三态。t2 在第 55 行先于 Select 构造，供 Dialog 的 onCancel 复用。'),
    (84, 'before', '选项数组进常量槽（sentinel 判断后只建一次）：两个选项对象在组件生命周期内不变。'),
    (96, 'before', 'No 选项标注 recommended 加粗：产品立场是默认不信环境变量里的密钥——用户需要显式确认才启用，且每次问询的答案都被记进配置不再重复问。'),
    (105, 'before', 'defaultValue 与 defaultFocusValue 都设为 no：初始选中与初始焦点都在拒绝项上，直接回车即拒绝。onCancel 走同一 onChange，与第 55 行呼应。'),
]
