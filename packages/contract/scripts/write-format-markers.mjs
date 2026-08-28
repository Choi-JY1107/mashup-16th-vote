// Node 와 번들러가 각 디렉터리의 모듈 형식을 알 수 있게 마커를 심는다.
// 이게 없으면 dist/esm 의 .js 가 CJS 로 해석돼 import 문에서 터진다.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

for (const [dir, type] of [
  ['dist/cjs', 'commonjs'],
  ['dist/esm', 'module'],
]) {
  const target = join(root, dir)
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'package.json'), JSON.stringify({ type }, null, 2) + '\n')
}
