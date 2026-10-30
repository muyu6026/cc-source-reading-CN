ANNOTATIONS = [
    (18, 'after', '''枚举超时常数：设 1 秒，超时则工具描述省略应用列表。'''),
    (44, 'after', '''tryGetInstalledAppNames 收尾：枚举超时或失败都软失败，枚举在后台继续，模型只是少提示。'''),
    (46, 'after', '''createComputerUseMcpServerForCli 文档：块注释说明为何替换 ListTools 处理器。'''),
    (78, 'after', '''createComputerUseMcpServerForCli 收尾：异步以免 1 秒枚举阻塞启动，真实调度仍走 wrapper 的 call 覆盖。'''),
    (106, 'after', '''runComputerUseMcpServer 收尾：子进程入口，stdio 传输，stdin 关闭即退出，退出前冲刷分析数据。'''),
]
