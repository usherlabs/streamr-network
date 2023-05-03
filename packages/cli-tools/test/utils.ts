import merge2 from 'merge2'
import { StreamrClient, CONFIG_TEST } from 'streamr-client'
import { spawn } from 'child_process'

export const DOCKER_DEV_STORAGE_NODE = '0xde1112f631486CfC759A50196853011528bC5FA0'

export interface StartCommandOptions {
    privateKey?: string
    devEnvironment?: boolean
    inputLines?: string[]
    abortSignal?: AbortSignal
}

export const runCommand = async (commandLine: string, opts?: StartCommandOptions): Promise<string[]> => {
    const lines = startCommand(commandLine, opts)
    return await collect(lines)
}

export async function* startCommand(commandLine: string, opts?: StartCommandOptions): AsyncGenerator<string> {
    const args: string[] = ['dist/bin/streamr.js']
    args.push(...commandLine.split(' '))
    if (opts?.privateKey !== undefined) {
        args.push('--private-key', opts.privateKey)
    }
    if (opts?.devEnvironment !== false) {
        args.push('--dev')
    }
    const executable = spawn(`node`, args, {
        signal: opts?.abortSignal,
        env: {
            PATH: process.env.PATH
        }
    })
    executable.on('error', (err: any) => {
        // expected error when AbortSignal#abort is called
        if (err.code !== 'ABORT_ERR') {
            console.error(err)
        }
    })
    const outputs = merge2(executable.stdout, executable.stderr)
    if (opts?.inputLines !== undefined) {
        setImmediate(() => {
            executable.stdin.write(opts.inputLines!.join('\n') + '\n')
        })
    }
    yield* lines(outputs[Symbol.asyncIterator]())
}

async function* lines(src: AsyncIterable<Buffer>): AsyncGenerator<string, any, any> {
    let buffer = ''
    for await (const chunk of src) {
        buffer += chunk.toString('utf-8')
        while (true) {
            const delimeterPos = buffer.indexOf('\n')
            if (delimeterPos === -1) {
                break
            }
            const line = buffer.substring(0, delimeterPos)
            yield line
            buffer = buffer.substring(delimeterPos + 1)
        }
    }
    if (buffer !== '') {
        yield buffer
    }
}

export const collect = async <T>(source: AsyncIterable<T>, maxCount?: number): Promise<T[]> => {
    const items: T[] = []
    for await (const item of source) {
        items.push(item)
        if ((maxCount !== undefined) && (items.length >= maxCount)) {
            break
        }
    }
    return items
}

export const createTestClient = (privateKey?: string): StreamrClient => {
    return new StreamrClient({
        ...CONFIG_TEST,
        auth: (privateKey !== undefined) ? { privateKey } : undefined
    })
}
