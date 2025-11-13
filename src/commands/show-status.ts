import { Command } from '@oclif/core'
import chalk from 'chalk'

import { DEVICE_CONFIGS_FLAG, DeviceConfig, getDeviceNames, loadDeviceConfigs } from '../config/device'
import { BuildIndex, ImageType, loadBuildIndex } from '../images/build-index'
import { DeviceImage } from '../images/device-image'
import { updateMultiMap } from '../util/data'
import { log } from '../util/log'
import { loadBuildIdToTagMap } from './update-aosp-tag-index'

export default class ShowStatus extends Command {
  static flags = {
    ...DEVICE_CONFIGS_FLAG,
  }

  async run() {
    let { flags } = await this.parse(ShowStatus)
    let configs = await loadDeviceConfigs(flags.devices)

    let buildIdMap = new Map<string, DeviceConfig[]>()
    let backportBuildIdMap = new Map<string, DeviceConfig[]>()
    // platform security patch levels
    let psplMap = new Map<string, DeviceConfig[]>()
    let buildIndex = await loadBuildIndex()
    let mainImageStatus = new ImageStatus(buildIndex)
    let backportImageStatus = new ImageStatus(buildIndex)

    for (let config of configs) {
      updateMultiMap(buildIdMap, config.device.build_id, config)
      await mainImageStatus.update(config, config.device.build_id)
      let backportBuildId = config.device.backport_build_id
      if (backportBuildId !== undefined) {
        updateMultiMap(backportBuildIdMap, backportBuildId, config)
        await backportImageStatus.update(config, backportBuildId)
      }
      updateMultiMap(psplMap, config.device.platform_security_patch_level_override, config)
    }

    let buildIdToTag = await loadBuildIdToTagMap()

    this.log(chalk.bold('Tag | Build ID:'))
    for (let [buildId, configs] of buildIdMap.entries()) {
      this.log(`${buildIdToTag?.get(buildId) ?? '[no tag]'} | ${buildId}: ` + getDeviceNames(configs))
    }

    if (backportBuildIdMap.size > 0) {
      this.log(chalk.bold('\nBackports:'))
      for (let [buildId, configs] of backportBuildIdMap.entries()) {
        this.log(`${buildIdToTag?.get(buildId) ?? '[no tag]'} | ${buildId}: ` + getDeviceNames(configs))
      }
    }

    if (psplMap.size > 0) {
      this.log(chalk.bold('\nPlatform security patch level:'))
      for (let [spl, configs] of psplMap.entries()) {
        this.log((spl === undefined ? 'default' : spl) + ': ' + getDeviceNames(configs))
      }
    }

    this.log(chalk.bold('\nStock image:'))
    mainImageStatus.log()

    if (backportBuildIdMap.size > 0) {
      this.log(chalk.bold('\nBackport stock image:'))
      backportImageStatus.log()
    }

    if (mainImageStatus.unknownImages.size + backportImageStatus.unknownImages.size !== 0) {
      process.exit(1)
    }
  }
}

class ImageStatus {
  static imageTypes = [ImageType.Factory, ImageType.Ota]

  readonly presentImages = new Map<string, DeviceConfig[]>()
  readonly missingImages = new Map<string, DeviceConfig[]>()
  readonly unknownImages = new Map<string, DeviceConfig[]>()

  constructor(readonly buildIndex: BuildIndex) {}

  async update(config: DeviceConfig, buildId: string) {
    for (let type of ImageStatus.imageTypes) {
      let image: DeviceImage
      try {
        image = DeviceImage.get(this.buildIndex, config, buildId, type)
      } catch {
        updateMultiMap(this.unknownImages, type, config)
        continue
      }

      if (await image.isPresent()) {
        updateMultiMap(this.presentImages, type, config)
      } else {
        updateMultiMap(this.missingImages, type, config)
      }
    }
  }

  log() {
    for (let type of ImageStatus.imageTypes) {
      log(`  ${type}:`)
      this.maybeLogImageStatus(type, this.presentImages, 'present')
      this.maybeLogImageStatus(type, this.missingImages, 'known')
      this.maybeLogImageStatus(type, this.unknownImages, chalk.bold(chalk.red('unknown')))
    }
  }

  private maybeLogImageStatus(type: ImageType, map: Map<string, DeviceConfig[]>, mapName: string) {
    let devices = map.get(type)
    if (devices !== undefined && devices.length > 0) {
      log(`    ${mapName}: ${getDeviceNames(devices)}`)
    }
  }
}
