import { useEffect } from 'react'
import ReactDOM from 'react-dom'

const portalRoot = typeof window !== 'undefined' ? document.getElementById('portal-root') || (() => {
  const el = document.createElement('div')
  el.id = 'portal-root'
  document.body.appendChild(el)
  return el
})() : null

export default function Portal({ children }) {
  useEffect(() => {
    // Ensure portal root exists
    if (!portalRoot) return
    return () => {
      // Optionally clean up
    }
  }, [])
  if (!portalRoot) return null
  return ReactDOM.createPortal(children, portalRoot)
} 