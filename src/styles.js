/**
 * TikZ Style System - Handles colors, line styles, and other visual properties
 */

// TikZ named colors
export const COLORS = {
  // Basic colors
  red: "#ff0000",
  green: "#00ff00",
  blue: "#0000ff",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  yellow: "#ffff00",
  black: "#000000",
  white: "#ffffff",
  gray: "#808080",
  grey: "#808080",

  // Extended colors
  darkgray: "#404040",
  darkgrey: "#404040",
  lightgray: "#c0c0c0",
  lightgrey: "#c0c0c0",
  brown: "#bf8040",
  lime: "#bfff00",
  olive: "#808000",
  orange: "#ff8000",
  pink: "#ffbfbf",
  purple: "#bf0040",
  teal: "#008080",
  violet: "#800080",

  // xcolor extras
  "red!50": "#ff8080",
  "blue!50": "#8080ff",
  "green!50": "#80ff80",
  "red!25": "#ffbfbf",
  "blue!25": "#bfbfff",
  "green!25": "#bfffbf",
  "red!75": "#ff4040",
  "blue!75": "#4040ff",
  "green!75": "#40ff40"
}

// Line width presets (in pixels at scale 1)
export const LINE_WIDTHS = {
  "ultra thin": 0.1,
  "very thin": 0.2,
  "thin": 0.4,
  "semithick": 0.6,
  "thick": 0.8,
  "very thick": 1.2,
  "ultra thick": 1.6
}

// Dash patterns (dash length, gap length)
export const DASH_PATTERNS = {
  solid: null,
  dashed: [5, 5],
  dotted: [1, 3],
  "densely dashed": [3, 2],
  "loosely dashed": [5, 8],
  "densely dotted": [1, 2],
  "loosely dotted": [1, 5],
  "dash dot": [5, 3, 1, 3],
  "dash dot dot": [5, 3, 1, 3, 1, 3]
}

/**
 * Parse a color value
 */
export function parseColor(value) {
  if (!value) return null

  const trimmed = value.trim().toLowerCase()

  // Check named colors
  if (COLORS[trimmed]) {
    return COLORS[trimmed]
  }

  // Check for color mixing syntax: color1!percentage!color2
  // or simpler: color!percentage (mixed with white)
  const mixMatch = trimmed.match(/^([a-z]+)!(\d+)(?:!([a-z]+))?$/)
  if (mixMatch) {
    const color1 = COLORS[mixMatch[1]] || "#000000"
    const percentage = parseInt(mixMatch[2]) / 100
    const color2 = mixMatch[3] ? (COLORS[mixMatch[3]] || "#ffffff") : "#ffffff"
    return mixColors(color1, color2, percentage)
  }

  // Check for RGB format: rgb(r,g,b) or {rgb,255:red,X;green,Y;blue,Z}
  const rgbMatch = trimmed.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/)
  if (rgbMatch) {
    const r = Math.min(255, parseInt(rgbMatch[1]))
    const g = Math.min(255, parseInt(rgbMatch[2]))
    const b = Math.min(255, parseInt(rgbMatch[3]))
    return `rgb(${r}, ${g}, ${b})`
  }

  // Check for hex format
  if (trimmed.startsWith("#")) {
    return trimmed
  }

  // Return as-is (might be a CSS color name)
  return value
}

/**
 * Mix two colors
 */
function mixColors(color1, color2, ratio) {
  const c1 = hexToRgb(color1)
  const c2 = hexToRgb(color2)

  const r = Math.round(c1.r * ratio + c2.r * (1 - ratio))
  const g = Math.round(c1.g * ratio + c2.g * (1 - ratio))
  const b = Math.round(c1.b * ratio + c2.b * (1 - ratio))

  return `rgb(${r}, ${g}, ${b})`
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 }
}

/**
 * Parse line width value
 */
export function parseLineWidth(value, scale = 1) {
  if (typeof value === "number") {
    return value * scale
  }

  const trimmed = value.trim().toLowerCase()

  // Check presets
  if (LINE_WIDTHS[trimmed] !== undefined) {
    return LINE_WIDTHS[trimmed] * scale
  }

  // Parse numeric value with optional unit
  const numMatch = trimmed.match(/^(-?\d+\.?\d*)(pt|px|mm|cm|em)?$/)
  if (numMatch) {
    let num = parseFloat(numMatch[1])
    const unit = numMatch[2] || "pt"

    // Convert to pixels (approximate)
    switch (unit) {
      case "pt":
        num *= 1.333
        break
      case "mm":
        num *= 3.78
        break
      case "cm":
        num *= 37.8
        break
      case "em":
        num *= 16
        break
      // px is default, no conversion
    }

    return num * scale
  }

  return 1 * scale // Default
}

/**
 * Parse dash pattern
 */
export function parseDashPattern(value, scale = 1) {
  if (!value) return null

  const trimmed = value.trim().toLowerCase()

  // Check presets
  if (DASH_PATTERNS[trimmed]) {
    const pattern = DASH_PATTERNS[trimmed]
    return pattern ? pattern.map(v => v * scale) : null
  }

  // Parse custom pattern: on Xpt off Ypt
  const customMatch = trimmed.match(/on\s+(\d+\.?\d*)(?:pt)?\s+off\s+(\d+\.?\d*)(?:pt)?/)
  if (customMatch) {
    return [
      parseFloat(customMatch[1]) * scale,
      parseFloat(customMatch[2]) * scale
    ]
  }

  return null
}

/**
 * Style class to hold all visual properties
 */
export class Style {
  constructor() {
    this.stroke = "#000000"
    this.fill = "none"
    this.lineWidth = 0.4
    this.dashPattern = null
    this.opacity = 1
    this.fillOpacity = 1
    this.strokeOpacity = 1
    this.lineCap = "butt"      // butt, round, square
    this.lineJoin = "miter"    // miter, round, bevel
    this.roundedCorners = 0
    this.arrowStart = null
    this.arrowEnd = null
    this.transformations = []
    this.decorate = false
    this.decoration = null     // { type: "snake", amplitude: 0.5, segment: 5 }
  }

  clone() {
    const style = new Style()
    Object.assign(style, this)
    style.dashPattern = this.dashPattern ? [...this.dashPattern] : null
    style.transformations = [...this.transformations]
    style.decoration = this.decoration ? { ...this.decoration } : null
    return style
  }
}

/**
 * Parse options array into a Style object
 */
export function parseOptions(options, baseStyle = null, scale = 1) {
  const style = baseStyle ? baseStyle.clone() : new Style()

  for (const opt of options) {
    const [key, value] = parseOption(opt)

    switch (key) {
      // Colors
      case "color":
        style.stroke = parseColor(value) || style.stroke
        break
      case "draw":
        // "draw" without value is a flag, "draw=color" sets stroke color
        if (value) {
          style.stroke = parseColor(value) || style.stroke
        }
        // Otherwise just keep the default stroke color (black)
        break
      case "fill":
        style.fill = parseColor(value) || "currentColor"
        break

      // Line width
      case "line width":
        style.lineWidth = parseLineWidth(value, scale)
        break
      case "ultra thin":
      case "very thin":
      case "thin":
      case "semithick":
      case "thick":
      case "very thick":
      case "ultra thick":
        style.lineWidth = LINE_WIDTHS[key] * scale
        break

      // Dash patterns
      case "solid":
      case "dashed":
      case "dotted":
      case "densely dashed":
      case "loosely dashed":
      case "densely dotted":
      case "loosely dotted":
      case "dash dot":
      case "dash dot dot":
        style.dashPattern = parseDashPattern(key, scale)
        break
      case "dash pattern":
        style.dashPattern = parseDashPattern(value, scale)
        break

      // Opacity
      case "opacity":
        style.opacity = parseFloat(value)
        break
      case "fill opacity":
        style.fillOpacity = parseFloat(value)
        break
      case "draw opacity":
        style.strokeOpacity = parseFloat(value)
        break

      // Line caps and joins
      case "line cap":
        style.lineCap = value
        break
      case "line join":
        style.lineJoin = value
        break
      case "rounded corners":
        // Parse value with unit, default to reasonable rounding (about 3mm)
        if (value) {
          const numMatch = value.match(/^(-?\d+\.?\d*)(pt|px|mm|cm|em)?$/)
          if (numMatch) {
            let num = parseFloat(numMatch[1])
            const unit = numMatch[2] || "pt"
            // Convert to cm (our internal unit)
            switch (unit) {
              case "pt":
                num *= 0.0353
                break
              case "mm":
                num *= 0.1
                break
              case "px":
                num *= 0.0264
                break
              case "em":
                num *= 0.423
                break
              // cm is default
            }
            style.roundedCorners = num
          } else {
            style.roundedCorners = 0.1 // 1mm default
          }
        } else {
          style.roundedCorners = 0.1 // 1mm default
        }
        break
      case "sharp corners":
        style.roundedCorners = 0
        break

      // Arrows
      case "->":
      case "-stealth":
      case "-latex":
      case "-to":
        style.arrowEnd = key.slice(1)
        break
      case "-Latex":  // Capital L - TikZ arrows.meta library
      case "-Stealth":
        style.arrowEnd = key.slice(1).toLowerCase()
        break
      case "<-":
      case "stealth-":
      case "latex-":
      case "to-":
        style.arrowStart = key.slice(0, -1)
        break
      case "Latex-":  // Capital L - TikZ arrows.meta library
      case "Stealth-":
        style.arrowStart = key.slice(0, -1).toLowerCase()
        break
      case "<->":
      case "stealth-stealth":
      case "latex-latex":
      case "Latex-Latex":
      case "Stealth-Stealth":
        style.arrowStart = ">"
        style.arrowEnd = ">"
        break
      case "|->":
        style.arrowStart = "|"
        style.arrowEnd = ">"
        break
      case "<-|":
        style.arrowStart = ">"
        style.arrowEnd = "|"
        break
      case "arrow":
        style.arrowEnd = ">"
        break

      // Transformations
      case "shift":
        const shiftMatch = value.match(/\{?\s*\(?\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*\)?\s*\}?/)
        if (shiftMatch) {
          style.transformations.push({
            type: "shift",
            x: parseFloat(shiftMatch[1]),
            y: parseFloat(shiftMatch[2])
          })
        }
        break
      case "xshift":
        style.transformations.push({ type: "xshift", value: parseLineWidth(value, 1) })
        break
      case "yshift":
        style.transformations.push({ type: "yshift", value: parseLineWidth(value, 1) })
        break
      case "rotate":
        style.transformations.push({ type: "rotate", angle: parseFloat(value) })
        break
      case "scale":
        style.transformations.push({ type: "scale", factor: parseFloat(value) })
        break
      case "xscale":
        style.transformations.push({ type: "xscale", factor: parseFloat(value) })
        break
      case "yscale":
        style.transformations.push({ type: "yscale", factor: parseFloat(value) })
        break

      // Decorations
      case "decorate":
        style.decorate = true
        break
      case "decoration":
        // Parse decoration={snake, amplitude=0.5mm, segment length=5mm}
        if (value) {
          const decoration = { type: "snake", amplitude: 0.5, segmentLength: 5 }
          // Remove braces if present
          const cleanValue = value.replace(/^\{|\}$/g, "")
          const parts = cleanValue.split(",").map(p => p.trim())
          for (const part of parts) {
            if (part === "snake" || part === "zigzag" || part === "coil") {
              decoration.type = part
            } else if (part.startsWith("amplitude")) {
              const match = part.match(/amplitude\s*=\s*(-?\d+\.?\d*)(mm|cm|pt)?/)
              if (match) {
                let amp = parseFloat(match[1])
                const unit = match[2] || "mm"
                if (unit === "mm") amp *= 0.1
                else if (unit === "cm") amp *= 1
                else if (unit === "pt") amp *= 0.0353
                decoration.amplitude = amp
              }
            } else if (part.startsWith("segment length")) {
              const match = part.match(/segment\s+length\s*=\s*(\d+\.?\d*)(mm|cm|pt)?/)
              if (match) {
                let len = parseFloat(match[1])
                const unit = match[2] || "mm"
                if (unit === "mm") len *= 0.1
                else if (unit === "cm") len *= 1
                else if (unit === "pt") len *= 0.0353
                decoration.segmentLength = len
              }
            }
          }
          style.decoration = decoration
        }
        break

      // Handle bare color names
      default:
        const color = parseColor(key)
        if (color && color !== key) {
          style.stroke = color
        }
        break
    }
  }

  return style
}

/**
 * Parse a single option string into key-value pair
 */
function parseOption(opt) {
  const trimmed = opt.trim()

  // Check for key=value format
  const eqIndex = trimmed.indexOf("=")
  if (eqIndex !== -1) {
    return [
      trimmed.slice(0, eqIndex).trim(),
      trimmed.slice(eqIndex + 1).trim()
    ]
  }

  // Bare option (flag or color name)
  return [trimmed, null]
}
