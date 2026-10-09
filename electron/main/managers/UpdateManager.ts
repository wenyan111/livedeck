import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, unlinkSync } from 'node:fs'
import { arch, platform } from 'node:os'
import path from 'node:path'
import { app, net, shell } from 'electron'
import { marked } from 'marked'
import semver from 'semver'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import * as yaml from 'yaml'
import windowManager from '#/windowManager'
import packageJson from '../../../package.json'
import { createLogger } from '../logger'
import { errorMessage, sleep } from '../utils'
import { UPDATE_SOURCE } from 'shared/updateSource'

type LatestYml = {
  version: string
  files: Array<{
    url: string
    sha512: string
    size: number
  }>
  path: string
  sha512: string
  releaseDate: string
}

// 更新源（GitHub owner/repo/branch）统一由 shared/updateSource.ts 的 UPDATE_SOURCE 配置
const CDN_URL = 'https://fastly.jsdelivr.net/gh/'
const PRODUCT_NAME = packageJson.name

const logger = createLogger('update')

// marked 生成的 html 要在新页面打开链接
marked.use({
  renderer: {
    link: ({ href, title, text }) => {
      return `<a href="${href}" target="_blank" rel="noopener noreferrer"${title ? ` title="${title}"` : ''}>${text}</a>`
    },
  },
})

function extractChanges(changelogContent: string, userVersion: string): string {
  const lines = changelogContent.split('\n')
  const result = []

  for (const line of lines) {
    const versionMatch = line.match(/^##\s+v?([0-9]+\.[0-9]+\.[0-9]+)/) // 匹配版本 "## vX.Y.Z" 或 "## X.Y.Z"

    if (versionMatch) {
      const versionInLog = versionMatch[1] // X.Y.Z
      // 遇到小于等于当前版本的就停止
      if (semver.lte(versionInLog, userVersion)) {
        break
      }
    }

    result.push(line)
  }

  // slice(1) 负责过滤开头的 # Changelog
  return result.slice(1).join('\n')
}

async function fetchWithRetry(url: string | URL, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = (await timeoutFetch(url)) as Response
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res
    } catch (e) {
      if (i === retries - 1) throw e
      await sleep(delay)
    }
  }
}

async function timeoutFetch(url: string | URL, timeout = 5000) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await net.fetch(url.toString(), {
      signal: controller.signal,
      // 不加上 User-Agent 会访问超时
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    })
    clearTimeout(timeoutId)
    return response
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error('Fetch timeout')
    }
    throw err
  }
}

const releaseNotes: Record<string, string> = {}
let latestVersion: string | null = null

async function getLatestVersion() {
  try {
    // 从 package.json 获取最新版本号
    const resp = await fetch(
      new URL(`${UPDATE_SOURCE.owner}/${UPDATE_SOURCE.repo}@${UPDATE_SOURCE.branch}/package.json`, CDN_URL),
    )
    // 更新源仓库尚未创建/发布时，CDN 会返回 404 + 一段 "Couldn't find ..." 文本；
    // 必须先判 ok，否则 resp.json() 会因非 JSON 抛出 "Unexpected token" 的误导性错误
    if (!resp.ok) {
      logger.debug(
        `更新源仓库暂不可用（HTTP ${resp.status}）：${UPDATE_SOURCE.owner}/${UPDATE_SOURCE.repo}@${UPDATE_SOURCE.branch}，跳过本次更新检查`,
      )
      return null
    }
    const version = (await resp.json()).version
    logger.debug(`从 package.json 获取到的版本为 ${version}`)
    latestVersion = version
    return version
  } catch (error) {
    logger.debug(`获取最新版本失败：${errorMessage(error)}`)
    return null
  }
}

async function fetchChangelog() {
  if (latestVersion && releaseNotes[latestVersion]) {
    return releaseNotes[latestVersion]
  }
  try {
    // 去 CDN 找
    const changelogURL = new URL(`${UPDATE_SOURCE.owner}/${UPDATE_SOURCE.repo}@${UPDATE_SOURCE.branch}/CHANGELOG.md`, CDN_URL)
    const changelogContent = await fetchWithRetry(changelogURL).then(res => res?.text())
    if (changelogContent) {
      // 找到新版本到当前版本的所有更新日志
      const updateLog = extractChanges(changelogContent, app.getVersion())
      // markdown 转成 html
      const releaseNote = await marked.parse(updateLog)
      if (latestVersion) {
        releaseNotes[latestVersion] = releaseNote
      }
      return releaseNote
    }
  } catch {
    return undefined
  }
}

function getAssetsURL() {
  const assetsURL = `https://github.com/${UPDATE_SOURCE.owner}/${UPDATE_SOURCE.repo}/releases/download/v${latestVersion}/`
  return assetsURL
}

interface Updater {
  checkForUpdates(source: string): Promise<void>
  downloadUpdate(): void
  quitAndInstall(): void
}

class UpdateManager {
  constructor(private updater: Updater) {}

  public async checkForUpdates(source = 'github') {
    await this.updater.checkForUpdates(source)
  }

  public async checkUpdateVersion() {
    const latestVersion = await getLatestVersion()
    if (!latestVersion) {
      return
    }
    const currentVersion = app.getVersion()
    if (semver.lt(currentVersion, latestVersion)) {
      // 先用 log 提示更新
      logger.info(
        `检查到可用更新：${currentVersion} -> ${latestVersion}，可前往应用设置-软件更新处手动更新`,
      )
      const releaseNote = await fetchChangelog()

      return {
        currentVersion,
        latestVersion,
        releaseNote,
      }
    }
  }

  public async silentCheckForUpdate() {
    try {
      const result = await this.checkUpdateVersion()
      if (result) {
        windowManager.send(IPC_CHANNELS.app.notifyUpdate, { ...result })
      }
    } catch (err) {
      logger.debug(`静默检查更新失败：${err}`)
    }
  }

  public startDownload() {
    logger.info('开始下载更新……')
    this.updater.downloadUpdate()
  }

  public async quitAndInstall() {
    logger.info('准备退出并安装更新')
    this.updater.quitAndInstall()
  }
}

class WindowsUpdater implements Updater {
  private versionInfo: LatestYml | null = null
  private assetsURL: string | null = null
  private savePath: string | null = null
  private safeSource = ''

  public async checkForUpdates(source: string) {
    try {
      // 先确定最新版本号（读 CDN 上的 package.json），用于拼接 release 下载基址
      await getLatestVersion()
      const assetsURL = getAssetsURL()
      this.safeSource = source === 'github' ? '' : new URL(source).href
      this.assetsURL = assetsURL
      const latestYmlURL = `${this.safeSource}${new URL('latest.yml', this.assetsURL)}`
      const ymlResp = await net.fetch(latestYmlURL)
      if (!ymlResp.ok) {
        logger.debug(`获取更新信息失败（HTTP ${ymlResp.status}）：${latestYmlURL}，更新源可能尚未发布`)
        return
      }
      const ymlContent = (await ymlResp.text()) as string
      const latestYml = yaml.parse(ymlContent) as LatestYml | null
      if (!latestYml || typeof latestYml.version !== 'string') {
        logger.debug('未获取到有效的更新信息（更新源可能尚未发布），跳过本次更新')
        return
      }
      this.versionInfo = latestYml
      if (!semver.gt(latestYml.version, app.getVersion())) {
        logger.info(`${app.getVersion()} 已经是最新版本，无需更新`)
        windowManager.send(IPC_CHANNELS.updater.updateAvailable, {
          update: false,
          version: app.getVersion(),
          newVersion: latestYml.version,
        })
        return
      }
      const releaseNote = await fetchChangelog()
      windowManager.send(IPC_CHANNELS.updater.updateAvailable, {
        update: true,
        version: app.getVersion(),
        newVersion: latestYml.version,
        releaseNote,
      })
      this.downloadUpdate()
    } catch (err) {
      const message = errorMessage(err)
      logger.error(message)
      windowManager.send(IPC_CHANNELS.updater.updateError, { message })
    }
  }

  public async downloadUpdate() {
    let fileUrl: string | undefined
    try {
      const setupFile = this.versionInfo?.files.find(file => file.url.toLowerCase().endsWith('.exe'))
      if (!setupFile) {
        throw new Error('找不到 exe 安装包')
      }
      this.savePath = path.join(app.getPath('downloads'), 'livedeck-update-setup.exe')
      if (existsSync(this.savePath)) {
        const localFileSha512 = await this.calculateFileHash(this.savePath)
        if (localFileSha512 === setupFile.sha512) {
          logger.debug('本地已存在安装包，无需重复下载')
          windowManager.send(IPC_CHANNELS.updater.updateDownloaded)
          return
        }
      }
      fileUrl = `${this.safeSource}${new URL(setupFile.url, this.assetsURL!)}`
      const resp = await net.fetch(fileUrl)
      if (!resp.ok) {
        throw new Error(`网络错误: ${resp.statusText}`)
      }
      const totalBytes = Number.parseInt(resp.headers.get('Content-Length') ?? '0', 10)
      logger.debug(`开始下载文件 ${fileUrl}，大小 ${totalBytes / 1024 / 1024} MB`)
      let downloadBytes = 0
      const reader = resp.body?.getReader()
      if (!reader) throw new Error('获取文件流失败')
      if (existsSync(this.savePath)) unlinkSync(this.savePath)
      const fileWriter = createWriteStream(this.savePath)
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        downloadBytes += value.length
        fileWriter.write(value)
        if (totalBytes > 0) {
          const progress = (downloadBytes / totalBytes) * 100
          windowManager.send(IPC_CHANNELS.updater.downloadProgress, {
            delta: totalBytes - downloadBytes,
            percent: progress,
            bytesPerSecond: 0,
            transferred: downloadBytes,
            total: totalBytes,
          })
        }
      }
      fileWriter.end()
      logger.debug(`文件下载完成，保存到 ${this.savePath}`)
      windowManager.send(IPC_CHANNELS.updater.updateDownloaded)
    } catch (err) {
      const message = `下载文件失败: ${errorMessage(err)}`
      logger.error(message)
      windowManager.send(IPC_CHANNELS.updater.updateError, { message, downloadURL: fileUrl })
    }
  }

  public async quitAndInstall() {
    if (!this.savePath) throw new Error('未指定下载文件路径')
    if (existsSync(this.savePath)) {
      await shell.openPath(this.savePath)
      await sleep(3000)
      app.quit()
    } else {
      logger.error(`下载文件 ${this.savePath} 不存在`)
    }
  }

  private calculateFileHash(filePath: string) {
    return new Promise<string>((resolve, reject) => {
      const hash = createHash('sha512')
      const stream = createReadStream(filePath)
      stream.on('data', chunk => hash.update(chunk))
      stream.on('end', () => resolve(hash.digest('base64')))
      stream.on('error', reject)
    })
  }
}

class MacOSUpdater implements Updater {
  private versionInfo: LatestYml | null = null
  private assetsURL: string | null = null
  private savePath: string | null = null
  private safeSource = ''
  /**
   * MacOS 如果使用 autoUpdater 需要提供 zip 文件，但是下载了 zip 之后又不能安装，因为没有签名
   * 所以干脆就手动下载 dmg 文件，下载完毕后退出应用，手动安装
   */
  public async checkForUpdates(source: string) {
    // 先从 latest-mac.yml 中获取目标文件
    try {
      const assetsURL = getAssetsURL()
      this.safeSource = source === 'github' ? '' : new URL(source).href
      this.assetsURL = assetsURL
      const latestYmlURL = `${this.safeSource}${new URL('latest-mac.yml', this.assetsURL)}`
      const ymlResp = await net.fetch(latestYmlURL)
      // 更新源仓库尚未发布时这里会拿到 404 的说明文本，直接 parse 会产出无 version 的字符串再触发 semver 报错
      if (!ymlResp.ok) {
        logger.debug(`获取更新信息失败（HTTP ${ymlResp.status}）：${latestYmlURL}，更新源仓库可能尚未发布`)
        return
      }
      const ymlContent = (await ymlResp.text()) as string
      const latestYml = yaml.parse(ymlContent) as LatestYml | null

      if (!latestYml || typeof latestYml.version !== 'string') {
        logger.debug('未获取到有效的更新信息（更新源仓库可能尚未发布），跳过本次更新')
        return
      }
      this.versionInfo = latestYml
      if (!semver.gt(latestYml.version, app.getVersion())) {
        logger.info(`${app.getVersion()} 已经是最新版本，无需更新`)
        return
      }
    } catch (err) {
      const message = errorMessage(err)
      logger.error(message)
      windowManager.send(IPC_CHANNELS.updater.updateError, { message: message })
      return
    }
    this.downloadUpdate()
  }

  public async downloadUpdate() {
    let fileUrl: string | undefined
    try {
      const files = this.versionInfo?.files ?? []
      const setupFile =
        files.find(file => file.url.endsWith(`${arch()}.dmg`)) ??
        files.find(file => file.url.toLowerCase().endsWith('.dmg'))
      if (!setupFile) {
        const message = '找不到 dmg 文件'
        throw new Error(message)
      }
      // 先检查本地是否已经有了这个文件（计算 Sha512）
      this.savePath = path.join(app.getPath('downloads'), 'livedeck-update-setup.dmg')
      if (existsSync(this.savePath)) {
        const localFileSha512 = await this.calculateFileHash(this.savePath)
        logger.debug(`检测到本地文件，计算 Sha512 哈希值为 ${localFileSha512}`)
        if (localFileSha512 === setupFile.sha512) {
          logger.debug('本地已存在安装包，无需重复下载')
          windowManager.send(IPC_CHANNELS.updater.updateDownloaded)
          return
        }
      }
      // biome-ignore lint/style/noNonNullAssertion: 确保 assetsURL 不为 null
      fileUrl = `${this.safeSource}${new URL(setupFile.url, this.assetsURL!)}`
      const resp = await net.fetch(fileUrl)
      if (!resp.ok) {
        const message = `网络错误: ${resp.statusText}`
        throw new Error(message)
      }

      const totalBytes = Number.parseInt(resp.headers.get('Content-Length') ?? '0', 10)
      logger.debug(`开始下载文件 ${fileUrl}，文件大小 ${totalBytes / 1024 / 1024} MB`)
      let downloadBytes = 0

      const reader = resp.body?.getReader()
      if (!reader) {
        const message = '获取文件流失败'
        throw new Error(message)
      }
      // 删除已存在的文件
      if (existsSync(this.savePath)) {
        unlinkSync(this.savePath)
      }
      const fileWriter = createWriteStream(this.savePath)

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        downloadBytes += value.length
        fileWriter.write(value)

        if (totalBytes > 0) {
          const progress = (downloadBytes / totalBytes) * 100
          windowManager.send(IPC_CHANNELS.updater.downloadProgress, {
            delta: totalBytes - downloadBytes,
            percent: progress,
            bytesPerSecond: 0,
            transferred: downloadBytes,
            total: totalBytes,
          })
        }
      }
      fileWriter.end()
      logger.debug(`文件 ${fileUrl} 下载完成，保存到 ${this.savePath}`)
      windowManager.send(IPC_CHANNELS.updater.updateDownloaded)
    } catch (err) {
      const message = `下载文件失败: ${errorMessage(err)}`
      logger.error(message)
      windowManager.send(IPC_CHANNELS.updater.updateError, { message, downloadURL: fileUrl })
    }
  }

  public async quitAndInstall() {
    // 找到下载文件的路径
    if (!this.savePath) {
      const message = '未指定下载文件路径'
      throw new Error(message)
    }
    if (existsSync(this.savePath)) {
      // 打开文件
      await shell.openPath(this.savePath)
      // 等待一会后退出应用
      await sleep(3000)
      app.quit()
    } else {
      logger.error(`下载文件 ${this.savePath} 不存在`)
    }
    return
  }

  private calculateFileHash(filePath: string) {
    return new Promise<string>((resolve, reject) => {
      const hash = createHash('sha512')
      const stream = createReadStream(filePath)

      stream.on('data', chunk => hash.update(chunk))
      stream.on('end', () => resolve(hash.digest('base64')))
      stream.on('error', reject)
    })
  }
}

export const updateManager = new UpdateManager(
  platform() === 'darwin' ? new MacOSUpdater() : new WindowsUpdater(),
)
