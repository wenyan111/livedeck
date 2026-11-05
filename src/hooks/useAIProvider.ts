import cloneDeep from 'lodash-es/cloneDeep'
import { providers } from 'shared/providers'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

export type AIProvider = string

type APIKeys = {
  [key in AIProvider]: string
}

export interface ProviderConfig {
  provider: AIProvider
  model: string
  modelPreferences: {
    [key in AIProvider]: string
  }
  /**
   * 「接入点 ep-xxx」模式下每个服务商各自记住的值。
   *
   * 为什么单独存一份：模型 ID 和接入点是两种互斥的填法，
   * 早先的做法是「切模式就把输入框清空」，用户切一下就把刚粘进去的 ep 弄丢了
   * （2026-11-05 用户报「我填过了但是没有记住」）。现在两边各记一份，切来切去都还在。
   */
  endpointPreferences: {
    [key in AIProvider]: string
  }
}

export type AIConfigType = 'chat' | 'autoReply' | 'dashboard' | 'vision'

/** 模型这一栏的两种填法：直连模型 ID / 方舟推理接入点 */
export type ModelInputMode = 'model' | 'endpoint'

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
  /** 写「模型」这一栏，并按当前模式记进对应的偏好表（model / endpoint 各一份） */
  setModelValue: (type: AIConfigType, mode: ModelInputMode, value: string) => void
  /** 切换填法：把该模式下上次填过的值回填到输入框（不清空） */
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
  const endpointPreferences = Object.keys(providers).reduce(
    (acc, provider) => {
      acc[provider] = ''
      return acc
    },
    {} as Record<string, string>,
  )

  return {
    provider: 'deepseek',
    model: providers.deepseek.models[0],
    modelPreferences,
    endpointPreferences,
  }
}

/** 老数据没有 endpointPreferences 字段，读的时候补齐，避免 set 时 undefined 崩 */
const ensurePreferences = (config: ProviderConfig): ProviderConfig => {
  if (!config.endpointPreferences) config.endpointPreferences = {}
  if (!config.modelPreferences) config.modelPreferences = {}
  return config
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
            const currentConfig = ensurePreferences(state[type].config)
            if (config.provider) {
              const newModel = config.model || currentConfig.modelPreferences[config.provider]
              state[type].config.provider = config.provider
              state[type].config.model = newModel
              state[type].config.modelPreferences[config.provider] = newModel
            } else if (config.model !== undefined) {
              // 注意：以前写成 `else if (config.model)`，空字符串会被当成"没传"忽略，
              // 于是「切到接入点模式时清空模型」这类操作根本没生效（2026-11-05 用户报「点了不切换」）。
              state[type].config.model = config.model
              // 记住偏好，但不把空值覆盖进去（否则切回来是空的）
              if (config.model)
                state[type].config.modelPreferences[currentConfig.provider] = config.model
            }
          })
        },
        setModelValue: (type, mode, value) => {
          set(state => {
            const currentConfig = ensurePreferences(state[type].config)
            state[type].config.model = value
            // 只有非空才写偏好，否则用户清空一下就再也回不来了
            if (value) {
              if (mode === 'endpoint') {
                state[type].config.endpointPreferences[currentConfig.provider] = value
              } else {
                state[type].config.modelPreferences[currentConfig.provider] = value
              }
            }
          })
        },
        switchModelMode: (type, mode) => {
          set(state => {
            const currentConfig = ensurePreferences(state[type].config)
            const provider = currentConfig.provider
            state[type].config.model =
              mode === 'endpoint'
                ? (currentConfig.endpointPreferences[provider] ?? '')
                : (currentConfig.modelPreferences[provider] ?? '')
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
      version: 2,
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
        // v1 → v2：给每个配置补上「接入点」偏好表（老数据没这个字段）
        if (version === 1) {
          const state = (persistedState ?? {}) as Record<string, AIConfig>
          for (const key of ['chat', 'autoReply', 'dashboard', 'vision']) {
            if (state[key]?.config) ensurePreferences(state[key].config)
          }
          return state
        }
        return persistedState
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
