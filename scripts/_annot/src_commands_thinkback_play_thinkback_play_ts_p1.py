# 数据文件：source/src/commands/thinkback-play/thinkback-play.ts
ANNOTATIONS = [
    (1, 'after', """/thinkback-play 命令：从已安装的 thinkback 插件目录里取动画并播放；内部市场与官方市场按环境（ant 用内部名）区分插件 id。"""),
    (7, 'after', """内部市场名与技能名常量；插件 id 形如「thinkback@市场名」。"""),
    (10, 'after', """根据 USER_TYPE 决定走内部还是官方市场，拼出插件 id。"""),
    (18, 'after', """命令入口：加载已装插件 V2 配置，定位 thinkback 安装，未安装或路径缺失给出友好文案。"""),
    (24, 'after', """没装插件或安装列表为空时直接返回提示，不报错。"""),
    (32, 'after', """取第一个安装实例，缺路径则提示安装路径未找到。"""),
    (40, 'after', """拼接技能目录并调用 playAnimation 播放，返回动画消息文本。"""),
]
