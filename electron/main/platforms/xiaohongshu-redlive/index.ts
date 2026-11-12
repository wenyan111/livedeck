import { XiaohongshuPlatform } from '../xiaohongshu'
import { REGEXPS, URLS } from './constant'

/**
 * RedLive —— 小红书直播管理平台（redlive.xiaohongshu.com）。
 *
 * 与千帆共用同一套 DOM 实现，只覆盖 URL / 登录判定 / 平台名。
 * 若以后发现某个选择器不一样，在这里单独覆盖对应方法即可，不影响千帆。
 */
export class RedlivePlatform extends XiaohongshuPlatform {
  protected readonly urls = URLS
  protected readonly loginRegex = REGEXPS.LOGIN_PAGE
  protected readonly platformLabel = '小红书RedLive'
}
