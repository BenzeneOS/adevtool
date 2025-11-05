import { confirm } from '@inquirer/prompts'
import { Command, Flags } from '@oclif/core'
import assert from 'assert'
import chalk from 'chalk'
import { promises as fs } from 'fs'
import { spawnSync } from 'node:child_process'
import path from 'path'
import { unzip } from 'unzipit'
import util from 'util'
import xml2js from 'xml2js'
import YAML from 'yaml'
import { OS_CHECKOUT_DIR } from '../config/paths'
import { assertDefined, filterAsync, mapGet, updateMultiMap, updateMultiSet } from '../util/data'
import { isDirectory, isFile, listFilesRecursive, readFile } from '../util/fs'
import { spawnGit } from '../util/git'
import { spawnAsyncStdin } from '../util/process'
import { ManifestConfig } from './generate-manifest'

export class ApplyBulletinPatches extends Command {
  static flags = {
    bulletinDir: Flags.file({ char: 'f', required: true, multiple: true }),
    osManifestConfig: Flags.file({ default: path.join(OS_CHECKOUT_DIR, '.repo/manifests/config.yml') }),
    osManifestFile: Flags.file({ default: path.join(OS_CHECKOUT_DIR, '.repo/manifests/default.xml') }),
    outDir: Flags.file({ required: true }),
    additionalPatchesDir: Flags.file(),
    skippedPatchesDir: Flags.file(),
  }

  async run() {
    let { flags } = await this.parse(ApplyBulletinPatches)

    let additionalPatchesDir = flags.additionalPatchesDir ?? path.join(path.dirname(flags.outDir), 'additional-patches')
    let skippedPatchesDir = flags.skippedPatchesDir ?? path.join(path.dirname(flags.outDir), 'patches-to-skip')

    let [additionalPatchesInfo, skippedPatchesInfo] = await Promise.all([
      readPatchesDir(additionalPatchesDir),
      readPatchesDir(skippedPatchesDir),
    ])

    console.log('Additional patches: ' + util.inspect(additionalPatchesInfo, false, Infinity))
    console.log('Patches to skip: ' + util.inspect(skippedPatchesInfo, false, Infinity))

    let projectNamePathMap = new Map<string, string>()
    // reverse mapping
    let repoPathProjectNameMap = new Map<string, string>()
    {
      let manifest = await xml2js.parseStringPromise(await readFile(flags.osManifestFile))
      let projects = manifest.manifest.project as XmlElement[]
      for (let proj of projects) {
        let aospName = proj.$['aosp-name']
        if (aospName === undefined) {
          aospName = assertDefined(proj.$.name)
        }
        let path = proj.$.path
        projectNamePathMap.set(aospName, path)
        repoPathProjectNameMap.set(path, aospName)
      }
    }

    let manifestConfig = YAML.parse(await readFile(flags.osManifestConfig)) as ManifestConfig
    let baseAospTag = manifestConfig.aosp_revision
    assert(baseAospTag.startsWith('android-'))
    assert(baseAospTag.includes('.0.0_r'))
    let baseAndroidVersion = baseAospTag.substring('android-'.length, baseAospTag.lastIndexOf('_'))

    let fullRepoPatchesMap = new Map<string, Patch[]>()

    // collect patches and CVE info from all provided bulletin dirs
    for (let bulletinDir of flags.bulletinDir) {
      let patchIndexFileName = assertDefined(
        (await fs.readdir(bulletinDir)).find(s => s.endsWith('-patches-index.json')),
      )
      let patchIndexFilePath = path.join(bulletinDir, patchIndexFileName)
      let patchesIndex = JSON.parse(await readFile(patchIndexFilePath)) as SecurityBulletinPatchesIndex
      if (patchesIndex.patches === undefined) {
        console.log('no patches in ' + bulletinDir + ' for any Android version')
        continue
      }
      let patches = patchesIndex.patches[baseAospTag]
      if (patches === undefined) {
        console.log('no patches in ' + bulletinDir + ' for ' + baseAospTag)
        continue
      }
      let repoShasMap = new Map<string, string[]>()
      let repoShasSetMap = new Map<string, Set<string>>()
      for (let repoPatches of patches.projects) {
        let repo = assertDefined(repoPatches.repo)
        assert(!repoShasSetMap.has(repo))
        repoShasSetMap.set(repo, new Set(assertDefined(repoPatches.shas)))
        assert(!repoShasMap.has(repo))
        repoShasMap.set(repo, repoPatches.shas)
      }

      let bulletinFileName = patchIndexFileName.slice(0, -'-patches-index.json'.length) + '.json'
      let bulletin = JSON.parse(await readFile(path.join(bulletinDir, bulletinFileName))) as BulletinInfo

      let cveInfoMap = new Map<string, Set<string>>() // patch SHA -> patch CVE infos

      for (let vuln of bulletin.vulnerabilities) {
        let cve = vuln.CVE
        if (cve === undefined || vuln.version_data === undefined) {
          continue
        }
        let versionData = vuln.version_data[baseAndroidVersion]
        if (versionData === undefined) {
          continue
        }
        let branches = versionData.branches
        assert(branches.length === 1)
        let severity = versionData.severity ?? 'Unknown'
        let cveInfo = [cve, CVE_INFO_SEVERITY_PREFIX + severity].join(CVE_INFO_ITEM_SEPARATOR)
        for (let data of branches[0].projects) {
          let repo = assertDefined(data.repo)
          let presentShas = assertDefined(repoShasSetMap.get(repo))
          for (let sha of assertDefined(data.shas)) {
            assert(presentShas.has(sha), sha)
            updateMultiSet(cveInfoMap, sha, cveInfo)
          }
        }
      }

      let bulletinZipFileName = patchIndexFileName.slice(0, -'-index.json'.length) + '.zip'
      let bulletinZipFilePath = path.join(bulletinDir, bulletinZipFileName)
      let zipPatchMap: Map<string, string> | null = null // commit hash -> patch contents
      if (await isFile(bulletinZipFilePath)) {
        zipPatchMap = await readPatchesFromBulletinZip(bulletinZipFilePath, baseAospTag)
      }
      let patchesDir = path.join(bulletinDir, 'patches')

      for (let [repo, shas] of repoShasMap.entries()) {
        let repoPath = mapGet(projectNamePathMap, repo)
        let skippedPatchesArr = await Promise.all(
          (skippedPatchesInfo.patchMap.get(repoPath) ?? []).map(async patchPath => readFile(patchPath)),
        )
        let skippedPatches = new Set(skippedPatchesArr)
        assert(skippedPatches.size === skippedPatchesArr.length)
        let repoPatches: Patch[] = []
        for (let sha of shas) {
          let patch: string
          let filePath: string | undefined = undefined
          if (zipPatchMap !== null) {
            patch = mapGet(zipPatchMap, sha)
          } else {
            filePath = path.join(patchesDir, sha + '.patch')
            patch = await readFile(filePath)
          }
          if (skippedPatches.has(patch)) {
            continue
          }
          let patchMessageStartMarker = '\n\n'
          let patchMessageStart = patch.indexOf(patchMessageStartMarker)
          assert(patchMessageStart > 0)
          let patchHeader = patch.substring(0, patchMessageStart)
          let cveInfoSet = cveInfoMap.get(sha)
          let patchContents: string
          if (cveInfoSet !== undefined) {
            let cveInfoStr =
              '\n' +
              Array.from(cveInfoSet)
                .sort()
                .map(s => CVE_INFO_HEADER + s)
                .join('')
            patchContents = patchHeader + cveInfoStr + patch.substring(patchMessageStart)
          } else {
            patchContents = patch
          }
          repoPatches.push({
            patchContents: patchContents,
            srcFilePath: filePath,
            isAdditional: false,
          })
        }

        let fullRepoPatches = fullRepoPatchesMap.get(repo)
        if (fullRepoPatches === undefined) {
          fullRepoPatches = []
          fullRepoPatchesMap.set(repo, fullRepoPatches)
        }
        fullRepoPatches.push(...repoPatches)
      }
    }

    for (let [repoPath, patchPaths] of additionalPatchesInfo.patchMap) {
      let repo = mapGet(repoPathProjectNameMap, repoPath)
      let fullRepoPatches = fullRepoPatchesMap.get(repo)
      if (fullRepoPatches === undefined) {
        fullRepoPatches = []
        fullRepoPatchesMap.set(repo, fullRepoPatches)
      }
      let patches = await Promise.all(
        patchPaths.toSorted().map(async patchPath => {
          return {
            srcFilePath: patchPath,
            patchContents: await readFile(patchPath),
            isAdditional: true,
          } as Patch
        }),
      )
      fullRepoPatches.push(...patches)
    }

    let forkedAospRepos = new Set<string>(manifestConfig.forked_aosp_repos)
    let forkRemoteName = manifestConfig.additional_remotes[0].name

    let revision = manifestConfig.revision
    let prefix = 'refs/heads/'
    if (revision.startsWith(prefix)) {
      revision = revision.substring(prefix.length)
    }
    let baseRevision = forkRemoteName + '/' + revision
    let patchedRepos: PatchedRepo[] = []
    let manualResolutionRequiredRepos: [string, Patch[]][] = []

    for (let [repoName, patches] of fullRepoPatchesMap) {
      if (patches.length === 0) {
        continue
      }
      let repoPath = mapGet(projectNamePathMap, repoName)
      console.log(chalk.bold(repoPath))
      try {
        await spawnGit(repoPath, ['remote', 'get-url', 'aosp'])
      } catch (e) {
        try {
          await spawnGit(repoPath, ['remote', 'remove', 'aosp'])
        } catch (_) {
          /* empty */
        }
        await spawnGit(repoPath, ['remote', 'add', 'aosp', 'https://android.googlesource.com/' + repoName])
      }

      let baseAospRef = baseAospTag
      await spawnGit(repoPath, ['fetch', '--quiet', 'aosp', 'tag', baseAospRef])

      /*
        let baseAndroidVersionShort = baseAndroidVersion.substring(0, baseAndroidVersion.indexOf('.'))
        assert(baseAndroidVersionShort.length === 2)
        let altBaseAospRef = `android${baseAndroidVersionShort}-security-release`
        try {
          await spawnGit(repoPath, ['fetch', '--quiet', 'aosp', altBaseAospRef])
          baseAospRef = 'aosp/' + altBaseAospRef
        } catch (e) {
          await spawnGit(repoPath, ['fetch', '--quiet', 'aosp', 'tag', baseAospRef])
        }
      */

      await spawnGit(repoPath, ['checkout', '--quiet', 'FETCH_HEAD'])

      let additionalPatches: Patch[] = []
      for (let patchObj of patches) {
        if (patchObj.isAdditional) {
          additionalPatches.push(patchObj)
          continue
        }
        let patch = patchObj.patchContents
        let subjectStartMarker = '\nSubject: '
        let subjectStart = patch.indexOf(subjectStartMarker)
        assert(subjectStart > 0)
        subjectStart += subjectStartMarker.length
        let headerEnd = patch.indexOf('\n\n')
        assert(headerEnd > subjectStart)
        let subject = patch.substring(subjectStart, headerEnd).replaceAll('\n', '')

        let amOut
        for (;;) {
          try {
            amOut = await spawnAsyncStdin(
              'git',
              ['-C', repoPath, 'am', '--whitespace=nowarn'],
              Buffer.from(patch),
              line => line === 'warning: reading patches from stdin/tty...',
            )
            break
          } catch (e) {
            console.log(`Unable to apply "${subject}": ${e}`)
            await spawnGit(repoPath, ['am', '--abort'])
            await confirm({ message: 'Try again?' })
          }
        }
        assert(amOut.endsWith('\n'))
        console.log(amOut.slice(0, -1))
      }

      if (!forkedAospRepos.has(repoPath)) {
        await applyAdditionalPatches(repoPath, additionalPatches)

        if (spawnSync('git', ['-C', repoPath, 'diff', '--exit-code', 'HEAD', baseAospRef]).status !== 0) {
          patchedRepos.push({ path: repoPath, baseRevision: baseAospRef })
          console.log('Skipping rebasing ' + repoPath + " since it's not a fork")
        } else {
          console.log(`${repoPath}: ${baseAospRef} is same as HEAD`)
        }
      } else {
        await spawnGit(repoPath, ['fetch', '--quiet', forkRemoteName, revision])

        try {
          console.log('Rebasing ' + repoPath)
          await spawnGit(
            repoPath,
            ['rebase', '--quiet', '--onto', baseRevision, manifestConfig.aosp_revision],
            line => {
              if (line.endsWith(' -- patch contents already upstream')) {
                console.log(line)
                return true
              }
              return false
            },
          )
          await applyAdditionalPatches(repoPath, additionalPatches)

          if (spawnSync('git', ['-C', repoPath, 'diff', '--exit-code', 'HEAD', baseRevision]).status !== 0) {
            patchedRepos.push({ path: repoPath, baseRevision })
          } else {
            console.log(`${baseRevision} is same as HEAD`)
          }
        } catch (e) {
          manualResolutionRequiredRepos.push([repoPath, additionalPatches])
          console.log(e)
        }
      }
    }
    if (manualResolutionRequiredRepos.length > 0) {
      let orig = manualResolutionRequiredRepos
      for (;;) {
        console.log(
          '\nThe following repos have rebase conflicts:\n' +
            manualResolutionRequiredRepos.map(([repo]) => repo).join('\n') +
            '\nComplete the rebase manually before proceeding.',
        )
        let proceed = await confirm({ message: 'Proceed?' })
        manualResolutionRequiredRepos = await filterAsync(
          manualResolutionRequiredRepos,
          async ([repoPath, additionalPatches]) => {
            let clean = (await spawnGit(repoPath, ['status'])).includes('nothing to commit, working tree clean')
            if (clean) {
              await applyAdditionalPatches(repoPath, additionalPatches)
            }
            return !clean
          },
        )
        if (manualResolutionRequiredRepos.length === 0) {
          if (proceed) {
            break
          } else {
            for (;;) {
              console.log('Rebase is completed')
              if (await confirm({ message: 'Proceed?' })) {
                break
              }
            }
            break
          }
        }
      }
      for (let [repoPath] of orig) {
        if (spawnSync('git', ['-C', repoPath, 'diff', '--exit-code', 'HEAD', baseRevision]).status !== 0) {
          patchedRepos.push({ path: repoPath, baseRevision })
        } else {
          console.log(`${repoPath}: ${baseRevision} is same as HEAD`)
        }
      }
    }

    console.log()

    await fs.mkdir(flags.outDir, { recursive: true })
    let outDir = await fs.realpath(flags.outDir)

    await Promise.all(
      patchedRepos.map(async e =>
        spawnGit(e.path, [
          'format-patch',
          '--keep-subject',
          '--zero-commit',
          '--no-signature',
          '--output-directory',
          path.join(outDir, e.path),
          e.baseRevision,
        ]),
      ),
    )

    await Promise.all(patchedRepos.map(async e => spawnGit(e.path, ['checkout', '--quiet', e.baseRevision])))

    {
      let cveInfoMap = new Map<string, Set<string>>() // severity -> CVEs

      let patchPaths = await Array.fromAsync(listFilesRecursive(outDir))
      await Promise.all(
        patchPaths.map(async patchPath => {
          assert(patchPath.endsWith('.patch'))
          let patch = await readFile(patchPath)
          let searchStartIdx = 0
          for (;;) {
            let cveInfoHeaderIdx = patch.indexOf(CVE_INFO_HEADER, searchStartIdx)
            if (cveInfoHeaderIdx < searchStartIdx) {
              return
            }
            let cveInfoStart = cveInfoHeaderIdx + CVE_INFO_HEADER.length
            let cveInfoEnd = patch.indexOf('\n', cveInfoStart)
            assert(cveInfoEnd > cveInfoStart)
            let cveInfoStr = patch.substring(cveInfoStart, cveInfoEnd)
            let cveInfo = cveInfoStr.split(CVE_INFO_ITEM_SEPARATOR)
            assert(cveInfo.length === 2)
            let [cve, severityStr] = cveInfo
            assert(severityStr.startsWith(CVE_INFO_SEVERITY_PREFIX))
            let severity = severityStr.substring(CVE_INFO_SEVERITY_PREFIX.length)
            updateMultiSet(cveInfoMap, severity, cve)
            searchStartIdx = cveInfoEnd
          }
        }),
      )

      let cveInfoStr =
        Array.from(cveInfoMap.entries())
          .map(([severity, cves]) => {
            return severity + '\n' + Array.from(cves).toSorted().join('\n')
          })
          .toSorted()
          .join('\n\n') + '\n'
      await fs.writeFile(path.join(outDir, 'cve-info.txt'), cveInfoStr)
    }

    let applyScript = [
      '#!/bin/bash',
      '',
      'set -e',
      '[[ $# -ne 1 ]] && (echo expected OS checkout root as the single argument; exit 1)',
      'BASE_DIR=$(realpath $(dirname "$0"))',
      'CHECKOUT_ROOT=$(realpath $1)',
      '',
      'readonly patched_repos=(',
      ...patchedRepos.map(e => `    ${e.path}`).toSorted(),
      ')',
      '',
      'for repo in ${patched_repos[@]}; do',
      '    echo',
      '    echo Patching $repo',
      '    git -C $CHECKOUT_ROOT/$repo am --whitespace=nowarn $BASE_DIR/$repo/*.patch',
      'done',
      '',
      `sed -i 's/for channel in ("beta", "stable", "alpha", "testing"):/for channel in ("beta-security-preview", "stable-security-preview", "alpha-security-preview", "testing-security-preview"):/g' $CHECKOUT_ROOT/script/generate-metadata`,
      'echo',
      'echo Patched $CHECKOUT_ROOT/script/generate-metadata',
      '',
    ].join('\n')

    await fs.writeFile(path.join(outDir, 'apply.sh'), applyScript, { mode: 0o700 })

    console.log('Written patches and apply.sh script to ' + outDir)
  }
}

async function readPatchesFromBulletinZip(zipPath: string, baseAospTag: string) {
  let zipInfo = await unzip(await fs.readFile(zipPath))
  let patchPrefix = path.basename(zipPath, '.zip') + '/patches/' + baseAospTag + '/'
  let res = new Map<string, string>()
  for (let [name, zipEntry] of Object.entries(zipInfo.entries)) {
    if (!name.startsWith(patchPrefix)) {
      continue
    }
    let contents = await zipEntry.text()
    let lineEnd = contents.indexOf('\n')
    assert(lineEnd > 0, contents)
    let firstLine = contents.slice(0, lineEnd)
    assert(firstLine.length === 70, firstLine)
    let prefix = 'From '
    let suffix = ' Mon Sep 17 00:00:00 2001'
    assert(firstLine.startsWith(prefix))
    assert(firstLine.endsWith(suffix))
    let commitHash = firstLine.slice(prefix.length, firstLine.length - suffix.length)
    assert(commitHash.length === 40)
    res.set(commitHash, contents)
  }
  return res
}

async function applyAdditionalPatches(repoPath: string, patches: Patch[]) {
  for (let patchObj of patches) {
    let amOut = await spawnAsyncStdin(
      'git',
      ['-C', repoPath, 'am', '--whitespace=nowarn'],
      Buffer.from(patchObj.patchContents),
      line => line === 'warning: reading patches from stdin/tty...',
    )
    assert(amOut.endsWith('\n'))
    console.log('Additional patch: ' + amOut.slice(0, -1))
  }
}

const CVE_INFO_HEADER = '\nCVE-Info: '
const CVE_INFO_ITEM_SEPARATOR = ' | '
const CVE_INFO_SEVERITY_PREFIX = 'Severity: '

interface Patch {
  patchContents: string // won't be same as contents of srcFilePath in most cases due to editing
  srcFilePath?: string
  isAdditional: boolean
}

interface PatchesDir {
  // repo path -> patches
  patchMap: Map<string, string[]>
}

async function readPatchesDir(dirPath: string) {
  if (!(await isDirectory(dirPath))) {
    return { patchMap: new Map() } as PatchesDir
  }

  let patchMap = new Map<string, string[]>()
  for await (let filePath of listFilesRecursive(dirPath)) {
    if (!filePath.endsWith('.patch')) {
      continue
    }
    updateMultiMap(patchMap, path.dirname(path.relative(dirPath, filePath)), filePath)
  }
  return { patchMap } as PatchesDir
}

interface XmlElement {
  $: Record<string, string>
}

interface PatchedRepo {
  path: string
  baseRevision: string
}

interface SecurityBulletinPatchesIndex {
  patches: { [tag: string]: SecurityBulletinPatches }
}

interface SecurityBulletinPatches {
  branch: string
  projects: RepoPatches[]
}

interface RepoPatches {
  repo: string
  shas: string[]
}

interface BulletinInfo {
  title: string
  bulletin_id: string
  published: string
  vulnerabilities: Vulnerability[]
}

interface Vulnerability {
  bulletin_id: string
  CVE?: string
  area: string
  component: string
  subcomponent?: string
  patch_level: string
  android_id: string
  type?: string
  severity: string
  aosp_versions: string[]
  tech_details: string
  fix_details?: string
  version_data?: { [versionName: string]: VulnVersionData }
}

interface VulnVersionData {
  type: string
  severity: string
  patch_links: string[]
  branches: VulnVersionBranchData[]
}

interface VulnVersionBranchData {
  name: string
  projects: VulnProjectData[]
}

interface VulnProjectData {
  repo: string
  shas: string[]
}
