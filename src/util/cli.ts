import assert from 'assert'
import child_proc from 'child_process'
import path from 'path'

import { spawnAsync } from './process'

export function maybePlural<T>(arr: ArrayLike<T>, singleEnding = '', multiEnding = 's') {
  let len = arr.length
  assert(len > 0)
  return len > 1 ? multiEnding : singleEnding
}

export function gitDiff(path1: string, path2: string) {
  return spawnAsync('git', ['diff', '--color=always', path1, path2], undefined, undefined, [0, 1])
}

export function showGitDiff(repoPath: string, filePath?: string) {
  let args = ['-C', repoPath, `diff`]
  if (filePath !== undefined) {
    args.push(path.relative(repoPath, filePath))
  }

  let ret = child_proc.spawnSync('git', args, { stdio: 'inherit' })
  assert(ret.status === 0)
}
