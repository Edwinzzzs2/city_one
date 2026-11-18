'use client'

import { useEffect } from 'react'

export default function StandaloneViewport() {
  useEffect(() => {
    const viewport = document.querySelector('meta[name="viewport"]')
    if (!viewport) return

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
    const isIOSHomeScreen = isStandalone && 'standalone' in window.navigator
    const original = viewport.content
    const directives = [original]
    // The initial viewport fits below the iOS Home Screen status bar, where the system draws its blur.
    if (!isIOSHomeScreen) directives.push('viewport-fit=cover')
    if (isStandalone) directives.push('maximum-scale=1', 'user-scalable=no')
    viewport.content = directives.join(', ')

    return () => {
      viewport.content = original
    }
  }, [])

  return null
}
