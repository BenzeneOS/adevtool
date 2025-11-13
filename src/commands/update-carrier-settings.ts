import { Command, Flags } from '@oclif/core'

import { downloadAllConfigs, fetchUpdateConfig, getCarrierSettingsUpdatesDir } from '../blobs/carrier'
import { DEVICE_CONFIGS_FLAG_WITH_BUILD_ID, loadDeviceConfigs2, makeDeviceBuildId } from '../config/device'
import { forEachDevice } from '../frontend/devices'
import { getSdkVersion, processProps } from '../frontend/generate'
import { prepareFactoryImages } from '../frontend/source'
import { loadBuildIndex } from '../images/build-index'
import { mapGet } from '../util/data'
import { log } from '../util/log'
import { PathResolver, PathResolverContext } from '../util/partitions'

export default class UpdateCarrierSettings extends Command {
  static description = 'download updated carrier protobuf configs.'

  static flags = {
    out: Flags.string({
      char: 'o',
      description: 'override output directory',
    }),
    debug: Flags.boolean({
      description: 'enable debug output',
      default: false,
    }),
    ...DEVICE_CONFIGS_FLAG_WITH_BUILD_ID,
  }

  async run() {
    let { flags } = await this.parse(UpdateCarrierSettings)
    let devices = await loadDeviceConfigs2(flags)
    let factoryImages = await prepareFactoryImages(await loadBuildIndex(), devices)
    await forEachDevice(
      devices,
      false,
      async config => {
        if (config.device.has_cellular) {
          const buildId = config.device.build_id
          const outDir = flags.out ?? getCarrierSettingsUpdatesDir(config)
          let factoryImageDir = mapGet(
            factoryImages,
            makeDeviceBuildId(config.device.name, buildId),
          ).unpackedFactoryImageDir
          let sdkVersion = getSdkVersion(
            await processProps(config, null, new PathResolver(factoryImageDir, PathResolverContext.UNPACKED_IMAGE)),
          )
          const updateConfig = await fetchUpdateConfig(config.device.name, buildId, sdkVersion, flags.debug)
          if (flags.debug) log(updateConfig)
          await downloadAllConfigs(updateConfig, outDir, flags.debug)
        } else {
          this.log(`${config.device.name} is not supported due to lack of cellular connectivity`)
        }
      },
      config => `${config.device.name} ${config.device.build_id}`,
    )
  }
}
