# source: src/utils/immediateCommand.ts
ANNOTATIONS = [
    (1, 'before', '''决定推理配置类命令（/model、/fast、/effort）是否应当在运行中的查询期间「立即执行」，而不是等到当前回合结束再执行。'''),
    (15, 'after', '''判定逻辑：蚂蚁内部用户（环境变量 USER_TYPE 等于 ant）永远开启；外部用户则受名为 tengu_immediate_model_command 的实验开关控制，这里读取的是可能略旧的缓存值。'''),
]
