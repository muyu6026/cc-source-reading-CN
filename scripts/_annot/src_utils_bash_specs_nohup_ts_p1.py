# 批注数据：source/src/utils/bash/specs/nohup.ts
ANNOTATIONS = [
    (1, 'before', '''文件级。把 `nohup` 注册成 bash 内置命令规格：运行一个对挂断免疫的命令。'''),
    (11, 'after', '''`args` 在此收尾，声明必填的 `command` 参数并标 `isCommand`，表示这个参数本身是一条要执行的命令。'''),
    (13, 'after', '''默认导出交给上层注册器。'''),
]
