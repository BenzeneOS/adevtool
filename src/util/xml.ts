import assert from 'assert'
import { XMLBuilder, XMLParser } from 'fast-xml-parser'
import { promises as fs } from 'fs'
import path from 'path'
import { assertDefined } from './data'
import { EntryFilter2Spec, filterEntries2 } from './exact-filter'

const xmlParser = new XMLParser({
  preserveOrder: true,
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreAttributes: false,
})

export function getRootElementChildrenAsStrings(
  xmlString: string | Buffer,
  allowedRootElementNames: string[],
  prettyPrint: boolean = true,
): string[] {
  let entries = getRootChildren(xmlString, allowedRootElementNames).rootChildren
  return entries.map(e => stringifyXml([e], prettyPrint))
}

export interface ParsedXml {
  rootNodeAttrs: Record<string, string>
  rootName: string
  rootChildren: unknown[]
}

export function getRootChildren(xmlString: string | Buffer, allowedRootElementNames: string[]): ParsedXml {
  let xml = xmlParser.parse(xmlString)
  let rootNode: Record<string, object> | null = null
  for (let node of xml) {
    let keys = Object.keys(node)
    let name = keys[0]
    if (name === '?xml') {
      continue
    }
    if (allowedRootElementNames.includes(name)) {
      assert(rootNode === null)
      rootNode = node as Record<string, object>
    } else {
      throw new Error('unexpected root element: ' + name)
    }
  }

  assert(rootNode !== null)
  let rootName = Object.keys(rootNode)[0]

  return {
    rootNodeAttrs: rootNode[':@'] ?? {},
    rootName,
    rootChildren: Object.values(rootNode[rootName]),
  } as ParsedXml
}

export function stringifyXml(obj: unknown, prettyPrint: boolean = true) {
  let xmlB = new XMLBuilder({
    preserveOrder: true,
    ignoreAttributes: false,
    suppressEmptyNode: true,
    format: prettyPrint,
  })
  let res = xmlB.build(obj)
  if (res.length > 0) {
    assert(res.charAt(0) === '\n')
    return res.slice(1)
  }
  return res
}

export function formatXml(obj: object, format: boolean) {
  let xmlB = new XMLBuilder({
    preserveOrder: true,
    ignoreAttributes: false,
    suppressEmptyNode: true,
    format,
  })

  let s = xmlB.build(obj)
  if (s.length === 0) {
    return s
  }
  assert(s.charAt(0) == '\n')
  return s.slice(1)
}

export interface ProcessXmlCmd {
  xmlFilePath: string
  allowedRootElementNames: string[]
  dstDirPath: string
  dstFileName: string

  dstRootElementName?: string
  dstFileHeader?: string
  rootElementPrefilter?: (el: Record<string, unknown>) => boolean
  rootElementAttrs?: Map<string, string>
  split?: (elements: unknown[]) => { fileName: string; elements: unknown[] }[]

  filterSpec: EntryFilter2Spec<Record<string, unknown>>
}

export async function processXml(cmd: ProcessXmlCmd) {
  let srcFileContents = await fs.readFile(cmd.xmlFilePath)

  let { rootNodeAttrs, rootName, rootChildren } = getRootChildren(srcFileContents, cmd.allowedRootElementNames)

  let rootElementPrefilter = cmd.rootElementPrefilter
  let isPrefiltered = false
  if (rootElementPrefilter !== undefined) {
    let orig = rootChildren
    rootChildren = orig.filter(entry => rootElementPrefilter(entry as Record<string, unknown>))
    isPrefiltered = orig.length !== rootChildren.length
  }

  let entries = new Map<string, Record<string, unknown>>(
    rootChildren.map(entry => [formatXml([entry], true), entry as Record<string, unknown>]),
  )

  let filterRes = filterEntries2({
    entries: entries.entries(),
    ...cmd.filterSpec,
  })

  if (filterRes.entries.length === 0) {
    return []
  }

  await fs.mkdir(cmd.dstDirPath, { recursive: true })

  let dstFileContents: string | Buffer

  if (
    !isPrefiltered &&
    !filterRes.hasTransforms &&
    entries.size === filterRes.entries.length &&
    cmd.split === undefined
  ) {
    dstFileContents = srcFileContents
  } else {
    let header = cmd.dstFileHeader ?? '<?xml version="1.0" encoding="utf-8" ?>\n'
    let rootElementName = cmd.dstRootElementName ?? rootName
    let rootChildren = filterRes.entries.map(([, e]) => e)

    if (cmd.split !== undefined) {
      assert(cmd.dstFileName.length === 0)
      let parts = cmd.split(rootChildren)
      let written: string[] = []
      let promises = parts.map(async part => {
        if (part.elements.length === 0) {
          return
        }
        let rootElement = prepareRootElement(cmd, rootNodeAttrs)

        rootElement[rootElementName] = part.elements
        let fileContents = header + formatXml([rootElement], true)
        let dstPath = path.join(cmd.dstDirPath, part.fileName)
        await fs.writeFile(dstPath, fileContents)
        written.push(dstPath)
      })
      await Promise.all(promises)
      return written
    }

    let rootElement: Record<string, unknown> = prepareRootElement(cmd, rootNodeAttrs)
    rootElement[rootElementName] = rootChildren
    dstFileContents = header + formatXml([rootElement], true)
  }
  let dstFilePath = path.join(cmd.dstDirPath, cmd.dstFileName)
  await fs.writeFile(dstFilePath, dstFileContents)
  return [dstFilePath]
}

function prepareRootElement(cmd: ProcessXmlCmd, origAttrs: Record<string, string>) {
  let res: Record<string, unknown> = {}
  let attrsObj: Record<string, string> = { ...origAttrs }
  if (cmd.rootElementAttrs !== undefined) {
    for (let [name, value] of cmd.rootElementAttrs.entries()) {
      attrsObj['@_' + name] = value
    }
  }
  res[':@'] = attrsObj
  return res
}

export function getXmlProp(obj: unknown, name: string) {
  return (obj as Record<string, unknown | undefined>)[name]
}

export function getXmlText(e: unknown): string {
  return assertDefined(getXmlProp((e as unknown[])[0], '#text')) as string
}
