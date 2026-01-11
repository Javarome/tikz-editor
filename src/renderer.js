/**
 * TikZ SVG Renderer - Converts AST to SVG elements
 */

import { NodeType } from "./parser.js"
import { parseColor } from "./styles.js"
import { createArrowDefs, getArrowMarker } from "./arrows.js"

const SVG_NS = "http://www.w3.org/2000/svg"

export class Renderer {
  constructor(options = {}) {
    this.scale = options.scale || 50 // pixels per unit
    this.padding = options.padding || 20
    this.backgroundColor = options.backgroundColor || "#ffffff"
    this.defaultStroke = options.defaultStroke || "#000000"
    this.svg = null
    this.defs = null
    this.usedColors = new Set()
  }

  render(ast, coordSystem) {
    // Calculate bounding box
    const bounds = this.calculateBounds(ast)

    // Create SVG element
    const width = (bounds.maxX - bounds.minX) * this.scale + this.padding * 2
    const height = (bounds.maxY - bounds.minY) * this.scale + this.padding * 2

    this.svg = document.createElementNS(SVG_NS, "svg")
    this.svg.setAttribute("width", Math.max(100, width))
    this.svg.setAttribute("height", Math.max(100, height))
    this.svg.setAttribute("viewBox", `0 0 ${Math.max(100, width)} ${Math.max(100, height)}`)
    this.svg.style.backgroundColor = this.backgroundColor

    // Create defs for arrows
    this.defs = document.createElementNS(SVG_NS, "defs")
    this.svg.appendChild(this.defs)

    // Create main group with transform
    const mainGroup = document.createElementNS(SVG_NS, "g")
    mainGroup.setAttribute("transform",
      `translate(${this.padding - bounds.minX * this.scale}, ${this.padding + bounds.maxY * this.scale}) scale(1, -1)`
    )

    // Render each command
    for (const command of ast.commands) {
      const elements = this.renderCommand(command)
      for (const el of elements) {
        mainGroup.appendChild(el)
      }
    }

    this.svg.appendChild(mainGroup)

    // Add arrow defs for all used colors
    this.addArrowDefs()

    return this.svg
  }

  calculateBounds(ast) {
    let minX = -1, maxX = 1, minY = -1, maxY = 1

    const updateBounds = (x, y) => {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }

    for (const command of ast.commands) {
      if (command.position) {
        updateBounds(command.position.x, command.position.y)
      }

      if (command.segments) {
        for (const seg of command.segments) {
          if (seg.from) updateBounds(seg.from.x, seg.from.y)
          if (seg.to) updateBounds(seg.to.x, seg.to.y)
          if (seg.center) {
            const r = seg.radius || Math.max(seg.rx || 0, seg.ry || 0)
            updateBounds(seg.center.x - r, seg.center.y - r)
            updateBounds(seg.center.x + r, seg.center.y + r)
          }
          if (seg.control1) updateBounds(seg.control1.x, seg.control1.y)
          if (seg.control2) updateBounds(seg.control2.x, seg.control2.y)
        }
      }
    }

    // Add some margin
    const margin = 0.5
    return {
      minX: minX - margin,
      maxX: maxX + margin,
      minY: minY - margin,
      maxY: maxY + margin
    }
  }

  renderCommand(command) {
    switch (command.type) {
      case NodeType.DRAW:
        return this.renderDraw(command, true, false)
      case NodeType.FILL:
        return this.renderDraw(command, false, true)
      case NodeType.FILLDRAW:
        return this.renderDraw(command, true, true)
      case NodeType.PATH:
        return this.renderDraw(command, false, false)
      case NodeType.NODE:
        return this.renderNode(command)
      case NodeType.COORDINATE:
        return [] // Coordinates are invisible
      default:
        return []
    }
  }

  renderDraw(command, doStroke, doFill) {
    const elements = []
    const style = command.style || {}

    // Track colors for arrow markers
    const strokeColor = style.stroke || this.defaultStroke
    this.usedColors.add(strokeColor)

    // Build path from segments
    let pathData = ""
    let firstPoint = null
    let currentPoint = null

    for (const segment of command.segments) {
      switch (segment.type) {
        case NodeType.LINE_SEGMENT:
          if (pathData === "" && segment.from) {
            pathData += `M ${this.toSvgX(segment.from.x)} ${this.toSvgY(segment.from.y)} `
            firstPoint = segment.from
          }
          if (segment.to) {
            pathData += `L ${this.toSvgX(segment.to.x)} ${this.toSvgY(segment.to.y)} `
            currentPoint = segment.to
          }
          break

        case NodeType.CURVE_SEGMENT:
          if (pathData === "" && segment.from) {
            pathData += `M ${this.toSvgX(segment.from.x)} ${this.toSvgY(segment.from.y)} `
            firstPoint = segment.from
          }
          pathData += `C ${this.toSvgX(segment.control1.x)} ${this.toSvgY(segment.control1.y)}, `
          pathData += `${this.toSvgX(segment.control2.x)} ${this.toSvgY(segment.control2.y)}, `
          pathData += `${this.toSvgX(segment.to.x)} ${this.toSvgY(segment.to.y)} `
          currentPoint = segment.to
          break

        case NodeType.ARC_SEGMENT:
          const arc = this.renderArc(segment)
          if (pathData === "") {
            pathData += arc
          } else {
            pathData += arc.replace(/^M[^A]*/, "")
          }
          break

        case NodeType.CIRCLE:
          elements.push(this.renderCircle(segment, style, doStroke, doFill, strokeColor))
          break

        case NodeType.ELLIPSE:
          elements.push(this.renderEllipse(segment, style, doStroke, doFill, strokeColor))
          break

        case NodeType.RECTANGLE:
          elements.push(this.renderRectangle(segment, style, doStroke, doFill, strokeColor))
          break

        case NodeType.GRID:
          elements.push(...this.renderGrid(segment, style, strokeColor))
          break

        case NodeType.CYCLE:
          pathData += "Z "
          break

        case NodeType.NODE:
          elements.push(...this.renderNode(segment))
          break
      }
    }

    // Create path element if we have path data
    if (pathData) {
      const path = document.createElementNS(SVG_NS, "path")
      path.setAttribute("d", pathData)
      this.applyStyle(path, style, doStroke, doFill, strokeColor)
      elements.unshift(path)
    }

    return elements
  }

  renderCircle(segment, style, doStroke, doFill, strokeColor) {
    const circle = document.createElementNS(SVG_NS, "circle")
    circle.setAttribute("cx", this.toSvgX(segment.center.x))
    circle.setAttribute("cy", this.toSvgY(segment.center.y))
    circle.setAttribute("r", segment.radius * this.scale)
    this.applyStyle(circle, style, doStroke, doFill, strokeColor)
    return circle
  }

  renderEllipse(segment, style, doStroke, doFill, strokeColor) {
    const ellipse = document.createElementNS(SVG_NS, "ellipse")
    ellipse.setAttribute("cx", this.toSvgX(segment.center.x))
    ellipse.setAttribute("cy", this.toSvgY(segment.center.y))
    ellipse.setAttribute("rx", segment.rx * this.scale)
    ellipse.setAttribute("ry", segment.ry * this.scale)
    this.applyStyle(ellipse, style, doStroke, doFill, strokeColor)
    return ellipse
  }

  renderRectangle(segment, style, doStroke, doFill, strokeColor) {
    const rect = document.createElementNS(SVG_NS, "rect")
    const x = Math.min(segment.from.x, segment.to.x)
    const y = Math.min(segment.from.y, segment.to.y)
    const width = Math.abs(segment.to.x - segment.from.x)
    const height = Math.abs(segment.to.y - segment.from.y)

    rect.setAttribute("x", this.toSvgX(x))
    rect.setAttribute("y", this.toSvgY(y + height))
    rect.setAttribute("width", width * this.scale)
    rect.setAttribute("height", height * this.scale)

    if (style.roundedCorners) {
      rect.setAttribute("rx", style.roundedCorners * this.scale)
      rect.setAttribute("ry", style.roundedCorners * this.scale)
    }

    this.applyStyle(rect, style, doStroke, doFill, strokeColor)
    return rect
  }

  renderArc(segment) {
    const { start, startAngle, endAngle, rx, ry } = segment
    const radius = rx || segment.radius
    const radiusY = ry || radius

    // Calculate center from start point and start angle
    const startRad = (startAngle * Math.PI) / 180
    const endRad = (endAngle * Math.PI) / 180

    const cx = start.x - radius * Math.cos(startRad)
    const cy = start.y - radiusY * Math.sin(startRad)

    // Calculate end point
    const endX = cx + radius * Math.cos(endRad)
    const endY = cy + radiusY * Math.sin(endRad)

    // Determine arc sweep
    let angleDiff = endAngle - startAngle
    while (angleDiff < 0) angleDiff += 360
    while (angleDiff > 360) angleDiff -= 360

    const largeArc = angleDiff > 180 ? 1 : 0
    const sweep = 1

    return `M ${this.toSvgX(start.x)} ${this.toSvgY(start.y)} ` +
      `A ${radius * this.scale} ${radiusY * this.scale} 0 ${largeArc} ${sweep} ` +
      `${this.toSvgX(endX)} ${this.toSvgY(endY)} `
  }

  renderGrid(segment, style, strokeColor) {
    const elements = []
    const { from, to, step } = segment

    const minX = Math.min(from.x, to.x)
    const maxX = Math.max(from.x, to.x)
    const minY = Math.min(from.y, to.y)
    const maxY = Math.max(from.y, to.y)

    // Vertical lines
    for (let x = minX; x <= maxX; x += step) {
      const line = document.createElementNS(SVG_NS, "line")
      line.setAttribute("x1", this.toSvgX(x))
      line.setAttribute("y1", this.toSvgY(minY))
      line.setAttribute("x2", this.toSvgX(x))
      line.setAttribute("y2", this.toSvgY(maxY))
      this.applyStyle(line, style, true, false, strokeColor)
      elements.push(line)
    }

    // Horizontal lines
    for (let y = minY; y <= maxY; y += step) {
      const line = document.createElementNS(SVG_NS, "line")
      line.setAttribute("x1", this.toSvgX(minX))
      line.setAttribute("y1", this.toSvgY(y))
      line.setAttribute("x2", this.toSvgX(maxX))
      line.setAttribute("y2", this.toSvgY(y))
      this.applyStyle(line, style, true, false, strokeColor)
      elements.push(line)
    }

    return elements
  }

  renderNode(node) {
    const elements = []
    const { position, text, shape, width, height, innerSep, draw, fill, style } = node

    const group = document.createElementNS(SVG_NS, "g")
    group.setAttribute("transform", `translate(${this.toSvgX(position.x)}, ${this.toSvgY(position.y)}) scale(1, -1)`)

    // Calculate dimensions based on text (approximate)
    const textWidth = text.length * 8 + innerSep * 2 * this.scale
    const textHeight = 16 + innerSep * 2 * this.scale
    const nodeWidth = Math.max(width * this.scale, textWidth)
    const nodeHeight = Math.max(height * this.scale, textHeight)

    // Draw shape if needed
    if (draw || fill) {
      let shapeEl

      if (shape === "circle") {
        const radius = Math.max(nodeWidth, nodeHeight) / 2
        shapeEl = document.createElementNS(SVG_NS, "circle")
        shapeEl.setAttribute("cx", "0")
        shapeEl.setAttribute("cy", "0")
        shapeEl.setAttribute("r", radius)
      } else if (shape === "ellipse") {
        shapeEl = document.createElementNS(SVG_NS, "ellipse")
        shapeEl.setAttribute("cx", "0")
        shapeEl.setAttribute("cy", "0")
        shapeEl.setAttribute("rx", nodeWidth / 2)
        shapeEl.setAttribute("ry", nodeHeight / 2)
      } else {
        // Rectangle (default)
        shapeEl = document.createElementNS(SVG_NS, "rect")
        shapeEl.setAttribute("x", -nodeWidth / 2)
        shapeEl.setAttribute("y", -nodeHeight / 2)
        shapeEl.setAttribute("width", nodeWidth)
        shapeEl.setAttribute("height", nodeHeight)

        if (style?.roundedCorners) {
          shapeEl.setAttribute("rx", style.roundedCorners * this.scale)
          shapeEl.setAttribute("ry", style.roundedCorners * this.scale)
        }
      }

      // Apply fill
      if (fill) {
        const fillColor = parseColor(fill)
        shapeEl.setAttribute("fill", fillColor || "#ffffff")
      } else {
        shapeEl.setAttribute("fill", "none")
      }

      // Apply stroke
      if (draw) {
        shapeEl.setAttribute("stroke", style?.stroke || this.defaultStroke)
        shapeEl.setAttribute("stroke-width", (style?.lineWidth || 0.4) * 2)
      } else {
        shapeEl.setAttribute("stroke", "none")
      }

      group.appendChild(shapeEl)
    }

    // Add text
    if (text) {
      const textEl = document.createElementNS(SVG_NS, "text")
      textEl.setAttribute("x", "0")
      textEl.setAttribute("y", "0")
      textEl.setAttribute("text-anchor", "middle")
      textEl.setAttribute("dominant-baseline", "central")
      textEl.setAttribute("font-family", "serif")
      textEl.setAttribute("font-size", "14")
      textEl.setAttribute("fill", style?.stroke || this.defaultStroke)
      textEl.textContent = text
      group.appendChild(textEl)
    }

    elements.push(group)
    return elements
  }

  applyStyle(element, style, doStroke, doFill, strokeColor) {
    // Stroke
    if (doStroke) {
      element.setAttribute("stroke", strokeColor)
      // Line width should not scale with coordinates - use fixed pixel multiplier
      element.setAttribute("stroke-width", (style.lineWidth || 0.4) * 2)

      if (style.dashPattern) {
        element.setAttribute("stroke-dasharray", style.dashPattern.map(v => v * 2).join(" "))
      }

      if (style.lineCap) {
        element.setAttribute("stroke-linecap", style.lineCap)
      }

      if (style.lineJoin) {
        element.setAttribute("stroke-linejoin", style.lineJoin)
      }

      if (style.strokeOpacity !== undefined && style.strokeOpacity !== 1) {
        element.setAttribute("stroke-opacity", style.strokeOpacity)
      }

      // Arrow markers
      if (style.arrowEnd) {
        element.setAttribute("marker-end", getArrowMarker(style.arrowEnd, false, strokeColor))
      }
      if (style.arrowStart) {
        element.setAttribute("marker-start", getArrowMarker(style.arrowStart, true, strokeColor))
      }
    } else {
      element.setAttribute("stroke", "none")
    }

    // Fill
    if (doFill && style.fill && style.fill !== "none") {
      const fillColor = parseColor(style.fill)
      element.setAttribute("fill", fillColor || style.fill)

      if (style.fillOpacity !== undefined && style.fillOpacity !== 1) {
        element.setAttribute("fill-opacity", style.fillOpacity)
      }
    } else {
      element.setAttribute("fill", "none")
    }

    // Overall opacity
    if (style.opacity !== undefined && style.opacity !== 1) {
      element.setAttribute("opacity", style.opacity)
    }
  }

  addArrowDefs() {
    for (const color of this.usedColors) {
      // Scale arrows appropriately - use smaller multiplier for reasonable arrow size
      const defs = createArrowDefs(color, this.scale * 0.02)
      while (defs.firstChild) {
        this.defs.appendChild(defs.firstChild)
      }
    }
  }

  toSvgX(x) {
    return x * this.scale
  }

  toSvgY(y) {
    return y * this.scale
  }

  setScale(scale) {
    this.scale = scale
  }
}

export function render(ast, coordSystem, options = {}) {
  const renderer = new Renderer(options)
  return renderer.render(ast, coordSystem)
}
