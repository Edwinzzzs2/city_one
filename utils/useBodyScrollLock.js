'use client'
import { useEffect } from 'react'

let lockCount = 0
let scrollY = 0
let previousBodyStyle = {}
let previousHtmlOverscroll = ''

export function useBodyScrollLock(locked) {
  useEffect(() => {
    if (!locked || typeof window === 'undefined') return

    lockCount += 1
    if (lockCount === 1) {
      scrollY = window.scrollY || document.documentElement.scrollTop || 0
      previousBodyStyle = {
        position: document.body.style.position,
        top: document.body.style.top,
        left: document.body.style.left,
        right: document.body.style.right,
        width: document.body.style.width,
        overflow: document.body.style.overflow,
      }
      previousHtmlOverscroll = document.documentElement.style.overscrollBehaviorY

      document.body.style.position = 'fixed'
      document.body.style.top = `-${scrollY}px`
      document.body.style.left = '0'
      document.body.style.right = '0'
      document.body.style.width = '100%'
      document.body.style.overflow = 'hidden'
      document.body.classList.add('is-scroll-locked')
      document.documentElement.style.overscrollBehaviorY = 'none'
    }

    return () => {
      lockCount = Math.max(0, lockCount - 1)
      if (lockCount !== 0) return

      Object.assign(document.body.style, previousBodyStyle)
      document.body.classList.remove('is-scroll-locked')
      document.documentElement.style.overscrollBehaviorY = previousHtmlOverscroll
      window.scrollTo(0, scrollY)
    }
  }, [locked])
}
