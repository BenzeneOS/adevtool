import assert from 'assert'
import { promises as fs } from 'fs'
import { readFile } from 'node:fs/promises'
import path from 'path'
import { DeviceConfig } from '../config/device'
import { Filters } from '../config/filters'
import { getHostBinPath } from '../config/paths'
import { spawnAsyncStdin } from '../util/process'
import { VendorDirectories } from './build'
import { log } from '../util/log'

export async function processOverlays(config: DeviceConfig, dirs: VendorDirectories, stockSrc: string) {
  let arsclibPath = await getHostBinPath('arsclib')
  let overlaysDir = path.join(dirs.out, 'overlays')
  await fs.mkdir(overlaysDir)

  let moduleListPath = path.join(overlaysDir, 'overlay-modules.txt')

  let cmd = {
    aapt2Path: await getHostBinPath('aapt2'),
    unpackedOsImageDir: stockSrc,
    syntheticOverlays: config.synthetic_overlays,
    pkgExclusionFilters: filtersToJson(config.filters.overlay_files),
    exclusionFilters: filtersToJson(config.filters.overlay_keys),
    inclusionFilters: filtersToJson(config.filters.overlay_inclusions),
    outDir: overlaysDir,
    outModuleListPath: moduleListPath,
  }

  let stdin = Buffer.from(JSON.stringify(cmd), 'utf-8')
  let out = await spawnAsyncStdin(arsclibPath, ['--json-stdin'], stdin)
  if (out.length > 0) {
    log(out)
  }
  return (await readFile(moduleListPath)).toString('utf-8').split('\n')
}

function filtersToJson(filters: Filters) {
  // regex filters are not supported by arsclib
  assert(filters.regex.length === 0)
  return {
    include: filters.include,
    match: Array.from(filters.match),
    prefixes: filters.prefix,
    suffixes: filters.suffix,
    substrings: filters.substring,
  }
}
