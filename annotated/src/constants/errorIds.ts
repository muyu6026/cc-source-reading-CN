/**
 * Error IDs for tracking error sources in production.
 * These IDs are obfuscated identifiers that help us trace
 * which logError() call generated an error.
 *
 * These errors are represented as individual const exports for optimal
 * dead code elimination (external build will only see the numbers).
 *
 * ADDING A NEW ERROR TYPE:
 * 1. Add a const based on Next ID.
 * 2. Increment Next ID.
 * Next ID: 346
 */
// 错误标识文件：用混淆编号在生产环境追踪 logError 的调用来源，单个常量导出便于外部构建做死代码消除。

export const E_TOOL_USE_SUMMARY_GENERATION_FAILED = 344
// 当前最新一个错误标识常量，编号 344；新增时按文件头注释里的 Next ID 依次递增。
