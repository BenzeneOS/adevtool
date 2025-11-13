import assert from 'assert'
import child_process from 'child_process'

export async function spawnAsyncNoOut(
  command: string,
  args: ReadonlyArray<string>,
  isStderrLineAllowed?: (s: string) => boolean,
) {
  let stdout = await spawnAsync(command, args, isStderrLineAllowed)
  assert(stdout.length === 0, `unexpected stdout for ${command} ${args}: ${stdout}`)
}

export async function spawnAsyncStdin(
  command: string,
  args: ReadonlyArray<string>,
  stdinData: Buffer,
  isStderrLineAllowed?: (s: string) => boolean,
) {
  let stdout = await spawnAsync(command, args, isStderrLineAllowed, stdinData)
  return stdout
}

export async function spawnAsync(
  command: string,
  args: ReadonlyArray<string>,
  isStderrLineAllowed?: (s: string) => boolean,
  stdinData?: Buffer,
  allowedExitCodes: number[] = [0],
) {
  return (await spawnAsync2({ command, args, isStderrLineAllowed, stdinData, allowedExitCodes })).toString()
}

export interface SpawnCmd {
  command: string
  args: ReadonlyArray<string>
  isStderrLineAllowed?: (s: string) => boolean
  stdinData?: Buffer
  handleStdoutBuffer?: (buf: Buffer) => void
  allowedExitCodes?: number[]
}

// Returns stdout. If there's stderr output, all lines of it should pass the isStderrLineAllowed check
export async function spawnAsync2(cmd: SpawnCmd) {
  let proc = child_process.spawn(cmd.command, cmd.args)

  if (cmd.stdinData !== undefined) {
    proc.stdin.write(cmd.stdinData)
    proc.stdin.end()
  }

  let promise = new Promise((resolve, reject) => {
    let stdoutBufs: Buffer[] = []
    let stderrBufs: Buffer[] = []

    let handleStdoutBuffer =
      cmd.handleStdoutBuffer ??
      (buf => {
        stdoutBufs.push(buf)
      })

    proc.stdout.on('data', data => {
      handleStdoutBuffer(data)
    })
    proc.stderr.on('data', data => {
      stderrBufs.push(data)
    })

    proc.on('close', code => {
      let stderr = ''

      if (stderrBufs.length > 0) {
        stderr = Buffer.concat(stderrBufs).toString()
      }

      let allowedExitCodes = cmd.allowedExitCodes ?? [0]

      if (code !== null && allowedExitCodes.includes(code)) {
        if (stderr.length > 0) {
          if (cmd.isStderrLineAllowed === undefined) {
            reject(new Error('unexpected stderr ' + stderr))
          } else {
            for (let line of stderr.split('\n')) {
              if (line.length > 0 && !cmd.isStderrLineAllowed(line)) {
                reject(new Error('unexpected stderr line ' + line))
              }
            }
          }
        }
        resolve(Buffer.concat(stdoutBufs))
      } else {
        reject(new Error(proc.spawnargs + ' returned ' + code + (stderr.length > 0 ? ', stderr: ' + stderr : '')))
      }
    })
  })

  return promise as Promise<Buffer>
}

export function lastLine(buf: Buffer) {
  let str = buf.toString()
  let end = -1
  for (let i = buf.length - 1; i >= 0; --i) {
    if (str.charAt(i) !== '\n') {
      end = i + 1
      break
    }
  }
  let start = 0
  if (end > 0) {
    for (let i = end - 1; i >= 0; --i) {
      if (str.charAt(i) === '\n') {
        start = i + 1
        break
      }
    }
    return str.slice(start, end)
  }
  return ''
}
