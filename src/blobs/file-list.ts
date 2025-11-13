import assert from 'assert'
import { exists } from '../util/fs'
import { Partition, PathResolver } from '../util/partitions'

export type PseudoPath = string

export class PartPath {
  constructor(
    public readonly partition: Partition,
    public readonly relPath: string,
  ) {}

  resolve(resolver: PathResolver) {
    return resolver.resolve(this.partition, this.relPath)
  }

  asPseudoPath(): PseudoPath {
    return PartPath.makePseudoPath(this.partition, this.relPath)
  }

  static makePseudoPath(part: Partition, relPath: string): PseudoPath {
    return part + '/' + relPath
  }

  static fromPseudoPath(s: PseudoPath) {
    let splitIdx = s.indexOf('/')
    assert(splitIdx > 0)
    return new PartPath(s.substring(0, splitIdx) as Partition, s.substring(splitIdx + 1))
  }

  static compare(collator: Intl.Collator, a: PartPath, b: PartPath) {
    let res = collator.compare(a.relPath, b.relPath)
    if (res === 0) {
      res = collator.compare(a.partition, b.partition)
    }
    return res
  }
}

export async function listPart(partition: Partition, pathResolver: PathResolver) {
  let partRoot = pathResolver.resolve(partition)
  if (!(await exists(partRoot))) {
    return null
  }

  let files = await Array.fromAsync(pathResolver.listRecursively(partition, null))

  // Sort and return raw path list
  let collator = new Intl.Collator()
  return files.sort((a, b) => collator.compare(a.relPath, b.relPath))
}

export function diffLists(filesRef: Array<string>, filesNew: Array<string>) {
  let setRef = new Set(filesRef)
  return filesNew.filter(f => !setRef.has(f)).sort()
}
