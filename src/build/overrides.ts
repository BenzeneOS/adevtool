import { PseudoPath } from '../blobs/file-list'
import { mapSet, setIntersection } from '../util/data'
import { SoongModuleInfo } from './soong-info'

export interface OverrideModules {
  modules: Array<string>
  builtPaths: Array<PseudoPath>
  missingPaths: Array<PseudoPath>
}

export function findOverrideModules(overridePseudoPaths: Array<PseudoPath>, modulesMap: SoongModuleInfo) {
  // Build index of multilib modules
  let multilibs = new Set<string>()
  for (let [name, module] of modulesMap.entries()) {
    if (name.endsWith('_32')) {
      let moduleName = module.module_name
      if (moduleName === undefined) {
        moduleName = name
      }
      multilibs.add(moduleName)
    }
  }

  // Build installed path->module index
  let pathMap = new Map<PseudoPath, [string, string]>()
  for (let [key, module] of modulesMap.entries()) {
    for (let pseudoPath of module.installed) {
      let moduleName = module.module_name
      if (moduleName === undefined) {
        moduleName = key
      }
      pathMap.set(pseudoPath, [key, moduleName])
      let suffix = '.prebuilt.xml'
      if (pseudoPath.endsWith(suffix) && pseudoPath.includes('/etc/permissions/')) {
        // see comment in frameworks/native/data/etc/Android.bp
        let altPseudoPath = pseudoPath.slice(0, -suffix.length) + '.xml'
        // use mapSet to make sure altPseudoPath doesn't override regular pseudoPath
        mapSet(pathMap, altPseudoPath, [key, moduleName])
      }
    }
  }

  // Resolve available modules and keep track of missing paths
  let buildModules = new Set<string>()
  let builtPaths = []
  let missingPaths = []
  // Defer multlib modules (these are module_names without _32 or :32/:64)
  let multilib32 = new Set<string>()
  let multilib64 = new Set<string>()
  for (let pseudoPath of overridePseudoPaths) {
    let value = pathMap.get(pseudoPath)
    if (value !== undefined) {
      let [key, module] = value

      if (multilibs.has(module)) {
        // If this module is multilib, add it to the respective arch set instead
        if (key.endsWith('_32')) {
          // 32-bit only
          multilib32.add(module)
        } else {
          // 64-bit only
          multilib64.add(module)
        }
      } else {
        // Otherwise, just build the module normally
        buildModules.add(module)
      }

      // Always add the path
      builtPaths.push(pseudoPath)
    } else {
      missingPaths.push(pseudoPath)
    }
  }

  // Now resolve the multilib modules. Example:
  // Both = libX
  let multilibBoth = setIntersection(multilib32, multilib64)
  // Then separate the remaining arch-specific modules (faster than new set difference)
  multilibBoth.forEach(m => {
    // 32 = libX:32
    multilib32.delete(m)
    // 64 = libX:64
    multilib64.delete(m)
  })

  // Add final multilib modules
  multilibBoth.forEach(m => buildModules.add(m))
  multilib32.forEach(m => buildModules.add(`${m}:32`))
  multilib64.forEach(m => buildModules.add(`${m}:64`))

  return {
    modules: Array.from(buildModules).sort(),
    builtPaths,
    missingPaths,
  } as OverrideModules
}
