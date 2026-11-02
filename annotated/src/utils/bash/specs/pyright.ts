import type { CommandSpec } from '../registry.js'
// pyright 的命令规格：纯数据声明，供 bash 命令解析、参数校验与补全消费，不包含任何执行逻辑。

export default {
  name: 'pyright',
  description: 'Type checker for Python',
  options: [
// options 数组的字段约定：name 可以是单字符串或短长别名组，带参数的选项再挂 args（含占位名与 isOptional）。
    { name: ['--help', '-h'], description: 'Show help message' },
    { name: '--version', description: 'Print pyright version and exit' },
    {
      name: ['--watch', '-w'],
      description: 'Continue to run and watch for changes',
    },
    {
      name: ['--project', '-p'],
      description: 'Use the configuration file at this location',
      args: { name: 'FILE OR DIRECTORY' },
    },
    { name: '-', description: 'Read file or directory list from stdin' },
// 单独一个减号也是合法选项名：pyright 支持从 stdin 读文件列表，规格里要显式登记否则解析器不认。
    {
      name: '--createstub',
      description: 'Create type stub file(s) for import',
      args: { name: 'IMPORT' },
    },
    {
      name: ['--typeshedpath', '-t'],
      description: 'Use typeshed type stubs at this location',
      args: { name: 'DIRECTORY' },
    },
    {
      name: '--verifytypes',
      description: 'Verify completeness of types in py.typed package',
      args: { name: 'IMPORT' },
    },
// verifytypes 与 ignoreexternal 这对：先验包的类型完整性，再选择忽略外部导入；规格按官方 CLI 一比一抄录。
    {
      name: '--ignoreexternal',
      description: 'Ignore external imports for --verifytypes',
    },
    {
      name: '--pythonpath',
      description: 'Path to the Python interpreter',
      args: { name: 'FILE' },
    },
    {
      name: '--pythonplatform',
      description: 'Analyze for platform',
      args: { name: 'PLATFORM' },
    },
    {
      name: '--pythonversion',
      description: 'Analyze for Python version',
      args: { name: 'VERSION' },
    },
    {
      name: ['--venvpath', '-v'],
      description: 'Directory that contains virtual environments',
      args: { name: 'DIRECTORY' },
    },
    { name: '--outputjson', description: 'Output results in JSON format' },
// outputjson 是机器消费的入口：上层工具拿 JSON 结果而不是解析人类可读输出，规格里必须保留。
    { name: '--verbose', description: 'Emit verbose diagnostics' },
    { name: '--stats', description: 'Print detailed performance stats' },
    {
      name: '--dependencies',
      description: 'Emit import dependency information',
    },
    {
      name: '--level',
      description: 'Minimum diagnostic level',
      args: { name: 'LEVEL' },
    },
    {
      name: '--skipunannotated',
      description: 'Skip type analysis of unannotated functions',
    },
    {
      name: '--warnings',
      description: 'Use exit code of 1 if warnings are reported',
    },
    {
      name: '--threads',
      description: 'Use up to N threads to parallelize type checking',
      args: { name: 'N', isOptional: true },
    },
  ],
// 选项清单到此为止：共 21 项，覆盖帮助、监听、工程配置、类型桩、解释器定位与输出控制。
  args: {
    name: 'files',
    description:
      'Specify files or directories to analyze (overrides config file)',
    isVariadic: true,
    isOptional: true,
  },
} satisfies CommandSpec
// satisfies CommandSpec 是结构校验：写错字段名或漏必填项在编译期就报错，不等到运行时解析命令才炸。
