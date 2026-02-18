/**
 * CustomCursor - Unified cursor component (high-performance version)
 *
 * ## Types
 * - dot: Solid circle (default)
 * - ring: Circle outline
 * - image: Image cursor (using preset names)
 * - default: System cursor, no custom cursor rendered
 *
 * ## Effects (optional for dot/ring, can combine)
 * - glow: Glow effect
 * - blendMode: Blend mode (difference/overlay)
 *
 * ## Default configuration
 * type="dot" color="#ffffff" blendMode="difference" (no glow)
 *
 * ## Usage
 * <CustomCursor />  // Default: white inverted dot
 * <CustomCursor type="dot" color="#d4a574" glow />
 * <CustomCursor type="ring" color="#ffffff" blendMode="difference" />
 * <CustomCursor type="image" name="shadow-pointer" />
 * <CustomCursor type="default" />  // Use system cursor
 *
 * ## Performance optimizations
 * - Uses CSS variables + ref for direct DOM manipulation, avoiding React re-renders
 * - Position updates don't trigger setState
 */

import { useEffect, useRef, useCallback } from 'react'
import { useLenis } from 'lenis/react'

// ============================================================================
// Image cursor presets
// ============================================================================

const IMAGE_PRESETS: Record<string, { src: string; hotspot: [number, number] }> = {
  'shadow-pointer': {
    src: '/cursors/shadow-pointer.svg',
    hotspot: [0, 0],
  },
  // Add more presets:
  // 'pixel-pointer': { src: '/cursors/pixel-pointer.svg', hotspot: [0, 0] },
  // 'glass-hand': { src: '/cursors/glass-hand.svg', hotspot: [10, 2] },
}

// ============================================================================
// Type definitions
// ============================================================================

export type CursorType = 'dot' | 'ring' | 'image' | 'default'
export type BlendMode = 'difference' | 'overlay'

export interface CustomCursorProps {
  /** Cursor type */
  type?: CursorType
  /** Color (dot/ring only) */
  color?: string
  /** Size (dot/ring only), default 16 */
  size?: number
  /** Glow effect (dot/ring only) */
  glow?: boolean
  /** Blend mode (dot/ring only) */
  blendMode?: BlendMode
  /** Image preset name (image only) */
  name?: string
}

// ============================================================================
// Main component
// ============================================================================

export function CustomCursor({
  type = 'dot',
  color = '#ffffff',
  size = 16,
  glow = false,
  blendMode = 'difference',
  name,
}: CustomCursorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dotRef = useRef<HTMLDivElement>(null)
  const lenis = useLenis()
  
  // Use ref to store state, avoiding re-renders
  const stateRef = useRef({
    isVisible: false,
    isHovering: false,
    isScrolling: false,
    hasInitialPosition: false, // Whether initial position has been captured
  })

  // Update cursor visibility
  const updateVisibility = useCallback(() => {
    const el = containerRef.current
    if (!el) return

    const { isVisible, isScrolling, hasInitialPosition } = stateRef.current

    // Always hide until initial position is captured
    if (!hasInitialPosition) {
      el.style.opacity = '0'
      return
    }
    
    if (!isVisible) {
      el.style.opacity = '0'
    } else if (isScrolling) {
      el.style.opacity = '0.3'
    } else {
      el.style.opacity = '1'
    }
  }, [])

  // Update hover state (dot/ring only)
  const updateHoverState = useCallback(() => {
    const dot = dotRef.current
    if (!dot || type === 'image') return
    
    const { isHovering } = stateRef.current
    const isRing = type === 'ring'
    const hoverScale = isRing ? 1.5 : 1.3
    const currentSize = isHovering ? size * hoverScale : size
    
    dot.style.width = `${currentSize}px`
    dot.style.height = `${currentSize}px`
    
    if (!blendMode) {
      dot.style.opacity = isHovering ? '0.7' : '1'
    }
  }, [type, size, blendMode])

  // Mouse movement tracking + window leave detection
  useEffect(() => {
    if (type === 'default') return

    const el = containerRef.current
    if (!el) return

    let hoverCheckTimeout: number

    const handleMouseMove = (e: MouseEvent) => {
      // Directly update CSS transform, no React re-render
      const preset = type === 'image' && name ? IMAGE_PRESETS[name] : null
      const offsetX = preset ? preset.hotspot[0] : 0
      const offsetY = preset ? preset.hotspot[1] : 0

      el.style.transform = `translate(${e.clientX - offsetX}px, ${e.clientY - offsetY}px)`

      // Mark initial position as captured
      if (!stateRef.current.hasInitialPosition) {
        stateRef.current.hasInitialPosition = true
      }
      
      stateRef.current.isVisible = true
      updateVisibility()

      // Hover detection runs async (dot/ring only)
      if (type !== 'image') {
        cancelAnimationFrame(hoverCheckTimeout)
        hoverCheckTimeout = requestAnimationFrame(() => {
          const target = e.target as HTMLElement
          const isInteractive = target.closest(
            'a, button, [role="button"], input, textarea, select, [data-cursor-hover]'
          )
          const newIsHovering = !!isInteractive
          if (stateRef.current.isHovering !== newIsHovering) {
            stateRef.current.isHovering = newIsHovering
            updateHoverState()
          }
        })
      }
    }

    const handleMouseLeave = () => {
      stateRef.current.isVisible = false
      stateRef.current.hasInitialPosition = false // Reset on leave, reposition on next entry
      updateVisibility()
    }

    // Listen for mouseenter to immediately update position on entry
    const handleMouseEnter = (e: MouseEvent) => {
      const preset = type === 'image' && name ? IMAGE_PRESETS[name] : null
      const offsetX = preset ? preset.hotspot[0] : 0
      const offsetY = preset ? preset.hotspot[1] : 0
      
      el.style.transform = `translate(${e.clientX - offsetX}px, ${e.clientY - offsetY}px)`
      stateRef.current.hasInitialPosition = true
      stateRef.current.isVisible = true
      updateVisibility()
    }

    window.addEventListener('mousemove', handleMouseMove, { passive: true })
    document.documentElement.addEventListener('mouseleave', handleMouseLeave)
    document.documentElement.addEventListener('mouseenter', handleMouseEnter)
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      document.documentElement.addEventListener('mouseleave', handleMouseLeave)
      document.documentElement.removeEventListener('mouseenter', handleMouseEnter)
      cancelAnimationFrame(hoverCheckTimeout)
    }
  }, [type, name, updateVisibility, updateHoverState])

  // Scroll state detection
  useEffect(() => {
    if (type === 'default' || !lenis) return

    let scrollTimeout: ReturnType<typeof setTimeout>

    const handleScroll = () => {
      stateRef.current.isScrolling = true
      updateVisibility()
      
      clearTimeout(scrollTimeout)
      scrollTimeout = setTimeout(() => {
        stateRef.current.isScrolling = false
        updateVisibility()
      }, 150)
    }

    lenis.on('scroll', handleScroll)
    return () => {
      lenis.off('scroll', handleScroll)
      clearTimeout(scrollTimeout)
    }
  }, [lenis, type, updateVisibility])

  // default type: render nothing
  if (type === 'default') return null

  // image type
  if (type === 'image') {
    const preset = name ? IMAGE_PRESETS[name] : null
    if (!preset) {
      console.warn(`CustomCursor: image preset "${name}" not found`)
      return null
    }

    return (
      <div
        ref={containerRef}
        className="pointer-events-none fixed top-0 left-0 z-[9999]"
        style={{
          opacity: 0, // Initially hidden, shown after mousemove
          willChange: 'transform, opacity',
          transition: 'opacity 100ms ease-out',
        }}
      >
        <img
          src={preset.src}
          alt=""
          className="block"
          style={{ width: 'auto', height: 'auto' }}
          draggable={false}
        />
      </div>
    )
  }

  // dot/ring type
  const isRing = type === 'ring'
  const baseSize = size

  // ========== Glow configuration (adjustable) ==========
  const glowSizeMultiplier = 4       // Glow size multiplier (relative to baseSize)
  const glowOpacity = '80'           // Glow center opacity (hex: 00-ff)
  const glowFadeEnd = 70             // Gradient fade end position (%)
  const glowBlur = 'blur-xl'         // Blur level: blur-sm/md/lg/xl/2xl
  // =====================================================
  const glowSize = baseSize * glowSizeMultiplier

  return (
    <div
      ref={containerRef}
      className="pointer-events-none fixed top-0 left-0 z-[9999]"
      style={{
        opacity: 0, // Initially hidden, shown after mousemove
        willChange: 'transform, opacity',
        transition: 'opacity 100ms ease-out',
        mixBlendMode: blendMode || undefined,
      }}
    >
      {/* Main body: solid circle or ring */}
      <div
        ref={dotRef}
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: `${baseSize}px`,
          height: `${baseSize}px`,
          transition: 'width 150ms ease-out, height 150ms ease-out, opacity 150ms ease-out',
          ...(isRing
            ? { border: `1.5px solid ${color}`, background: 'transparent' }
            : { background: color }),
        }}
      />

      {/* Glow effect (optional, independent of blend mode) */}
      {glow && (
        <div
          className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${glowBlur}`}
          style={{
            width: `${glowSize}px`,
            height: `${glowSize}px`,
            background: `radial-gradient(circle, ${color}${glowOpacity} 0%, transparent ${glowFadeEnd}%)`,
            mixBlendMode: 'normal',
          }}
        />
      )}
    </div>
  )
}

export default CustomCursor
