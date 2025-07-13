import { Command, Flags } from '@oclif/core'
import assert from 'assert'
import { spawnSync } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'

import { DEVICE_CONFIG_FLAGS, DeviceBuildId, getDeviceBuildId, loadDeviceConfigs } from '../config/device'
import { ADEVTOOL_DIR, COLLECTED_SYSTEM_STATE_DIR, OS_CHECKOUT_DIR } from '../config/paths'
import { collectSystemState, serializeSystemState } from '../config/system-state'
import { forEachDevice } from '../frontend/devices'
import { DeviceImages, prepareFactoryImages } from '../frontend/source'
import { loadBuildIndex } from '../images/build-index'
import { spawnAsync } from '../util/process'
import { generatePrep } from './generate-prep'

export default class CollectState extends Command {
  static description = 'collect built system state for use with other commands'

  static flags = {
    help: Flags.help({ char: 'h' }),
    outRoot: Flags.string({ char: 'r', description: 'path to AOSP build output directory (out/)', default: 'out' }),
    parallel: Flags.boolean({
      char: 'p',
      description: 'generate devices in parallel (causes buggy progress spinners)',
      default: false,
    }),
    outPath: Flags.string({
      char: 'o',
      description: `output path for system state JSON file(s). If it's a directory, $device.json will be used for file names`,
      required: true,
      default: COLLECTED_SYSTEM_STATE_DIR,
    }),
    rebuild: Flags.boolean({
      description: 'generate prep vendor module (same as generate-prep) and make an OS build before collecting state',
      default: false,
    }),
    disallowOutReuse: Flags.boolean({
      description: 'if --rebuild is specified, remove out/ dir before making a state collection OS build',
    }),
    ...DEVICE_CONFIG_FLAGS,
  }

  async run() {
    let {
      flags: { devices, outRoot, parallel, outPath, rebuild, disallowOutReuse },
    } = await this.parse(CollectState)

    let configs = await loadDeviceConfigs(devices)

    let deviceImagesMap: Map<DeviceBuildId, DeviceImages>
    if (rebuild) {
      deviceImagesMap = await prepareFactoryImages(await loadBuildIndex(), configs)
    }

    let isDir = (await fs.stat(outPath)).isDirectory()
    await forEachDevice(
      configs,
      parallel,
      async config => {
        if (rebuild) {
          let deviceImages = deviceImagesMap.get(getDeviceBuildId(config))
          assert(deviceImages !== undefined)
          await generatePrep(config, deviceImages.unpackedFactoryImageDir, config.device.build_id)
          if (disallowOutReuse) {
            await spawnAsync('rm', ['-rf', path.join(OS_CHECKOUT_DIR, 'out')])
          }
          let label = 'state collection build took'
          console.time(label)
          let res = spawnSync(path.join(ADEVTOOL_DIR, 'scripts/make-state-collection-build.sh'), [config.device.name], {
            stdio: 'inherit',
          })
          console.timeEnd(label)
          assert(res.status === 0, `make-prep-build.sh failed, exit code ${res.status}`)
        }

        let state = await collectSystemState(config.device.name, outRoot)

        // Write
        let devicePath = isDir ? `${outPath}/${config.device.name}.json` : outPath
        await fs.writeFile(devicePath, serializeSystemState(state))
      },
      c => c.device.name,
    )
  }
}
