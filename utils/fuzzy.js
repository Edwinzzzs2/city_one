export function fuzzyMatch(text, query) {
  if (!query) return true
  if (!text) return false
  const t = String(text).toLowerCase()
  const q = String(query).toLowerCase()
  if (t.includes(q)) return true
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

export function renderHighlight(text, query, React) {
  if (!query || !text) return String(text || '')
  const str = String(text)
  const lc = str.toLowerCase()
  const idx = lc.indexOf(query.toLowerCase())
  if (idx === -1) return str
  return [
    str.slice(0, idx),
    React.createElement('mark', {
      key: 'h',
      style: {
        background: 'color-mix(in srgb,var(--color-primary) 18%,transparent)',
        color: 'var(--color-primary-light)',
        borderRadius: 3,
        padding: '0 2px',
        fontWeight: 700,
      }
    }, str.slice(idx, idx + query.length)),
    str.slice(idx + query.length),
  ]
}

export function fuzzyFilter(rows, query, fields = ['address','city','province','district','industry','name','company']) {
  if (!query) return rows
  return rows.filter(row => fields.some(f => fuzzyMatch(row[f], query)))
}
