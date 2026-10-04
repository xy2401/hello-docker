import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const root = fileURLToPath(new URL('../', import.meta.url))
const tool = path.resolve(process.env.HELLO_DOCKER_HOME || path.join(root, '../hello-docker'))
const command = process.argv[2] || 'plan'
if (!['plan', 'check-manifest'].includes(command)) throw new Error('Local pilot only supports plan/check-manifest; execution runs in Actions')
const cli = path.join(tool, 'bin/hello-docker.mjs')
if (!fs.existsSync(cli)) throw new Error('hello-docker CLI is missing. Check out hello-docker next to this project or set HELLO_DOCKER_HOME to its absolute directory.')
const result = spawnSync(process.execPath, [cli, command, '--root', root, '--manifest', '__MANIFEST__', ...process.argv.slice(3)], { stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
