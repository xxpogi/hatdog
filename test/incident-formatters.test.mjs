import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { formatDuration, formatTimeAgo } from '../src/lib/incident-formatters.js'

describe('incident formatters', () => {
  let originalNow
  let OriginalDate

  before(() => {
    originalNow = Date.now
    OriginalDate = Date
    const fixedNow = new OriginalDate('2024-01-02T12:00:00Z')
    Date.now = () => fixedNow.getTime()
    globalThis.Date = class extends OriginalDate {
      constructor(...args) {
        if (args.length === 0) {
          return new OriginalDate(fixedNow.getTime())
        }
        return new OriginalDate(...args)
      }
    }
  })

  after(() => {
    Date.now = originalNow
    globalThis.Date = OriginalDate
  })

  it('formats durations with hours and minutes', () => {
    assert.equal(formatDuration(null), 'Ongoing')
    assert.equal(formatDuration(125), '2m')
    assert.equal(formatDuration(3665), '1h 1m')
  })

  it('formats relative time labels', () => {
    assert.equal(formatTimeAgo('2024-01-02T12:00:00Z'), 'Just now')
    assert.equal(formatTimeAgo('2024-01-02T11:55:00Z'), '5m ago')
    assert.equal(formatTimeAgo('2024-01-02T10:00:00Z'), '2h ago')
    assert.equal(formatTimeAgo('2023-12-30T12:00:00Z'), '3d ago')
  })
})
