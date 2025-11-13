import path from 'path'
import { loadPartitionProps, PartitionProps } from '../blobs/props'
import { loadSystemServerClassPaths } from '../processor/classpath'
import { loadSepolicy } from '../processor/sepolicy'
import { loadSysconfigs } from '../processor/sysconfig'
import { loadVintf } from '../processor/vintf'
import { readFile } from '../util/fs'
import { PathResolver } from '../util/partitions'
import { Sepolicy } from './device'

const STATE_VERSION = 7

export interface SystemState {
  deviceInfo: {
    name: string
  }

  partitionFiles: { [part: string]: Array<string> }
  partitionProps: PartitionProps

  partitionVintfCompatMatrices: Map<string, string[]>
  partitionVintfManifests: Map<string, string[]>
  sysConfigs: string[]

  sepolicy: { [part: string]: Sepolicy }

  systemServerClassPaths: string[]

  extraModules: string[]
}

type SerializedSystemState = {
  version: number
} & SystemState

export function serializeSystemState(state: SystemState) {
  let diskState = {
    version: STATE_VERSION,
    ...state,
  }

  return JSON.stringify(
    diskState,
    (k, v) => {
      if (v instanceof Map) {
        return {
          _type: 'Map',
          data: Object.fromEntries(v.entries()),
        }
      }
      return v
    },
    2,
  )
}

export function parseSystemState(json: string) {
  let diskState = JSON.parse(json, (k, v) => {
    // eslint-disable-next-line no-prototype-builtins
    if (v?.hasOwnProperty('_type') && v?._type == 'Map') {
      return new Map(Object.entries(v.data))
    }
    return v
  }) as SerializedSystemState

  if (diskState.version != STATE_VERSION) {
    throw new Error(`Outdated state v${diskState.version}; expected v${STATE_VERSION}`)
  }

  return diskState as SystemState
}

export async function parseAllimagesFileList(pathResolver: PathResolver) {
  let partitionFiles: { [part: string]: string[] } = {}
  let fileList = await readFile(path.join(pathResolver.basePath, 'allimages-file-list.txt'))

  let filePaths = fileList.split(' ')

  for (let filePath of filePaths) {
    let partPath = pathResolver.backResolve(filePath)
    if (partPath === null) {
      continue
    }

    let arr = partitionFiles[partPath.partition]
    if (arr === undefined) {
      arr = []
      partitionFiles[partPath.partition] = arr
    }
    arr.push(partPath.relPath)
  }
  return partitionFiles
}

export async function collectSystemState(device: string, pathResolver: PathResolver) {
  let state = {
    deviceInfo: {
      name: device,
    },
  } as SystemState

  let partitionFiles = parseAllimagesFileList(pathResolver)
  let partitionProps = loadPartitionProps(pathResolver, null, false)
  let vintf = loadVintf(pathResolver)
  let sysconfigs = loadSysconfigs(pathResolver)
  let sepolicy = loadSepolicy(pathResolver)

  let systemServerClassPaths = loadSystemServerClassPaths(pathResolver)

  state.partitionFiles = await partitionFiles
  state.partitionProps = await partitionProps
  state.partitionVintfCompatMatrices = (await vintf).compatMatrices
  state.partitionVintfManifests = (await vintf).manifests
  state.sysConfigs = await sysconfigs
  state.sepolicy = await sepolicy
  state.systemServerClassPaths = await systemServerClassPaths

  return state
}
