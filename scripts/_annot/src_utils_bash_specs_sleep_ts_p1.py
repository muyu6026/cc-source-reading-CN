# 批注数据：source/src/utils/bash/specs/sleep.ts
ANNOTATIONS = [
    (1, 'before', '''文件级。把 `sleep` 注册成一个 bash 内置命令规格：延迟指定时长。'''),
    (11, 'after', '''`args` 在此收尾，声明一个必填的 `duration` 参数，说明里举例可用 `5s`、`2m`、`1h` 这类带后缀的写法。'''),
    (13, 'after', '''以默认导出把这份规格对象交给上层注册器。'''),
]
