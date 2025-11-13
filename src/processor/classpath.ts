import assert from 'assert'
import { promises as fs } from 'fs'
import { Reader } from 'protobufjs'
import { SystemState } from '../config/system-state'
import { Classpath, ExportedClasspathsJars } from '../proto-ts/packages/modules/common/proto/classpaths'
import { Partition, PathResolver } from '../util/partitions'

export async function processSystemServerClassPaths(pathResolver: PathResolver, customState: SystemState) {
  let presentPaths = new Set(customState.systemServerClassPaths)
  return (await loadSystemServerClassPaths(pathResolver)).filter(p => !presentPaths.has(p))
}

export async function loadSystemServerClassPaths(pathResolver: PathResolver) {
  let filePath = pathResolver.resolve(Partition.System, 'etc/classpaths/systemserverclasspath.pb')
  let cpJars = ExportedClasspathsJars.decode(Reader.create(await fs.readFile(filePath)))
  return cpJars.jars.map(jar => {
    assert(jar.classpath === Classpath.SYSTEMSERVERCLASSPATH)
    assert(jar.minSdkVersion === '')
    assert(jar.maxSdkVersion === '')
    let jarPath = jar.path.split('/')
    assert(jarPath.length === 4)
    assert(jarPath[0] === '')
    let partition = jarPath[1]
    assert(jarPath[2] === 'framework')
    let name = jarPath[3]
    let nameSuffix = '.jar'
    assert(name.endsWith(nameSuffix))
    return partition + ':' + name.slice(0, -nameSuffix.length)
  })
}
