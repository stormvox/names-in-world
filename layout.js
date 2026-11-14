// A citizen's place depends only on their number, so a new follower never moves anyone who joined earlier.
export const LIGHTHOUSE_R = 4.5, STEP = 1.7, GOLDEN = Math.PI * (3 - Math.sqrt(5)), NAME_MAX = 30

export function place(n) {
  const r = LIGHTHOUSE_R + STEP * Math.sqrt(n - 1), a = (n - 1) * GOLDEN
  return { x: r * Math.cos(a), z: r * Math.sin(a), r, a }
}

// Invisible and direction-changing characters can disguise a name; a very long one breaks the tag.
export function displayName(name) {
  const chars = [...name.normalize('NFC').replace(/[​-‏‪-‮⁠-⁩﻿]/g, '').trim()]
  return chars.length > NAME_MAX ? chars.slice(0, NAME_MAX - 1).join('') + '…' : chars.join('')
}

// Trust boundary: the roster will come from an export, so a gap or duplicate must stop the render.
export function validateRoster(list) {
  const seen = new Set()
  list.forEach((c, i) => {
    if (c.n !== i + 1) throw new Error(`roster: expected number ${i + 1}, got ${c.n}`)
    if (typeof c.name !== 'string' || !displayName(c.name)) throw new Error(`roster: #${c.n} has no name`)
    if (seen.has(c.name)) throw new Error(`roster: duplicate name ${c.name}`)
    seen.add(c.name)
  })
  return list
}
