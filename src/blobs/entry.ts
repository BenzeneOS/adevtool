import { BriefPackageInfo } from '../proto-ts/frameworks/base/tools/aapt2/BriefPackageInfo'
import { Partition } from '../util/partitions'
import { PartPath } from './file-list'

export interface BlobEntry {
  partPath: PartPath

  // Path to copy file from on host (default = srcDir/srcPath)
  diskSrcPath?: string

  apkInfo?: BriefPackageInfo
  apkSigningMode?: ApkSigningMode

  // Whether to force Kati
  disableSoong?: boolean
}

export enum ApkSigningMode {
  DO_NOT_RESIGN, // i.e. presigned
  RESIGN_WITH_PLATFORM_CERT,
  RESIGN_WITH_RELEASEKEY_CERT,
}

export function blobNeedsSoong(entry: BlobEntry, ext: string) {
  // Force-disable flag takes precedence
  if (entry.disableSoong) {
    return false
  }

  let relPath = entry.partPath.relPath
  if (entry.partPath.partition === Partition.Recovery && relPath.startsWith('system/')) {
    relPath = relPath.slice('system/'.length)
  }

  // On Android 12, Soong is required for ELF files (executables and libraries)
  if (relPath.startsWith('bin/') || ext == '.so') {
    return true
  }

  // Soong is also required for APKs, framework JARs, and vintf XMLs
  if (ext == '.apk' || ext == '.jar' || (relPath.startsWith('etc/vintf/') && ext == '.xml')) {
    return true
  }

  // Force Soong for APEXs to make them work better with flattened APEX builds.
  if (ext == '.apex') {
    return true
  }

  // Otherwise, just copy the file
  return false
}
