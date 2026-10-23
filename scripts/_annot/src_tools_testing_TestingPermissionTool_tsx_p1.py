ANNOTATIONS = [
    (4, 'after', r'''文件头注释即用途：这是个测试专用工具，唯一职责是被模型调用时弹一次权限对话框。'''),
    (9, 'after', r'''NAME 与 inputSchema：空 strictObject，调用不带任何参数。'''),
    (19, 'after', r'''description/prompt 两句都明说 always asks——测试框架靠它验证权限链路。'''),
    (28, 'after', r'''同样一处恒假条件 "production" === 'test'：疑似泄漏构建的环境替换事故，isEnabled 实际恒 false，只在测试构建里才为真。'''),
    (36, 'after', r'''checkPermissions 恒 ask：这就是「测试钉子」——正常工具会分级（allow/ask/deny），它永远只走 ask，方便端到端测试权限弹窗的全链路。'''),
    (64, 'after', r'''call 只是回一句执行成功——工具本身不做事，存在意义全在权限交互上。'''),
    (69, 'after', r'''mapToolResultToToolResultBlockParam 用 String(result) 兜底转字符串。'''),
]
