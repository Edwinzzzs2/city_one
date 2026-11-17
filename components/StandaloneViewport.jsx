'use client'

import { useEffect } from 'react'

export default function StandaloneViewport() {
  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
    if (!isStandalone) return

    const viewport = document.querySelector('meta[name="viewport"]')
    if (!viewport) return

    const original = viewport.content
    viewport.content = `${original}, maximum-scale=1, user-scalable=no`

    return () => {
      viewport.content = original
    }
  }, [])

  return null
}
