# 源文件: src/commands/bridge/index.ts
ANNOTATIONS = [
    (5, 'after', '''桥接命令的总开关：先确认编译期开启了 BRIDGE_MODE 特性，再调用 isBridgeEnabled 看桥接是否打开。'''),
    (10, 'after', '''两层判定都满足才返回 true（特性开关 + 实际桥接开关）。'''),
    (12, 'after', '''命令定义：把当前终端接入远程控制会话；命令名为 remote-control，别名 rc。'''),
    (24, 'after', '''满足 Command 类型；immediate 立即执行，isHidden 与 isEnabled 相反，按需懒加载 bridge.js。'''),
]
