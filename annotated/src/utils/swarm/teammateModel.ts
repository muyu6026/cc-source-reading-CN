// 文件级。决定新建队友默认用什么模型：当用户没在 `/config` 里设过 `teammateDefaultModel` 时，回退到硬编码的 Opus 4.6。
import { CLAUDE_OPUS_4_6_CONFIG } from '../model/configs.js'
import { getAPIProvider } from '../model/providers.js'

// @[MODEL LAUNCH]: Update the fallback model below.
// When the user has never set teammateDefaultModel in /config, new teammates
// use Opus 4.6. Must be provider-aware so Bedrock/Vertex/Foundry customers get
// the correct model ID.
// 这段注释是发布提示：每次上线新模型都要手动更新下面的回退值，且必须区分 provider（Bedrock/Vertex/Foundry 拿到的模型 ID 不同）。
export function getHardcodedTeammateModelFallback(): string {
  return CLAUDE_OPUS_4_6_CONFIG[getAPIProvider()]
}
// 按当前 provider 取出对应的 Opus 4.6 模型 ID 作为回退值。
