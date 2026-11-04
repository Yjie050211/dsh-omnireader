import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pathBreadcrumbs } from '../src/client/lib/util.js'

test('pathBreadcrumbs splits a Windows drive path into absolute segments', () => {
  const crumbs = pathBreadcrumbs('D:\\books\\sci-fi\\book.epub')
  assert.deepEqual(
    crumbs.map((crumb) => crumb.label),
    ['D:', 'books', 'sci-fi', 'book.epub'],
  )
  assert.deepEqual(
    crumbs.map((crumb) => crumb.path),
    ['D:\\', 'D:\\books', 'D:\\books\\sci-fi', 'D:\\books\\sci-fi\\book.epub'],
  )
})

test('pathBreadcrumbs normalises forward slashes and drive-letter case', () => {
  const crumbs = pathBreadcrumbs('c:/Users/x/')
  assert.deepEqual(
    crumbs.map((crumb) => crumb.label),
    ['C:', 'Users', 'x'],
  )
  assert.equal(crumbs[0].path, 'C:\\')
  assert.equal(crumbs.at(-1).path, 'C:\\Users\\x')
})

test('pathBreadcrumbs segments POSIX paths from the root', () => {
  const crumbs = pathBreadcrumbs('/home/reader/books/notes.md')
  assert.deepEqual(
    crumbs.map((crumb) => crumb.label),
    ['/', 'home', 'reader', 'books', 'notes.md'],
  )
  assert.deepEqual(
    crumbs.map((crumb) => crumb.path),
    ['/', '/home', '/home/reader', '/home/reader/books', '/home/reader/books/notes.md'],
  )
})

test('pathBreadcrumbs tolerates empty and relative values', () => {
  assert.deepEqual(pathBreadcrumbs(''), [])
  assert.deepEqual(pathBreadcrumbs(null), [])
  assert.deepEqual(
    pathBreadcrumbs('books/sci-fi').map((crumb) => crumb.label),
    ['/', 'books', 'sci-fi'],
  )
})
