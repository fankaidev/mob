/**
 * Icon Opacity Utilities
 * 
 * Handles extraction of opacity values from Tailwind className strings
 * to prevent SVG path overlap color stacking issues.
 */

/**
 * Extract opacity from className like "text-primary/70"
 * 
 * This prevents SVG path overlap issues where semi-transparent colors
 * stack and become darker in overlapping areas.
 * 
 * @param className - The original className string
 * @returns Object with cleaned className and extracted opacity class
 * 
 * @example
 * extractOpacity("text-primary/70 size-4")
 * // Returns: { className: "text-primary size-4", opacity: "opacity-70" }
 * 
 * extractOpacity("text-primary")
 * // Returns: { className: "text-primary", opacity: null }
 */
export function extractOpacity(className?: string): { className: string; opacity: string | null } {
  if (!className) return { className: '', opacity: null }
  
  // Only match color-related classes: text-*, bg-*, border-*, fill-*, stroke-*, ring-*, etc.
  // Avoid matching layout classes like top-1/2, w-1/2, -translate-y-1/2
  const opacityRegex = /\b((?:text|bg|border|fill|stroke|ring|outline|decoration|accent|caret|shadow)-\S+)\/(\d+)/g
  let opacity: string | null = null
  
  const cleanClassName = className.replace(opacityRegex, (match, colorClass, opacityValue) => {
    // Convert opacity value to tailwind opacity class
    opacity = `opacity-${opacityValue}`
    // Return the color class without the /number part
    return colorClass
  })
  
  return { className: cleanClassName, opacity }
}

