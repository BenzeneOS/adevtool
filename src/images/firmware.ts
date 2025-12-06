import assert from 'assert'
import { promises as fs } from 'fs'

import path from 'path'
import { BASEBAND_VERSION_PROP, BOOTLOADER_VERSION_PROP, PartitionProps } from '../blobs/props'
import { DeviceConfig } from '../config/device'
import { getAbOtaPartitions } from '../frontend/generate'
import { BASE_FIRMWARE_DIR } from '../frontend/source'
import { assertDefined, mapGet } from '../util/data'
import { Partition, PathResolver } from '../util/partitions'
import { EntryType, parseFastbootPack } from './fastboot-pack'

export type FirmwareImages = Map<string, Buffer>

async function extractFactoryDirFirmware(
  config: DeviceConfig,
  stockProps: PartitionProps,
  pathResolver: PathResolver,
  images: FirmwareImages,
) {
  let basePath =
    config.device.backport_base_firmware === true
      ? assertDefined(pathResolver.overlay?.basePath)
      : pathResolver.basePath

  let baseFwDirPath = path.join(basePath, BASE_FIRMWARE_DIR)
  let vendorProps = mapGet(stockProps, Partition.Vendor)

  let blVersion = mapGet(vendorProps, BOOTLOADER_VERSION_PROP)

  let imageInfix = `-${config.device.name}${config.device.is_beta_build_id ? '_beta' : ''}-`

  images.set('bootloader.img', await fs.readFile(path.join(baseFwDirPath, `bootloader${imageInfix}${blVersion}.img`)))

  let basebandVersion = vendorProps.get(BASEBAND_VERSION_PROP)
  if (basebandVersion !== undefined) {
    images.set(
      'radio.img',
      await fs.readFile(path.join(baseFwDirPath, `radio${imageInfix}${basebandVersion.toLowerCase()}.img`)),
    )
  }
}

// Path can be a directory or zip
export async function extractFactoryFirmware(
  config: DeviceConfig,
  stockProps: PartitionProps,
  pathResolver: PathResolver,
) {
  let images: FirmwareImages = new Map<string, Buffer>()

  await extractFactoryDirFirmware(config, stockProps, pathResolver, images)

  let abPartitions = new Set(assertDefined(getAbOtaPartitions(stockProps)))

  // Extract partitions from firmware FBPKs (fastboot packs)
  for (let [, fbpkBuf] of Array.from(images.entries())) {
    let fastbootPack = parseFastbootPack(fbpkBuf)
    for (let entry of fastbootPack.entries) {
      if (abPartitions.has(entry.name)) {
        assert(entry.type === EntryType.PartitionData, `unexpected entry type: ${entry.type}`)
        images.set(entry.name + '.img', entry.readContents(fbpkBuf))
      }
    }
  }

  return images
}

export async function writeFirmwareImages(images: FirmwareImages, fwDir: string) {
  let paths = []
  let promises: Promise<void>[] = []
  for (let [name, buffer] of images.entries()) {
    let path = `${fwDir}/${name}`
    paths.push(path)
    promises.push(fs.writeFile(path, buffer))
  }
  await Promise.all(promises)

  return paths
}

export function generateAndroidInfo(device: string, stockProps: PartitionProps) {
  let vendorProps = mapGet(stockProps, Partition.Vendor)

  let android_info = `require board=${device}

require version-bootloader=${mapGet(vendorProps, BOOTLOADER_VERSION_PROP)}
`
  let radioVersion = vendorProps.get(BASEBAND_VERSION_PROP)
  if (radioVersion !== undefined) {
    android_info += `require version-baseband=${radioVersion}\n`
  }

  if (assertDefined(getAbOtaPartitions(stockProps)).includes('vendor_kernel_boot')) {
    android_info += 'require partition-exists=vendor_kernel_boot\n'
  }

  return android_info
}
