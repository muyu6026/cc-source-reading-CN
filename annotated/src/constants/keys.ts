import { isEnvTruthy } from '../utils/envUtils.js'

// Lazy read so ENABLE_GROWTHBOOK_DEV from globalSettings.env (applied after
// module load) is picked up. USER_TYPE is a build-time define so it's safe.
// 这段英文注释说明为什么要惰性读取——ENABLE_GROWTHBOOK_DEV 在模块加载之后才由全局设置注入，
// 如果写成模块加载期常量就会抓不到它；而 USER_TYPE 是构建期宏，构建时即确定，读它安全。
export function getGrowthBookClientKey(): string {
// 导出一个函数：根据当前运行环境返回对应的 GrowthBook 客户端密钥（SDK key），用于功能开关实验。
  return process.env.USER_TYPE === 'ant'
// 第一层分流按 USER_TYPE：内部 ant 用户走实验通道，其余用户走正式通道。
    ? isEnvTruthy(process.env.ENABLE_GROWTHBOOK_DEV)
      ? 'sdk-yZQvlplybuXjYh6L'
// ant 用户内部再按 ENABLE_GROWTHBOOK_DEV 区分开发与正式两套实验密钥。
      : 'sdk-xRVcrliHIlrg4og4'
    : 'sdk-zAZezfDKGoZuXXKe'
}
