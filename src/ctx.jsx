// App-wide context — mirrors the prototype's Ctx so ported component code
// (`const { t, f, route, go } = useApp()`) works near-verbatim. `t` (var-map)
// and `f` (Direction-B font roles) are static; theming is CSS-variable driven.
import { createContext, useContext, useEffect, useState } from 'react'

export const CourseCtx = createContext(null)
export function useApp() { return useContext(CourseCtx) }

// One breakpoint, matchMedia — drives the desktop/mobile split (900px to match
// the prototype's shell).
export function useIsMobile(bp = 900) {
  const q = `(max-width:${bp}px)`
  const read = () => typeof window !== 'undefined' && window.matchMedia(q).matches
  const [m, setM] = useState(read)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setM(read())
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}
