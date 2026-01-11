/**
 * TikZ Arrow Tips - SVG marker definitions for arrow heads
 */

/**
 * Create SVG defs element containing all arrow markers
 */
export function createArrowDefs(color = "#000000", scale = 1) {
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs")

  const arrows = [
    createStandardArrow(color, scale),
    createStealthArrow(color, scale),
    createLatexArrow(color, scale),
    createToArrow(color, scale),
    createBarArrow(color, scale),
    createReversedArrow(color, scale),
    createDoubleArrow(color, scale)
  ]

  // Create both start and end versions
  for (const arrow of arrows) {
    // End marker
    defs.appendChild(arrow.end)
    // Start marker (rotated 180 degrees)
    defs.appendChild(arrow.start)
  }

  return defs
}

/**
 * Get marker URL for an arrow type
 */
export function getArrowMarker(type, isStart, color = "#000000") {
  const colorId = color.replace(/[^a-zA-Z0-9]/g, "")
  const suffix = isStart ? "-start" : "-end"

  const typeMap = {
    ">": "standard",
    "<": "standard",
    "stealth": "stealth",
    "latex": "latex",
    "to": "to",
    "|": "bar",
    ">>": "double",
    "<<": "double"
  }

  const arrowName = typeMap[type] || "standard"
  return `url(#arrow-${arrowName}${suffix}-${colorId})`
}

/**
 * Standard arrow (>)
 */
function createStandardArrow(color, scale) {
  const colorId = color.replace(/[^a-zA-Z0-9]/g, "")
  const size = 10 * scale

  const endMarker = document.createElementNS("http://www.w3.org/2000/svg", "marker")
  endMarker.setAttribute("id", `arrow-standard-end-${colorId}`)
  endMarker.setAttribute("viewBox", "0 0 10 10")
  endMarker.setAttribute("refX", "9")
  endMarker.setAttribute("refY", "5")
  endMarker.setAttribute("markerWidth", size)
  endMarker.setAttribute("markerHeight", size)
  endMarker.setAttribute("orient", "auto-start-reverse")
  endMarker.setAttribute("markerUnits", "userSpaceOnUse")

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
  path.setAttribute("d", "M 0 0 L 10 5 L 0 10 L 3 5 Z")
  path.setAttribute("fill", color)
  endMarker.appendChild(path)

  const startMarker = endMarker.cloneNode(true)
  startMarker.setAttribute("id", `arrow-standard-start-${colorId}`)
  startMarker.setAttribute("refX", "1")

  return { end: endMarker, start: startMarker }
}

/**
 * Stealth arrow (filled triangle)
 */
function createStealthArrow(color, scale) {
  const colorId = color.replace(/[^a-zA-Z0-9]/g, "")
  const size = 12 * scale

  const endMarker = document.createElementNS("http://www.w3.org/2000/svg", "marker")
  endMarker.setAttribute("id", `arrow-stealth-end-${colorId}`)
  endMarker.setAttribute("viewBox", "0 0 12 12")
  endMarker.setAttribute("refX", "11")
  endMarker.setAttribute("refY", "6")
  endMarker.setAttribute("markerWidth", size)
  endMarker.setAttribute("markerHeight", size)
  endMarker.setAttribute("orient", "auto-start-reverse")
  endMarker.setAttribute("markerUnits", "userSpaceOnUse")

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
  path.setAttribute("d", "M 0 0 L 12 6 L 0 12 L 4 6 Z")
  path.setAttribute("fill", color)
  endMarker.appendChild(path)

  const startMarker = endMarker.cloneNode(true)
  startMarker.setAttribute("id", `arrow-stealth-start-${colorId}`)
  startMarker.setAttribute("refX", "1")

  return { end: endMarker, start: startMarker }
}

/**
 * LaTeX arrow (curved)
 */
function createLatexArrow(color, scale) {
  const colorId = color.replace(/[^a-zA-Z0-9]/g, "")
  const size = 10 * scale

  const endMarker = document.createElementNS("http://www.w3.org/2000/svg", "marker")
  endMarker.setAttribute("id", `arrow-latex-end-${colorId}`)
  endMarker.setAttribute("viewBox", "0 0 10 10")
  endMarker.setAttribute("refX", "9")
  endMarker.setAttribute("refY", "5")
  endMarker.setAttribute("markerWidth", size)
  endMarker.setAttribute("markerHeight", size)
  endMarker.setAttribute("orient", "auto-start-reverse")
  endMarker.setAttribute("markerUnits", "userSpaceOnUse")

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
  path.setAttribute("d", "M 0 0 C 3 3, 3 5, 0 5 L 10 5 L 0 5 C 3 5, 3 7, 0 10 L 0 0 Z")
  path.setAttribute("fill", color)
  endMarker.appendChild(path)

  const startMarker = endMarker.cloneNode(true)
  startMarker.setAttribute("id", `arrow-latex-start-${colorId}`)
  startMarker.setAttribute("refX", "1")

  return { end: endMarker, start: startMarker }
}

/**
 * To arrow (simple open arrow)
 */
function createToArrow(color, scale) {
  const colorId = color.replace(/[^a-zA-Z0-9]/g, "")
  const size = 8 * scale

  const endMarker = document.createElementNS("http://www.w3.org/2000/svg", "marker")
  endMarker.setAttribute("id", `arrow-to-end-${colorId}`)
  endMarker.setAttribute("viewBox", "0 0 10 10")
  endMarker.setAttribute("refX", "8")
  endMarker.setAttribute("refY", "5")
  endMarker.setAttribute("markerWidth", size)
  endMarker.setAttribute("markerHeight", size)
  endMarker.setAttribute("orient", "auto-start-reverse")
  endMarker.setAttribute("markerUnits", "userSpaceOnUse")

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
  path.setAttribute("d", "M 0 0 L 10 5 L 0 10")
  path.setAttribute("fill", "none")
  path.setAttribute("stroke", color)
  path.setAttribute("stroke-width", "1.5")
  path.setAttribute("stroke-linecap", "round")
  path.setAttribute("stroke-linejoin", "round")
  endMarker.appendChild(path)

  const startMarker = endMarker.cloneNode(true)
  startMarker.setAttribute("id", `arrow-to-start-${colorId}`)
  startMarker.setAttribute("refX", "2")

  return { end: endMarker, start: startMarker }
}

/**
 * Bar arrow (|)
 */
function createBarArrow(color, scale) {
  const colorId = color.replace(/[^a-zA-Z0-9]/g, "")
  const size = 8 * scale

  const endMarker = document.createElementNS("http://www.w3.org/2000/svg", "marker")
  endMarker.setAttribute("id", `arrow-bar-end-${colorId}`)
  endMarker.setAttribute("viewBox", "0 0 10 10")
  endMarker.setAttribute("refX", "5")
  endMarker.setAttribute("refY", "5")
  endMarker.setAttribute("markerWidth", size)
  endMarker.setAttribute("markerHeight", size)
  endMarker.setAttribute("orient", "auto")
  endMarker.setAttribute("markerUnits", "userSpaceOnUse")

  const line = document.createElementNS("http://www.w3.org/2000/svg", "line")
  line.setAttribute("x1", "5")
  line.setAttribute("y1", "0")
  line.setAttribute("x2", "5")
  line.setAttribute("y2", "10")
  line.setAttribute("stroke", color)
  line.setAttribute("stroke-width", "2")
  endMarker.appendChild(line)

  const startMarker = endMarker.cloneNode(true)
  startMarker.setAttribute("id", `arrow-bar-start-${colorId}`)

  return { end: endMarker, start: startMarker }
}

/**
 * Reversed arrow (<)
 */
function createReversedArrow(color, scale) {
  const colorId = color.replace(/[^a-zA-Z0-9]/g, "")
  const size = 10 * scale

  const endMarker = document.createElementNS("http://www.w3.org/2000/svg", "marker")
  endMarker.setAttribute("id", `arrow-reversed-end-${colorId}`)
  endMarker.setAttribute("viewBox", "0 0 10 10")
  endMarker.setAttribute("refX", "1")
  endMarker.setAttribute("refY", "5")
  endMarker.setAttribute("markerWidth", size)
  endMarker.setAttribute("markerHeight", size)
  endMarker.setAttribute("orient", "auto-start-reverse")
  endMarker.setAttribute("markerUnits", "userSpaceOnUse")

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
  path.setAttribute("d", "M 10 0 L 0 5 L 10 10 L 7 5 Z")
  path.setAttribute("fill", color)
  endMarker.appendChild(path)

  const startMarker = endMarker.cloneNode(true)
  startMarker.setAttribute("id", `arrow-reversed-start-${colorId}`)
  startMarker.setAttribute("refX", "9")

  return { end: endMarker, start: startMarker }
}

/**
 * Double arrow (>>)
 */
function createDoubleArrow(color, scale) {
  const colorId = color.replace(/[^a-zA-Z0-9]/g, "")
  const size = 14 * scale

  const endMarker = document.createElementNS("http://www.w3.org/2000/svg", "marker")
  endMarker.setAttribute("id", `arrow-double-end-${colorId}`)
  endMarker.setAttribute("viewBox", "0 0 14 10")
  endMarker.setAttribute("refX", "13")
  endMarker.setAttribute("refY", "5")
  endMarker.setAttribute("markerWidth", size)
  endMarker.setAttribute("markerHeight", size)
  endMarker.setAttribute("orient", "auto-start-reverse")
  endMarker.setAttribute("markerUnits", "userSpaceOnUse")

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
  path.setAttribute("d", "M 0 0 L 7 5 L 0 10 L 2 5 Z M 6 0 L 13 5 L 6 10 L 8 5 Z")
  path.setAttribute("fill", color)
  endMarker.appendChild(path)

  const startMarker = endMarker.cloneNode(true)
  startMarker.setAttribute("id", `arrow-double-start-${colorId}`)
  startMarker.setAttribute("refX", "1")

  return { end: endMarker, start: startMarker }
}

/**
 * Update all arrow markers to use a specific color
 */
export function updateArrowColors(svg, color) {
  const defs = svg.querySelector("defs")
  if (!defs) return

  // Remove existing arrows and recreate with new color
  const markers = defs.querySelectorAll("marker")
  markers.forEach(marker => marker.remove())

  const newDefs = createArrowDefs(color)
  while (newDefs.firstChild) {
    defs.appendChild(newDefs.firstChild)
  }
}
