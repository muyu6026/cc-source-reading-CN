# source: src/utils/nativeInstaller/index.ts
ANNOTATIONS = [
    (1, 'before', '''这是原生安装器的「桶文件」（barrel），只重新导出外部模块真正会用到的函数与类型，外部模块应当只从这个文件导入，而不碰实现文件。'''),
    (18, 'after', '''重新导出的内容——checkInstall、各类 cleanup、installLatest、lockCurrentVersion、removeInstalledSymlink 以及类型 SetupMessage——全部来自真正的实现文件 installer.js。'''),
]
