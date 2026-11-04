import assert from 'node:assert/strict'
import test from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { writeFileSync, unlinkSync } from 'node:fs'

import { JSDOM } from 'jsdom'
import esbuild from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = join(here, '.tmp-dom-entry.cjs')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Minimal stand-in for the client Context surface used by entry.jsx. */
function fakeContext() {
  const registry = new Map()
  const effects = []
  const slotRegistrations = []
  const injectedSlots = []
  const ctx = {
    get(name) {
      return registry.get(name)
    },
    effect(fn) {
      const dispose = fn()
      effects.push(dispose)
      return dispose
    },
    slots: {
      inject(slot, callback) {
        injectedSlots.push(slot)
        return callback()
      },
      register(meta) {
        slotRegistrations.push(meta)
        return () => {}
      },
    },
    locale: {
      register() {
        return () => {}
      },
      bind() {
        return (key) => key
      },
    },
  }
  return { ctx, registry, effects, slotRegistrations, injectedSlots }
}

test('apply survives a boot order where documentPreviews is not ready yet', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
  const requests = []
  globalThis.fetch = async (url) => {
    requests.push(String(url))
    return { ok: true, json: async () => ({ ok: true }) }
  }

  const result = esbuild.buildSync({
    stdin: {
      contents: "export { apply } from '../src/client/entry.jsx'",
      resolveDir: here,
      sourcefile: 'dom-entry.js',
      loader: 'js',
    },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    jsx: 'automatic',
    external: ['pdfjs-dist/build/pdf.min.mjs'],
    define: {
      'process.env.NODE_ENV': '"development"',
      __OMNIREADER_AUDIT__: '""',
    },
    logLevel: 'silent',
  })
  writeFileSync(bundlePath, result.outputFiles[0].text)
  const module = await import(pathToFileURL(bundlePath).href)
  const apply = module.apply ?? (module.default && module.default.apply)

  const { ctx, registry, slotRegistrations, injectedSlots } = fakeContext()
  try {
    // 1. Boot: the document preview plugin has not provided its registry yet.
    apply(ctx)
    await sleep(150)
    assert.equal(registry.has('documentPreviews'), false)
    assert.ok(slotRegistrations.some((meta) => meta.name === 'sidebar.panellist' && meta.id === 'omnireader'))
    assert.ok(injectedSlots.includes('sidebar.right.tab.document.actions'))
    // The ebook preview body must not be registered while the registry is absent.
    assert.equal(injectedSlots.includes('sidebar.right.tab.document'), false)

    // 2. The registry plugin finishes booting; the poll must pick it up and
    //    register both the definition and the preview body.
    const definitions = []
    registry.set('documentPreviews', {
      register(definition) {
        definitions.push(definition)
        return () => {}
      },
    })
    await sleep(600)
    assert.equal(definitions.length, 1, 'expected exactly one ebook preview definition')
    assert.deepEqual(definitions[0].extensions, ['epub', 'mobi', 'azw', 'azw3', 'kf8', 'prc'])
    assert.equal(definitions[0].loading, 'bytes-complete')
    assert.ok(injectedSlots.includes('sidebar.right.tab.document'))

    // 3. Diagnostics were attempted (proof the client half reported to the host).
    assert.ok(requests.some((url) => url.includes('api/omnireader/diag')))
  } finally {
    dom.window.close()
    try {
      unlinkSync(bundlePath)
    } catch {
      // Best-effort cleanup.
    }
  }
})
