#!/usr/bin/env node
/**
 * Copies the canonical domain modules into the Cloud Functions package.
 *
 * The functions are a separate npm project and cannot import `../../shared`,
 * because `firebase deploy` uploads only the functions directory. Rather than
 * letting the two copies drift, everything in `shared/` is treated as the source
 * and this script mirrors it, failing loudly if a file is missing on either side.
 *
 * Usage:
 *   node scripts/sync-shared.mjs           # copy shared/*.ts → functions/src/shared/
 *   node scripts/sync-shared.mjs --check   # verify they are identical (CI/predeploy)
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'shared')
const target = join(root, 'functions', 'src', 'shared')
const checkOnly = process.argv.includes('--check')

mkdirSync(target, { recursive: true })

const files = readdirSync(source).filter((file) => file.endsWith('.ts'))
const drifted = []
let copied = 0

for (const file of files) {
  const from = join(source, file)
  const to = join(target, file)
  const same = existsSync(to) && readFileSync(from, 'utf8') === readFileSync(to, 'utf8')
  if (same) continue
  if (checkOnly) {
    drifted.push(file)
    continue
  }
  copyFileSync(from, to)
  copied += 1
  console.log(`synced shared/${file} → functions/src/shared/${file}`)
}

// Anything extra in the functions copy is stale by definition.
const extra = readdirSync(target).filter((file) => file.endsWith('.ts') && !files.includes(file))
if (extra.length) {
  if (checkOnly) drifted.push(...extra.map((file) => `${file} (stale copy)`))
  else extra.forEach((file) => console.warn(`warning: functions/src/shared/${file} has no counterpart in shared/`))
}

if (checkOnly && drifted.length) {
  console.error(`shared/ and functions/src/shared/ differ: ${drifted.join(', ')}`)
  console.error('Run `npm run sync:shared` and commit the result.')
  process.exit(1)
}

if (checkOnly) {
  console.log(`shared/ and functions/src/shared/ are in sync (${files.length} files)`)
} else {
  console.log(copied ? `Copied ${copied} file(s).` : 'Already in sync.')
}
