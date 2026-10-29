# 数据文件：src/utils/generatedFiles.ts
# 中文批注锚点（行号以 Read 输出为准）。文本禁止英文双引号与反斜杠。
SOURCE_REL = 'src/utils/generatedFiles.ts'

ANNOTATIONS = [
    (2, 'after', '导入路径处理工具：basename/extname 取文件名与扩展名，posix/sep 处理跨平台分隔符。'),
    (22, 'after', '精确文件名黑名单（大小写不敏感）：各种锁文件与依赖冻结文件不计入提交归属。'),
    (35, 'after', '按扩展名排除：压缩、打包、生成产物与 .d.ts 声明文件等。'),
    (59, 'after', '按目录排除：dist/build/node_modules/vendor 等生成或第三方目录。'),
    (77, 'after', '用正则覆盖更复杂的生成文件命名规律，如 *.min.*、*.generated.*、protobuf 产物等。'),
    (126, 'after', 'isGeneratedFile：先归一化路径分隔符，再依次按文件名、扩展名（含复合扩展名）、目录、正则文件名模式判定是否应排除。'),
    (136, 'after', 'filterGeneratedFiles：对文件列表做一次过滤，剔除所有判定为生成文件的项。'),
]
