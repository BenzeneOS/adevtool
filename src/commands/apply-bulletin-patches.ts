import { confirm } from '@inquirer/prompts'
import { Command, Flags } from '@oclif/core'
import assert from 'assert'
import chalk from 'chalk'
import { promises as fs } from 'fs'
import { spawnSync } from 'node:child_process'
import path from 'path'
import xml2js from 'xml2js'
import YAML from 'yaml'
import { OS_CHECKOUT_DIR } from '../config/paths'
import { assertDefined, filterAsync, mapGet, updateMultiMap } from '../util/data'
import { isFile, readFile } from '../util/fs'
import { spawnGit } from '../util/git'
import { ManifestConfig } from './generate-manifest'

export class ApplyBulletinPatches extends Command {
  static flags = {
    bulletinDir: Flags.file({ char: 'f', required: true, multiple: true }),
    osManifestConfig: Flags.file({ default: path.join(OS_CHECKOUT_DIR, '.repo/manifests/config.yml') }),
    osManifestFile: Flags.file({ default: path.join(OS_CHECKOUT_DIR, '.repo/manifests/default.xml') }),
    outDir: Flags.file({ required: true }),
  }

  async run() {
    let { flags } = await this.parse(ApplyBulletinPatches)

    let projectNamePathMap = new Map<string, string>()
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
      }
    }

    let manifestConfig = YAML.parse(await readFile(flags.osManifestConfig)) as ManifestConfig
    let baseAospTag = manifestConfig.aosp_revision
    assert(baseAospTag.startsWith('android-'))
    assert(baseAospTag.includes('.0.0_r'))
    let baseAndroidVersion = baseAospTag.substring('android-'.length, baseAospTag.lastIndexOf('_'))

    let repoPatchesMap = new Map<string, string[]>()
    let cveInfo = new Map<string, string[]>() // severity -> CVE list

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
        return
      }
      let patchesDir = path.join(bulletinDir, 'patches')
      let repoShasMap = new Map<string, Set<string>>()
      for (let repoPatches of patches.projects) {
        let repo = assertDefined(repoPatches.repo)
        assert(!repoShasMap.has(repo))
        repoShasMap.set(repo, new Set(assertDefined(repoPatches.shas)))
        let patches = repoPatchesMap.get(repo)
        if (patches === undefined) {
          patches = []
          repoPatchesMap.set(repo, patches)
        }
        patches.push(...repoPatches.shas.map(sha => path.join(patchesDir, sha + '.patch')))
      }

      let bulletinFileName = patchIndexFileName.slice(0, -'-patches-index.json'.length) + '.json'
      let bulletin = JSON.parse(await readFile(path.join(bulletinDir, bulletinFileName))) as BulletinInfo

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
        for (let data of branches[0].projects) {
          let repo = assertDefined(data.repo)
          let shas = assertDefined(data.shas)
          let appliedPatches = assertDefined(repoShasMap.get(repo))
          assert(shas.find(sha => !appliedPatches.has(sha)) === undefined)
        }
        let severity = versionData.severity ?? 'Unknown'
        updateMultiMap(cveInfo, severity, cve)
      }
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
    let manualResolutionRequiredRepos: string[] = []

    for (let [repoName, patches] of repoPatchesMap) {
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
      await spawnGit(repoPath, ['fetch', '--quiet', 'aosp', 'tag', baseAospTag])

      await spawnGit(repoPath, ['checkout', '--quiet', 'FETCH_HEAD'])

      for (let patch of patches) {
        assert(await isFile(patch))
        let out = await spawnGit(repoPath, ['am', '--whitespace=nowarn', patch])
        assert(out.endsWith('\n'))
        console.log(out.slice(0, -1))
      }

      if (!forkedAospRepos.has(repoPath)) {
        if (spawnSync('git', ['-C', repoPath, 'diff', '--exit-code', 'HEAD', baseAospTag]).status !== 0) {
          patchedRepos.push({ path: repoPath, baseRevision: baseAospTag })
        } else {
          console.log(`${repoPath}: ${baseAospTag} is same as HEAD`)
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
          if (spawnSync('git', ['-C', repoPath, 'diff', '--exit-code', 'HEAD', baseRevision]).status !== 0) {
            patchedRepos.push({ path: repoPath, baseRevision })
          } else {
            console.log(`${baseRevision} is same as HEAD`)
          }
        } catch (e) {
          manualResolutionRequiredRepos.push(repoPath)
          console.log(e)
        }
      }
    }
    if (manualResolutionRequiredRepos.length > 0) {
      let orig = manualResolutionRequiredRepos
      for (;;) {
        console.log(
          '\nThe following repos have rebase conflicts:\n' +
            manualResolutionRequiredRepos.join('\n') +
            '\nComplete the rebase manually before proceeding.',
        )
        let proceed = await confirm({ message: 'Proceed?' })
        manualResolutionRequiredRepos = await filterAsync(
          manualResolutionRequiredRepos,
          async repoPath => !(await spawnGit(repoPath, ['status'])).includes('nothing to commit, working tree clean'),
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
      for (let repoPath of orig) {
        if (spawnSync('git', ['-C', repoPath, 'diff', '--exit-code', 'HEAD', baseRevision]).status !== 0) {
          patchedRepos.push({ path: repoPath, baseRevision })
        } else {
          console.log(`${repoPath}: ${baseRevision} is same as HEAD`)
        }
      }
    }

    await fs.mkdir(flags.outDir, { recursive: true })
    let outDir = await fs.realpath(flags.outDir)

    await Promise.all(
      patchedRepos.map(async e => {
        spawnGit(e.path, ['format-patch', '--output-directory', path.join(outDir, e.path), e.baseRevision])
      }),
    )

    await Promise.all(
      patchedRepos.map(async e => {
        spawnGit(e.path, ['checkout', '--quiet', e.baseRevision])
      }),
    )

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

    let cveInfoStr =
      Array.from(cveInfo.entries())
        .map(([severity, cves]) => {
          return severity + '\n' + cves.toSorted().join('\n')
        })
        .join('\n\n') + '\n'
    await fs.writeFile(path.join(outDir, 'cve-info.txt'), cveInfoStr)

    console.log('Written patches and apply.sh script to ' + outDir)
  }
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
