import assert from 'node:assert/strict'
import test from 'node:test'

import { decompressPalmDoc } from '../src/client/formats/mobi.js'

const decode = (bytes) => Buffer.from(decompressPalmDoc(Uint8Array.from(bytes))).toString('latin1')

test('PalmDOC literals pass through unchanged', () => {
  assert.equal(decode([0x41, 0x42, 0x43]), 'ABC')
  assert.equal(decode([0x00]), '\u0000')
  assert.equal(decode([0x01, 0x5a]), 'Z', '1..8 repeats the next N literal bytes')
  assert.equal(decode([0x03, 0x6f, 0x6d, 0x6e]), 'omn')
})

test('PalmDOC space compression expands to a space plus the xor-ed byte', () => {
  // 0xc3 => 0x20 || (0xc3 ^ 0x80) = ' ' + 'C'
  assert.equal(decode([0xc3]), ' C')
  assert.equal(decode([0x41, 0xe9]), 'A i', '0xc0..0xff yields a space plus the low seven bits')
})

test('PalmDOC back references copy from already decoded output', () => {
  // distance 2, length 3 => pair = (2 << 3) | 0 = 0x10, high byte 0x80
  assert.equal(decode([0x41, 0x42, 0x80, 0x10]), 'ABABA')
  // distance 1, length 4 => pair = (1 << 3) | 1 = 0x09
  assert.equal(decode([0x5a, 0x80, 0x09]), 'ZZZZZ')
})

test('PalmDOC tolerates a dangling back reference instead of looping', () => {
  const output = decompressPalmDoc(Uint8Array.from([0x41, 0x80]))
  assert.equal(Buffer.from(output).toString('latin1'), 'A')
})
