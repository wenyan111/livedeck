import cloneDeep from 'lodash-es/cloneDeep'
import { providers } from 'shared/providers'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

export type AIProvider = string

type APIKeys = {
  [key in AIProvider]: string
}

/** 模型这一栏的两种填法：直连模型 ID / 方舟推理接入点 */
export type ModelInputMode = 'model' | 'endpoint'

export interface ProviderConfig {
  provider: AIProvider
  /**
   * 永远只存「模型 ID」（doubao-xxx / ep 之外的东西）。
   * 早期版本拿这一个字段在「模型 ID / 接入点」两种模式间来回覆盖，
   * 结果换模型时把上个模型的 ep 带了出来（2026-11-05 用户反复反馈「没分开」）。
   */
  model: string
  modelPreferences: {
    [key in AIProvider]: string
  }
  /**
   * 按模型分别记接入点：key = 模型 ID，value = 该模型自己的 ep-xxx。
   * 换模型自动取对应那份，从没填过就是空，绝不把别的模型的 ep 串过来。
   */
  endpointByModel: Record<string, string>
  /** 当前在用哪种填法（持久化，下次打开还是这个模式） */
  modelMode: ModelInputMode
}

export type AIConfigType = 'chat' | 'autoReply' | 'dashboard' | 'vision'

interface AIConfig {
  config: ProviderConfig
  apiKeys: APIKeys
  customBaseURL: string
}

interface AIProviderStore {
  chat: AIConfig
  autoReply: AIConfig
  dashboard: AIConfig
  vision: AIConfig
  setCustomBaseURL: (type: AIConfigType, url: string) => void
  setConfig: (type: AIConfigType, config: Partial<ProviderConfig>) => void
  setApiKey: (type: AIConfigType, provider: AIProvider, key: string) => void
  /** 写模型栏：model 模式改模型 ID；endpoint 模式只改「当前模型」对应的接入点 */
  setModelValue: (type: AIConfigType, mode: ModelInputMode, value: string) => void
  /** 只切换填法，不动任何值（两个模式从此真正分开） */
  switchModelMode: (type: AIConfigType, mode: ModelInputMode) => void
}

const createDefaultConfig = (): ProviderConfig => {
  const modelPreferences = Object.keys(providers).reduce(
    (acc, provider) => {
      acc[provider] = providers[provider].models[0] || ''
      return acc
    },
    {} as Record<string, string>,
  )

  return {
    provider: 'deepseek',
    model: providers.deepseek.models[0],
    modelPreferences,
    endpointByModel: {},
    modelMode: 'model',
  }
}

/** 老数据缺字段时补齐，避免 set 时 undefined 崩 */
const ensureShape = (config: ProviderConfig): ProviderConfig => {
  if (!config.modelPreferences) config.modelPreferences = {}
  if (!config.endpointByModel) config.endpointByModel = {}
  if (!config.modelMode) config.modelMode = 'model'
  return config
}

/** 实际发给模型的字段：接入点模式下用「当前模型」对应的 ep，否则用模型 ID */
export function getEffectiveModel(config: ProviderConfig): string {
  if (config.provider === 'volcengine' && config.modelMode === 'endpoint') {
    return config.endpointByModel?.[config.model] ?? ''
  }
  return config.model
}

/** 当前模型已记住的接入点（没填过就是空） */
export function getEndpointForCurrentModel(config: ProviderConfig): string {
  return config.endpointByModel?.[config.model] ?? ''
}

const createDefaultApiKeys = (): APIKeys => {
  return Object.keys(providers).reduce(
    (acc, provider) => {
      acc[provider] = ''
      return acc
    },
    {} as Record<string, string>,
  )
}

const createDefaultAIConfig = (): AIConfig => ({
  config: createDefaultConfig(),
  apiKeys: createDefaultApiKeys(),
  customBaseURL: '',
})

export const useAIProviderStore = create<AIProviderStore>()(
  persist(
    immer(set => {
      return {
        chat: createDefaultAIConfig(),
        autoReply: createDefaultAIConfig(),
        dashboard: createDefaultAIConfig(),
        vision: createDefaultAIConfig(),
        setCustomBaseURL: (type, url) => {
          set(state => {
            state[type].customBaseURL = url
          })
        },
        setConfig: (type, config) => {
          set(state => {
            const currentConfig = ensureShape(state[type].config)
            if (config.provider) {
              const newModel = config.model || currentConfig.modelPreferences[config.provider]
              state[type].config.provider = config.provider
              state[type].config.model = newModel
              state[type].config.modelPreferences[config.provider] = newModel
            } else if (config.model !== undefined) {
              // 注意：以前写成 `else if (config.model)`，空字符串会被当成"没传"忽略，
              // 于是「切到接入点模式时清空模型」这类操作根本没生效。
              state[type].config.model = config.model
              // 记住偏好，但不把空值覆盖进去（否则切回来是空的）
              if (config.model)
                state[type].config.modelPreferences[currentConfig.provider] = config.model
            }
          })
        },
        setModelValue: (type, mode, value) => {
          set(state => {
            const currentConfig = ensureShape(state[type].config)
            if (mode === 'endpoint') {
              // 只写「当前模型」这一格，模型 ID 本身不动
              const modelId = currentConfig.model
              if (value) {
                state[type].config.endpointByModel[modelId] = value
              } else {
                delete state[type].config.endpointByModel[modelId]
              }
              return
            }
            state[type].config.model = value
            if (value) state[type].config.modelPreferences[currentConfig.provider] = value
          })
        },
        switchModelMode: (type, mode) => {
          set(state => {
            ensureShape(state[type].config)
            state[type].config.modelMode = mode
          })
        },
        setApiKey: (type, provider, key) => {
          set(state => {
            state[type].apiKeys[provider] = key
          })
        },
      }
    }),
    {
      name: 'ai-chat-storage',
      partialize: state => ({
        chat: state.chat,
        autoReply: state.autoReply,
        dashboard: state.dashboard,
        vision: state.vision,
      }),
      version: 3,
      migrate: (persistedState: unknown, version: number) => {
        // 从原先 useAIChat 旧版本迁移
        if (version === 0) {
          const oldState = (persistedState as AIConfig) || createDefaultAIConfig()
          const migratedState = {
            chat: cloneDeep(oldState),
            autoReply: cloneDeep(oldState),
          }
          return migratedState
        }
        // v1/v2 → v3：模型 ID 与接入点彻底拆成两个字段。
        // 旧版把 ep- 值直接塞在 model 里，没法知道它属于哪个模型 —— 干脆丢弃，
        // 免得又把「上个模型的 ep」串到新模型上（用户明确不要）。
        const state = (persistedState ?? {}) as Record<string, AIConfig>
        for (const key of ['chat', 'autoReply', 'dashboard', 'vision']) {
          const cfg = state[key]?.config as ProviderConfig & { endpointPreferences?: unknown }
          if (!cfg) continue
          ensureShape(cfg)
          delete cfg.endpointPreferences
          if (typeof cfg.model === 'string' && cfg.model.trim().startsWith('ep-')) {
            cfg.model = cfg.modelPreferences?.[cfg.provider] || ''
            cfg.modelMode = 'endpoint'
          }
        }
        return state
      },
    },
  ),
)

export function useAIProvider(type: AIConfigType) {
  const store = useAIProviderStore()
  const props = store[type]
  const actions = {
    setConfig: (config: Partial<ProviderConfig>) => {
      store.setConfig(type, config)
    },
    setApiKey: (provider: AIProvider, key: string) => {
      store.setApiKey(type, provider, key)
    },
    setCustomBaseURL: (url: string) => {
      store.setCustomBaseURL(type, url)
    },
    setModelValue: (mode: ModelInputMode, value: string) => {
      store.setModelValue(type, mode, value)
    },
    switchModelMode: (mode: ModelInputMode) => {
      store.switchModelMode(type, mode)
    },
  }
  return {
    ...props,
    ...actions,
  }
}
