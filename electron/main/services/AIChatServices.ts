import OpenAI, { AuthenticationError, NotFoundError } from 'openai'
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions'
import { createLogger } from '#/logger'
import { providerService } from '#/services/ProviderService'

type ProviderType = string

interface ChatMessage {
  role: 'assistant' | 'system' | 'user'
  content: string
}

const checkAPIKeyErrors = {
  NotFoundError: '目标平台不支持测试 API KEY，你可以跳过测试直接使用',
  AuthenticationError: 'API KEY 验证失败，请确认是否输入正确',
  UnknownError: '未知错误',
} as const

interface CheckAPIKeySuccess {
  kind: 'success'
}

interface CheckAPIKeyFail {
  kind: 'fail'
  type: keyof typeof checkAPIKeyErrors
  message?: string
}

type CheckAPIKeyResult = CheckAPIKeySuccess | CheckAPIKeyFail

export class AIChatService {
  private logger: ReturnType<typeof createLogger> = createLogger('AI对话')
  private openai: OpenAI
  private constructor(
    private apiKey: string,
    private baseURL: string,
    private provider: ProviderType,
  ) {
    this.openai = new OpenAI({ apiKey, baseURL })
  }

  public static createService(apiKey: string, provider: ProviderType, customBaseURL?: string) {
    let baseURL: string
    if (provider === 'custom') {
      if (!customBaseURL) {
        throw new Error('使用自定义 provider 请提供 baseURL')
      }
      baseURL = customBaseURL
    } else {
      baseURL = providerService.providers[provider].baseURL
    }

    return new AIChatService(apiKey, baseURL, provider)
  }

  /**
   * 火山方舟（volcengine）的「低延迟(Fast)推理」：请求体里必须显式带上
   * service_tier=fast 才会走低延迟通道，否则一律按「在线推理(常规)」处理，
   * 输出速度（TPOT）会明显更慢。
   *
   * 前置条件：方舟控制台 → 开通管理 → 给对应模型打开「低延迟」开关
   * （自定义推理接入点在开通后默认开启）。
   * 触发限流或 QoS 保护时，方舟会自动降级回常规推理，不会报错，只是变慢。
   *
   * 但若该模型**根本没开通**低延迟，方舟不会自动降级，而是直接返回
   * 400「Your account xxx has not activated the fast mode for model xxx」，
   * 导致整次对话失败。因此这里配合 createCompletion 做「去掉 service_tier 重试」的兜底。
   *
   * 只对 volcengine 生效，其它提供商不带这个字段，避免不认识的参数导致报错。
   */
  private applyVolcengineFastTier(params: object, model: string): void {
    if (this.provider !== 'volcengine') {
      return
    }
    // 已知该模型没开通 Fast，就别再带了，免得每次请求都白失败一次
    if (AIChatService.fastTierUnavailableModels.has(this.fastTierKey(model))) {
      return
    }
    // 注意：openai SDK 里 service_tier 是字面量联合类型，不含方舟私有的 'fast'，故此处断言
    ;(params as { service_tier?: string }).service_tier = 'fast'
  }

  /**
   * 进程内记忆「未开通 Fast 推理」的模型，避免每次请求都多打一次失败请求。
   * 注意：ipc 层每次请求都会 createService 新建实例，所以这里必须是静态成员，
   * 否则记忆会随实例一起丢掉，变成每条回复都先失败一次再重试。
   */
  private static fastTierUnavailableModels = new Set<string>()

  private fastTierKey(model: string) {
    return `${this.provider}::${model}`
  }

  /** 判断是否为「该模型未开通低延迟(Fast)推理」的报错 */
  private isFastTierNotActivated(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    if (/not activated the fast mode/i.test(message)) {
      return true
    }
    return (
      /service_tier/i.test(message) &&
      /(invalid|unsupported|not supported|not activated|no permission)/i.test(message)
    )
  }

  /**
   * 统一发请求，并针对「Fast 推理未开通」做一次自动降级重试：
   * 先按配置带 service_tier=fast；若账号没给该模型开通低延迟（方舟直接 400），
   * 则去掉该字段重试一次，保证对话不因加速开关而整体失败。
   */
  private async createCompletion<T>(
    model: string,
    createParams: (useFastTier: boolean) => Promise<T>,
  ): Promise<T> {
    const useFastTier =
      this.provider === 'volcengine' &&
      !AIChatService.fastTierUnavailableModels.has(this.fastTierKey(model))
    try {
      return await createParams(useFastTier)
    } catch (error) {
      if (!useFastTier || !this.isFastTierNotActivated(error)) {
        throw error
      }
      AIChatService.fastTierUnavailableModels.add(this.fastTierKey(model))
      this.logger.warn(
        `模型「${model}」未开通火山方舟「低延迟(Fast)推理」，已自动降级为常规推理（想要更快可在方舟控制台为该模型开通低延迟）。`,
      )
      return createParams(false)
    }
  }

  public async *chatStream(messages: ChatMessage[], model: string) {
    try {
      this.logger.debug('流式 chatStream 请求', { model })
      const stream = await this.createCompletion(model, async useFastTier => {
        const params: ChatCompletionCreateParamsStreaming = {
          model,
          messages,
          stream: true,
        }
        this.applyVolcengineFastTier(params, model)
        if (!useFastTier) {
          delete (params as { service_tier?: string }).service_tier
        }
        return this.openai.chat.completions.create(params)
      })

      let contentLength = 0
      let reasoningLength = 0

      for await (const chunk of stream) {
        const delta = chunk.choices[0].delta
        const { content, reasoning_content: reasoning } = delta as typeof delta & {
          reasoning_content?: string
        }

        contentLength += content?.length ?? 0
        reasoningLength += reasoning?.length ?? 0

        if (content || reasoning) {
          yield { content, reasoning }
        }
      }

      this.logger.debug('chatStream 响应完成', {
        contentLength,
        reasoningLength,
      })
    } catch (error) {
      this.logger.error('AI 不想回答：chatStream 错误', error)
      throw error
    }
  }

  public async chat(messages: ChatMessage[], model: string) {
    try {
      this.logger.debug('非流式 chat 请求', { model })

      const response = await this.createCompletion(model, async useFastTier => {
        const params: ChatCompletionCreateParamsNonStreaming = {
          model,
          messages,
          stream: false,
        }
        this.applyVolcengineFastTier(params, model)
        if (!useFastTier) {
          delete (params as { service_tier?: string }).service_tier
        }
        return this.openai.chat.completions.create(params)
      })

      const output = response.choices[0].message.content ?? ''

      this.logger.debug('chat 响应完成', { outputLength: output.length })

      return output
    } catch (error) {
      this.logger.error('AI 不想回答：chat 错误', error)
      throw error
    }
  }

  public async checkAPIKey() {
    let result: CheckAPIKeyResult
    if (this.provider === 'openrouter') {
      result = await this.checkOpenRouterAPIKey()
    } else {
      result = await this.checkDefaultAPIKey()
    }

    if (result.kind === 'fail') {
      switch (result.type) {
        case 'NotFoundError':
          this.logger.error(checkAPIKeyErrors.NotFoundError)
          throw new Error(checkAPIKeyErrors.NotFoundError)
        case 'AuthenticationError':
          this.logger.error(checkAPIKeyErrors.AuthenticationError)
          throw new Error(checkAPIKeyErrors.AuthenticationError)
        default: {
          const errorMessage = `${checkAPIKeyErrors.UnknownError}: ${result.message}`
          this.logger.error(errorMessage)
          throw new Error(errorMessage)
        }
      }
    }

    this.logger.success('API Key 通过测试！你的 API Key 大概率是有效的')
  }

  private async checkDefaultAPIKey(): Promise<CheckAPIKeyResult> {
    try {
      await this.openai.models.list()
      return {
        kind: 'success',
      }
    } catch (error) {
      if (error instanceof NotFoundError) {
        return {
          kind: 'fail',
          type: 'NotFoundError',
        }
      }
      if (error instanceof AuthenticationError) {
        return {
          kind: 'fail',
          type: 'AuthenticationError',
        }
      }
      return {
        kind: 'fail',
        type: 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async checkOpenRouterAPIKey(): Promise<CheckAPIKeyResult> {
    const url = `${providerService.providers.openrouter.baseURL}/credits`
    const options = {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.apiKey}` },
    }
    const resp = await fetch(url, options)
    const data = await resp.json()
    switch (resp.status) {
      case 200:
        return {
          kind: 'success',
        }
      case 401: {
        return {
          kind: 'fail',
          type: 'AuthenticationError',
        }
      }
      default: {
        return {
          kind: 'fail',
          type: 'UnknownError',
          message: `${data?.error?.message}, CODE: ${data?.error?.code}`,
        }
      }
    }
  }
}
