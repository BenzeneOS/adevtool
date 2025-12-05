import assert from 'assert'
import { promises as fs } from 'fs'
import path from 'path'
import { VendorDirectories } from '../blobs/build'
import { appendPartitionProps, serializeBlueprint, serializeModule, SoongModule } from '../build/soong'
import { DeviceConfig } from '../config/device'
import { SystemState } from '../config/system-state'
import { maybePlural } from '../util/cli'
import { assertNonNull } from '../util/data'
import { FilterResult, getExclusions, getInclusions } from '../util/exact-filter'
import { isDirectory, isFile, mkdirAndWriteFile } from '../util/fs'
import { log } from '../util/log'
import { Partition, PathResolver, REGULAR_SYS_PARTITIONS } from '../util/partitions'
import { getRootElementChildrenAsStrings, getXmlProp, getXmlText, processXml, ProcessXmlCmd } from '../util/xml'

export interface VintfPaths {
  compatMatrices: string[]
  baseManifestFile: string | null
  manifestFragments: string[]
}

export async function processVintf(
  deviceConfig: DeviceConfig,
  pathResolver: PathResolver,
  customState: SystemState,
  dirs: VendorDirectories,
) {
  let interfaceExclusions = new Set(deviceConfig.vintf_exclusions)
  let interfaceInclusions = new Set(deviceConfig.vintf_inclusions)
  let unknownInterfaces = new Set<string>()
  let rootDstDir = path.join(dirs.out, 'vintf')
  let partJobs = Array.from(REGULAR_SYS_PARTITIONS).map(async partition => {
    let vintfDirPath = pathResolver.resolve(partition, 'etc/vintf')

    let vintfPaths: VintfPaths = {
      compatMatrices: [],
      baseManifestFile: null,
      manifestFragments: [],
    }

    let dstDirPath = path.join(rootDstDir, partition)

    let compatMatrixJob = (async () => {
      if (partition === Partition.System) {
        return
      }
      if (!(await isDirectory(vintfDirPath))) {
        return
      }
      for (let de of await fs.readdir(vintfDirPath, { withFileTypes: true })) {
        if (!de.name.includes('compatibility_matrix')) {
          continue
        }
        assert(de.isFile())
        let fileName = de.name

        let matrixFile = path.join(vintfDirPath, fileName)

        let exclusions = getExclusions(
          deviceConfig.vintf_compat_matrix_exclusions,
          customState.partitionVintfCompatMatrices,
          partition,
        )
        let inclusions = getInclusions(deviceConfig.vintf_compat_matrix_inclusions, partition)

        let cmd = getProcessCompatMatrixCmd(
          exclusions,
          inclusions,
          interfaceExclusions,
          interfaceInclusions,
          unknownInterfaces,
          matrixFile,
          dstDirPath,
          fileName,
          partition,
        )
        vintfPaths.compatMatrices.push(...(await processXml(cmd)))
      }
    })()

    let manifestJob = (async () => {
      let exclusions = getExclusions(
        deviceConfig.vintf_manifest_exclusions,
        customState.partitionVintfManifests,
        partition,
      )
      let inclusions = getInclusions(deviceConfig.vintf_manifest_inclusions, partition)

      let baseFileJob = (async () => {
        const fileName = 'manifest.xml'
        let filePath = path.join(vintfDirPath, fileName)
        if (!(await isFile(filePath))) {
          return
        }
        let cmd = getProcessManifestCmd(
          exclusions,
          inclusions,
          interfaceExclusions,
          interfaceInclusions,
          unknownInterfaces,
          filePath,
          dstDirPath,
          fileName,
          partition,
        )

        let res = await processXml(cmd)
        assert(res.length <= 1)
        if (res.length === 1) {
          vintfPaths.baseManifestFile = res[0]
        }
      })()

      let dirJob = (async () => {
        const dirName = 'manifest'
        let manifestDirPath = path.join(vintfDirPath, dirName)
        if (!(await isDirectory(manifestDirPath))) {
          return
        }
        let dstManifestDirPath = path.join(dstDirPath, dirName)
        let fragmentFilePaths: string[] = []
        let jobs = (await fs.readdir(manifestDirPath, { withFileTypes: true })).map(async de => {
          assert(de.isFile())
          let filePath = path.join(manifestDirPath, de.name)
          let cmd = getProcessManifestCmd(
            exclusions,
            inclusions,
            interfaceExclusions,
            interfaceInclusions,
            unknownInterfaces,
            filePath,
            dstManifestDirPath,
            de.name,
            partition,
          )

          fragmentFilePaths.push(...(await processXml(cmd)))
        })

        await Promise.all(jobs)

        if (fragmentFilePaths.length === 0) {
          return
        }

        fragmentFilePaths.sort()

        let fragmentFileNames = fragmentFilePaths.map(filePath => {
          let fileName = path.basename(filePath)
          let moduleName = `adevtool_vintf_fragment_${partition}_${fileName}`
          return [fileName, moduleName]
        })

        let androidBp = fragmentFileNames
          .map(([fileName, moduleName]) => {
            let module = {
              _type: 'vintf_fragment',
              name: moduleName,
              src: fileName,
            } as SoongModule
            appendPartitionProps(module, partition)
            return serializeModule(module)
          })
          .join('\n\n')

        vintfPaths.manifestFragments.push(...fragmentFileNames.map(([, moduleName]) => moduleName))
        await fs.writeFile(path.join(dstManifestDirPath, 'Android.bp'), androidBp)
      })()

      await baseFileJob
      await dirJob
    })()
    await compatMatrixJob
    await manifestJob
    vintfPaths.compatMatrices.sort()
    return [partition, vintfPaths]
  })
  let vintfPathsMap = (await Promise.all(partJobs)) as [string, VintfPaths][]
  if (unknownInterfaces.size > 0) {
    let arr = Array.from(unknownInterfaces).sort()
    log('unknown vintf interface' + maybePlural(arr) + ':')
    arr.forEach(e => log('  - ' + e))
  }
  await mkdirAndWriteFile(rootDstDir, 'Android.bp', serializeBlueprint({ namespace: true }))
  return new Map(vintfPathsMap)
}

export interface Vintf {
  compatMatrices: Map<string, string[]>
  manifests: Map<string, string[]>
}

export interface PartitionVintf {
  partition: Partition
  compatMatrix: string[] | null
  manifest: string[] | null
}

export async function loadVintf(pathResolver: PathResolver) {
  let partJobs = Array.from(REGULAR_SYS_PARTITIONS).map(async partition => {
    let vintfDirPath = pathResolver.resolve(partition, 'etc/vintf')
    let compatMatrix = (async () => {
      let compatMatrixPath = path.join(vintfDirPath, compatMatrixFileName(partition))
      if (!(await isFile(compatMatrixPath))) {
        return null
      }
      let entries = getRootElementChildrenAsStrings(await fs.readFile(compatMatrixPath), ['compatibility-matrix'], true)
      if (entries.length > 0) {
        return entries.sort()
      } else {
        return null
      }
    })()
    let manifests = (async () => {
      let manifestEntries: string[] = []
      let baseManifestPath = path.join(vintfDirPath, 'manifest.xml')
      if (await isFile(baseManifestPath)) {
        manifestEntries.push(
          ...getRootElementChildrenAsStrings(await fs.readFile(baseManifestPath), ['manifest'], true),
        )
      }
      let manifestDir = path.join(vintfDirPath, 'manifest')
      if (await isDirectory(manifestDir)) {
        let files = (await fs.readdir(manifestDir, { withFileTypes: true })).map(async de => {
          assert(de.isFile())
          assert(de.name.endsWith('.xml'))
          let xmlString = await fs.readFile(path.join(manifestDir, de.name))
          return getRootElementChildrenAsStrings(xmlString, ['manifest'], true)
        })
        for (let entries of await Promise.all(files)) {
          manifestEntries.push(...entries)
        }
      }
      if (manifestEntries.length > 0) {
        return manifestEntries
      } else {
        return null
      }
    })()
    return { partition, compatMatrix: await compatMatrix, manifest: await manifests } as PartitionVintf
  })
  let compatMatrices = new Map<string, string[]>()
  let manifests = new Map<string, string[]>()
  for (let e of await Promise.all(partJobs)) {
    if (e.compatMatrix !== null) {
      compatMatrices.set(e.partition, e.compatMatrix)
    }
    if (e.manifest !== null) {
      manifests.set(e.partition, e.manifest)
    }
  }
  return { compatMatrices, manifests } as Vintf
}

function getProcessCompatMatrixCmd(
  exclusions: Set<string>,
  inclusions: Set<string>,
  interfaceExclusions: Set<string>,
  interfaceInclusions: Set<string>,
  unknownInterfaces: Set<string>,
  srcFilePath: string,
  dstDirPath: string,
  dstFileName: string,
  partition: Partition,
) {
  return {
    xmlFilePath: srcFilePath,
    allowedRootElementNames: ['compatibility-matrix'],
    dstDirPath,
    dstFileName,
    dstFileHeader: '',
    filterSpec: {
      process: (_, entry) => {
        let hal = entry['hal']
        let attrs = entry[':@']
        let format = attrs !== undefined ? (getXmlProp(attrs, '@_format') as string) : null
        if (hal !== undefined) {
          let name: string | null = null
          let intefaces: string[] = []
          for (let e of hal as unknown[]) {
            for (let [k, v] of Object.entries(e as object)) {
              switch (k) {
                case 'name':
                  assert(name === null)
                  name = getXmlText(v)
                  break
                case 'interface': {
                  let ifaceNameObj = (v as object[]).find(k => getXmlProp(k, 'name') !== undefined)
                  let ifaceName = getXmlText(getXmlProp(ifaceNameObj, 'name'))
                  for (let e of v as object[]) {
                    for (let [ik, iv] of Object.entries(e as object)) {
                      if (ik === 'instance') {
                        let instance = getXmlText(iv)
                        intefaces.push(ifaceName + '/' + instance)
                      }
                    }
                  }
                  break
                }
              }
            }
          }
          assertNonNull(name)

          let infix = format == 'hidl' ? '::' : '.'
          let fqInterfaces = intefaces.map(i => name + infix + i)
          if (fqInterfaces.find(e => !interfaceExclusions.has(e)) === undefined) {
            return FilterResult.EXCLUDE
          }
          if (fqInterfaces.find(e => !interfaceInclusions.has(e)) == undefined) {
            return FilterResult.INCLUDE
          }
          for (let e of fqInterfaces) {
            if (!interfaceExclusions.has(e) && !interfaceInclusions.has(e)) {
              unknownInterfaces.add(e)
            }
          }
        }
        return FilterResult.UNKNOWN_ENTRY
      },
      exclusions,
      inclusions,
      unknownEntriesMessagePrefix: 'included unknown vintf compatibility-matrix entries:',
      yamlPath: ['', partition],
    },
  } as ProcessXmlCmd
}

function getProcessManifestCmd(
  exclusions: Set<string>,
  inclusions: Set<string>,
  interfaceExclusions: Set<string>,
  interfaceInclusions: Set<string>,
  unknownInterfaces: Set<string>,
  srcFilePath: string,
  dstDirPath: string,
  dstFileName: string,
  part: Partition,
) {
  return {
    xmlFilePath: srcFilePath,
    allowedRootElementNames: ['manifest'],
    dstDirPath,
    dstFileName,
    dstFileHeader: '',
    filterSpec: {
      process(_, entry) {
        let hal = entry['hal']
        let attrs = entry[':@']
        let format = attrs !== undefined ? (getXmlProp(attrs, '@_format') as string) : null
        if (hal !== undefined) {
          let name: string | null = null
          let intefaces: string[] = []
          for (let e of hal as unknown[]) {
            for (let [k, v] of Object.entries(e as object)) {
              switch (k) {
                case 'name':
                  assert(name === null)
                  name = getXmlText(v)
                  break
                case 'fqname': {
                  intefaces.push(getXmlText(v))
                  break
                }
              }
            }
          }
          assertNonNull(name)

          let infix = format == 'hidl' ? '::' : '.'

          let fqInterfaces = intefaces.map(e => {
            let idx = e.indexOf('::')
            let suffix = idx > 0 ? e.substring(idx + 2) : e
            return name + infix + suffix
          })

          if (fqInterfaces.find(e => !interfaceExclusions.has(e)) === undefined) {
            return FilterResult.EXCLUDE
          }
          if (fqInterfaces.find(e => !interfaceInclusions.has(e)) == undefined) {
            return FilterResult.INCLUDE
          }
          for (let e of fqInterfaces) {
            if (!interfaceExclusions.has(e) && !interfaceInclusions.has(e)) {
              unknownInterfaces.add(e)
            }
          }
        }
        return FilterResult.UNKNOWN_ENTRY
      },
      exclusions,
      inclusions,
      unknownEntriesMessagePrefix: 'included unknown vintf manifest entries from ' + srcFilePath + ' :',
      yamlPath: ['', part],
    },
  } as ProcessXmlCmd
}

function compatMatrixFileName(part: Partition) {
  return part === Partition.System ? 'compatibility_matrix.device.xml' : 'compatibility_matrix.xml'
}
