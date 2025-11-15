import { promises as fs } from 'fs'
import path from 'path'

import assert from 'assert'
import { DeviceConfig } from '../config/device'
import { ADEVTOOL_DIR, RELATIVE_ADEVTOOL_PATH } from '../config/paths'
import { spawnAsync } from '../util/process'

export interface VendorDirectories {
  out: string
  proprietary: string // local namespace
  firmware: string
}

export const PROPRIETARY_DIR_IN_ROOT_SOONG_NAMESPACE = 'proprietary-root-soong-ns'

export async function createVendorDirs(vendor: string, device: string) {
  let root = process.env['ADEVTOOL_VENDOR_DIR_ROOT'] ?? 'vendor'
  let out = path.join(root, vendor, device)
  await fs.rm(out, { force: true, recursive: true })
  await fs.mkdir(out, { recursive: true })

  let arr = ['proprietary', 'firmware']
  await Promise.all(arr.map(dir => fs.mkdir(path.join(out, dir))))

  let res: Record<string, string> = { out }
  for (let dir of arr) {
    res[dir] = path.join(out, dir)
  }

  return res as object as VendorDirectories
}

export function getVersionCheckFilePath(dirs: VendorDirectories) {
  return path.join(dirs.out, 'adevtool-version-check.mk')
}

export async function writeVersionCheckFile(config: DeviceConfig, dirs: VendorDirectories, warnOnly: boolean = false) {
  let adevtoolRevision = await spawnAsync('git', ['-C', ADEVTOOL_DIR, 'rev-parse', 'HEAD'])
  assert(adevtoolRevision.endsWith('\n'))
  adevtoolRevision = adevtoolRevision.slice(0, -1)
  let deviceName = config.device.name
  let contents =
    `ifneq ($(shell git -C ${RELATIVE_ADEVTOOL_PATH} rev-parse HEAD),${adevtoolRevision})\n` +
    `  $(${warnOnly ? 'warning' : 'error'} ${deviceName} vendor module is outdated. Run \`adevtool generate-all -d ${deviceName}\` to update it)\n` +
    `endif`
  await fs.writeFile(getVersionCheckFilePath(dirs), contents)
}
