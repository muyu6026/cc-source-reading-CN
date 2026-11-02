// 本文件维护一份「会话级环境变量」表：这些变量只注入给派生的子进程（经由 bash provider 的环境覆盖），不会污染 REPL 主进程自身。
/**
 * Session-scoped environment variables set via /env.
 * Applied only to spawned child processes (via bash provider env overrides),
 * not to the REPL process itself.
 */
const sessionEnvVars = new Map<string, string>()
// sessionEnvVars 是核心容器，一个以变量名为键、字符串为值的 Map，所有读写都围绕它进行。

export function getSessionEnvVars(): ReadonlyMap<string, string> {
  return sessionEnvVars
}

export function setSessionEnvVar(name: string, value: string): void {
  sessionEnvVars.set(name, value)
}
// setSessionEnvVar 向表中写入单个变量；若变量已存在则覆盖原值。

export function deleteSessionEnvVar(name: string): void {
  sessionEnvVars.delete(name)
}

export function clearSessionEnvVars(): void {
  sessionEnvVars.clear()
}
// clearSessionEnvVars 清空整张表。四个导出函数分别从「读」「写」「删」「清」四个角度操作同一份会话环境表。
