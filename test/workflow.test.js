import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('CI actions are pinned to immutable commits', async () => {
  const workflow = await readFile(new URL('../.github/workflows/verify.yml', import.meta.url), 'utf8')
  const actionReferences = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)].map((match) => match[1])

  assert.ok(actionReferences.length > 0)
  for (const reference of actionReferences) {
    assert.match(reference, /@[0-9a-f]{40}$/)
  }
})
