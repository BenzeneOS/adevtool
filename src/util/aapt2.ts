import { BriefPackageInfo } from '../proto-ts/frameworks/base/tools/aapt2/BriefPackageInfo'
import { spawnAsync2 } from './process'

let briefPackageInfoCache = new Map<string, BriefPackageInfo>()

export async function getBriefPackageInfo(aapt2: string, sdkVersion: string, apkPath: string) {
  let cache = briefPackageInfoCache.get(apkPath)
  if (cache !== undefined) {
    return cache
  }

  let out = await spawnAsync2({
    command: aapt2,
    args: ['dump', 'brief-package-info', '--sdk-version', sdkVersion, apkPath],
  })
  let bpi = BriefPackageInfo.decode(out)
  briefPackageInfoCache.set(apkPath, bpi)
  return bpi
}
