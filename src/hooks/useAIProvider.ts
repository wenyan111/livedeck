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
  /**
   * 当前在用的那个值（模型 ID 或 ep-xxx 都行，原样发给接口）。
   * 2026-11-06 起不再区分「模型 ID / 接入点」两种模式 —— 用户要的是
   * 「一个输入框 + 一份可自建、点一下就切的备用列表」，模式开关反而绕。
   */
  model: string
  modelPreferences: {
    [key in AIProvider]: string
  }
  /**
   * 按服务商分开存的模型清单（key = 服务商，value = 一串模型 ID 或 ep）。
   * 每个板块都能在这里攒几条，前面一个「切换」按钮点一下就用它（2026-11-06 用户要求）。
   */
  savedModels: Record<AIProvider, string[]>
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
  /** 写当前模型栏（模型 ID 或 ep 都行） */
  setModelValue: (type: AIConfigType, value: string) => void
  /** 在列表末尾加一条空模型，等着填 */
  addSavedModel: (type: AIConfigType) => void
  /** 改第 index 条的内容 */
  updateSavedModel: (type: AIConfigType, index: number, value: string) => void
  /** 删掉第 index 条 */
  removeSavedModel: (type: AIConfigType, index: number) => void
}

/** 方舟常用视觉模型：第一次打开就有三条，可自行删除或添加别的 */
export const VOLC_PRESET_MODELS = [
  'doubao-seed-2-1-pro-260915',
  'doubao-seed-2-1-turbo-260628',
  'doubao-seed-2-0-lite-260428',
]

const defaultSavedModels = (): Record<AIProvider, string[]> => ({
  volcengine: [...VOLC_PRESET_MODELS],
})

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
    savedModels: defaultSavedModels(),
  }
}

/** 老数据缺字段时补齐，避免 set 时 undefined 崩 */
const ensureShape = (config: ProviderConfig): ProviderConfig => {
  if (!config.modelPreferences) config.modelPreferences = {}
  if (!config.savedModels) config.savedModels = defaultSavedModels()
  // 当前在用的模型必须能在清单里看到，否则列表和实际用的对不上（自定义服务商没有预置项，全靠这条）
  if (config.model) {
    const list = config.savedModels[config.provider]
    if (!list) {
      config.savedModels[config.provider] = [config.model]
    } else if (!list.includes(config.model)) {
      list.unshift(config.model)
    }
  }
  return config
}

/** 实际发给模型的字段：当前模型栏里写什么就用什么 */
export function getEffectiveModel(config: ProviderConfig): string {
  return config.model
}

/** 当前服务商名下的模型清单 */
export function getSavedModels(config: ProviderConfig): string[] {
  return config.savedModels?.[config.provider] ?? []
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
              // 于是「清空模型栏」这类操作根本没生效。
              state[type].config.model = config.model
              // 记住偏好，但不把空值覆盖进去（否则切回来是空的）
              if (config.model)
                state[type].config.modelPreferences[currentConfig.provider] = config.model
            }
          })
        },
        setModelValue: (type, value) => {
          set(state => {
            const cfg = ensureShape(state[type].config)
            cfg.model = value
            if (value) cfg.modelPreferences[cfg.provider] = value
          })
        },
        addSavedModel: type => {
          set(state => {
            const cfg = ensureShape(state[type].config)
            let list = cfg.savedModels[cfg.provider]
            if (!list) {
              list = []
              cfg.savedModels[cfg.provider] = list
            }
            list.push('')
          })
        },
        updateSavedModel: (type, index, value) => {
          set(state => {
            const cfg = ensureShape(state[type].config)
            const list = cfg.savedModels[cfg.provider]
            if (list && list[index] !== undefined) list[index] = value
          })
        },
        removeSavedModel: (type, index) => {
          set(state => {
            const cfg = ensureShape(state[type].config)
            const list = cfg.savedModels[cfg.provider]
            if (list) list.splice(index, 1)
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
      version: 5,
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
        // v1~v4 → v5：模型栏就是「一串模型 + 每条一个切换按钮」，不再有模式开关，也没有名字/备注。
        // 老的 endpointByModel 一条条转成清单里的值（当前模式决定当下在用哪条），
        // v4 那种 { label, value } 结构在这里统一摊平成字符串，用户辛苦填的 ep 一个都不会丢。
        const state = (persistedState ?? {}) as Record<string, AIConfig>
        for (const key of ['chat', 'autoReply', 'dashboard', 'vision']) {
          const cfg = state[key]?.config as
            | (ProviderConfig & {
                endpointByModel?: Record<string, string>
                endpointPreferences?: unknown
                modelMode?: string
              })
            | undefined
          if (!cfg) continue
          const legacyEndpoints = cfg.endpointByModel ?? {}
          const legacyMode = cfg.modelMode
          delete cfg.endpointByModel
          delete cfg.endpointPreferences
          delete cfg.modelMode
          if (!cfg.savedModels) cfg.savedModels = defaultSavedModels()
          // v4 存的是 { label, value }，v5 只要字符串，先统一摊平
          const toText = (item: unknown): string => {
            if (typeof item === 'string') return item
            if (item && typeof item === 'object' && 'value' in item) {
              const value = (item as { value?: unknown }).value
              return typeof value === 'string' ? value : ''
            }
            return ''
          }
          const flattened: Record<string, string[]> = {}
          for (const [provider, list] of Object.entries(cfg.savedModels ?? {})) {
            flattened[provider] = Array.isArray(list) ? list.map(toText).filter(Boolean) : []
          }
          cfg.savedModels = flattened
          let volc = cfg.savedModels.volcengine
          if (!volc) {
            volc = []
            cfg.savedModels.volcengine = volc
          }
          for (const ep of Object.values(legacyEndpoints)) {
            if (!ep || volc.includes(ep)) continue
            volc.push(ep)
          }
          // 老版本如果是「接入点模式」，当下在用的就是这个模型的 ep
          if (legacyMode === 'endpoint' && cfg.model && legacyEndpoints[cfg.model]) {
            cfg.model = legacyEndpoints[cfg.model]
          }
          ensureShape(cfg)
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
    setModelValue: (value: string) => {
      store.setModelValue(type, value)
    },
    addSavedModel: () => {
      store.addSavedModel(type)
    },
    updateSavedModel: (index: number, value: string) => {
      store.updateSavedModel(type, index, value)
    },
    removeSavedModel: (index: number) => {
      store.removeSavedModel(type, index)
    },
  }
  return {
    ...props,
    ...actions,
  }
}
