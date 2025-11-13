import { SmartBuffer } from 'smart-buffer'

export interface FastbootPack {
  readonly version: number
  readonly packVersion: string
  readonly slotType: number
  readonly totalEntries: number
  readonly totalSize: number

  readonly entries: FbpkEntry[]
}

export function parseFastbootPack(buffer: Buffer) {
  let b = SmartBuffer.fromBuffer(buffer)
  let magic = b.readString(4)
  if (magic !== 'FBPK') {
    throw new Error('unknown magic: ' + magic)
  }
  let version = u32(b)
  let res: FastbootPack
  switch (version) {
    case 1:
      res = parseFastbootPackV1(b)
      break
    case 2:
      res = parseFastbootPackV2(b)
      break
    default:
      throw new Error('unsupported version: ' + version)
  }
  return res
}

interface FastbootPackV2 extends FastbootPack {
  readonly headerSize: number
  readonly entryHeaderSize: number
  readonly platform: string
  readonly dataAlign: number
}

function parseFastbootPackV2(b: SmartBuffer) {
  // field names were copied from https://source.android.com/static/docs/core/architecture/bootloader/tools/pixel/fw_unpack/fbpack.py
  let fp = {
    version: 2,
    headerSize: u32(b),
    entryHeaderSize: u32(b),
    platform: str(b, 16),
    packVersion: str(b, 64),
    slotType: u32(b),
    dataAlign: u32(b),
    totalEntries: u32(b),
    totalSize: u32(b),
    entries: [],
  } as FastbootPackV2

  if (fp.totalSize !== b.length) {
    throw new Error(`totalSize mismatch: expected ${b.length}, got ${fp.totalSize}`)
  }

  if (fp.headerSize !== b.readOffset) {
    throw new Error(`headerSize mismatch: expected ${b.readOffset}, got ${fp.headerSize}`)
  }

  for (let i = 0; i < fp.totalEntries; ++i) {
    let off = b.readOffset
    fp.entries.push(parseFbpkEntryV2(b))
    let entryHeaderSize = b.readOffset - off
    if (entryHeaderSize !== fp.entryHeaderSize) {
      throw new Error(`entryHeaderSize mismatch: expected ${fp.entryHeaderSize}, got ${entryHeaderSize}`)
    }
  }
  return fp
}

interface FastbootPackV1 extends FastbootPack {}

function parseFastbootPackV1(b: SmartBuffer) {
  let fp = {
    version: 1,
    packVersion: str(b, 64),
    slotType: u32(b),
    totalEntries: u32(b),
    totalSize: u32(b),
    entries: [],
  } as FastbootPackV1

  if (fp.totalSize !== b.length) {
    throw new Error(`totalSize mismatch: expected ${b.length}, got ${fp.totalSize}`)
  }

  for (let i = 0; i < fp.totalEntries; ++i) {
    let e = parseFbpkEntryV1(b)
    fp.entries.push(e)
    if (e.nextEntryHeader < b.length) {
      b.readOffset = e.nextEntryHeader
    } else {
      if (i !== fp.totalEntries - 1) {
        throw new Error(`unexpected next offset: ${e.nextEntryHeader}, packSize: ${b.length},
            entryIdx: ${i}, totalEntries: ${fp.totalEntries}`)
      }
    }
  }
  return fp
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export enum EntryType {
  PartitionTable = 0,
  PartitionData = 1,
  SideloadData = 2,
}

interface FbpkEntry {
  readonly type: number
  readonly name: string
  readonly size: number
  // 0 if absent. Some partitions don't verify against this value, not clear why. They are exactly
  // the same as partitions in OTA images. Perhaps they use a different checksum.
  readonly maybeCrc32: number

  readContents: (packBuf: Buffer) => Buffer
}

interface FbpkEntryV2 extends FbpkEntry {
  readonly product: string
  readonly offset: number
  readonly slotted: number
}

function parseFbpkEntryV2(b: SmartBuffer) {
  // field names copied from https://source.android.com/static/docs/core/architecture/bootloader/tools/pixel/fw_unpack/fbpack.py
  let e = {
    type: u32(b),
    name: str(b, 36),
    product: str(b, 40),
    offset: u64(b),
    size: u64(b),
    slotted: u32(b),
    maybeCrc32: u32(b),
  } as FbpkEntryV2

  e.readContents = (packBuf: Buffer) => {
    return packBuf.subarray(e.offset, e.offset + e.size)
  }

  return e
}

interface FbpkEntryV1 extends FbpkEntry {
  readonly start: number
  readonly nextEntryHeader: number
  readonly unknown1: number
  readonly unknown2: number
}

function parseFbpkEntryV1(b: SmartBuffer) {
  let e = {
    type: u32(b),
    name: str(b, 32),
    unknown1: u32(b),
    size: u32(b),
    unknown2: u32(b),
    nextEntryHeader: u32(b),
    maybeCrc32: u32(b),
    start: b.readOffset,
  } as FbpkEntryV1

  if (e.unknown1 !== 0) {
    throw new Error('unexpected value of unknown1 ' + e.unknown1)
  }
  if (e.unknown2 !== 0) {
    throw new Error('unexpected value of unknown2: ' + e.unknown2)
  }

  e.readContents = (packBuf: Buffer) => {
    return packBuf.subarray(e.start, e.start + e.size)
  }

  return e
}

function u32(b: SmartBuffer) {
  return b.readUInt32LE()
}

function u64(b: SmartBuffer) {
  let bigUint = b.readBigUInt64LE()
  if (bigUint > Number.MAX_SAFE_INTEGER) {
    throw new Error('bigUint is outside the bounds of safe integer: ' + bigUint)
  }
  return Number(bigUint)
}

function str(b: SmartBuffer, maxLen: number) {
  let s = b.readString(maxLen)
  let end = s.indexOf('\0')
  if (end >= 0) {
    return s.substring(0, end)
  }
  return s
}
