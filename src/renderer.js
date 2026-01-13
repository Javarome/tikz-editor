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
    this.baseScale = 50 // reference scale for font sizing
    this.padding = options.padding || 20
    this.backgroundColor = options.backgroundColor || "#ffffff"
    this.defaultStroke = options.defaultStroke || "#000000"
    this.svg = null
    this.defs = null
    this.usedColors = new Set()
    this.bounds = null // Store bounds for Y-flip calculation
    this.nodeMetrics = new Map() // Store measured node dimensions: name -> {width, height, center}
  }

  // Get font scale factor relative to base scale
  get fontScale() {
    return this.scale / this.baseScale
  }

  render(ast, coordSystem) {
    // First pass: measure all nodes to get their actual dimensions
    this.nodeMetrics.clear()
    this.measureAllNodes(ast)

    // Calculate bounding box
    this.bounds = this.calculateBounds(ast)
    const bounds = this.bounds

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

    // Create main group with simple translation (no Y-flip - handled in toSvgY)
    const mainGroup = document.createElementNS(SVG_NS, "g")
    mainGroup.setAttribute("transform",
      `translate(${this.padding - bounds.minX * this.scale}, ${this.padding})`
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

  /**
   * First pass: measure all nodes to get their actual dimensions
   */
  measureAllNodes(ast) {
    for (const command of ast.commands) {
      if (command.type === NodeType.NODE && command.name) {
        const metrics = this.measureNode(command)
        this.nodeMetrics.set(command.name, metrics)
      }
      // Also check for inline nodes in draw commands
      if (command.segments) {
        for (const seg of command.segments) {
          if (seg.type === NodeType.NODE && seg.name) {
            const metrics = this.measureNode(seg)
            this.nodeMetrics.set(seg.name, metrics)
          }
        }
      }
    }
  }

  /**
   * Measure a node's dimensions without rendering it
   */
  measureNode(node) {
    const { position, text, width, height, innerSep, fontSize } = node

    // Parse text and measure it
    const { lines } = this.parseNodeText(text, fontSize)
    const lineHeight = 16 * this.fontScale

    let textBBox = { width: 0, height: 0 }
    if (text && lines.length > 0) {
      const textEl = document.createElementNS(SVG_NS, "text")
      textEl.setAttribute("x", "0")
      textEl.setAttribute("text-anchor", "middle")
      textEl.setAttribute("font-family", "serif")

      const startY = -((lines.length - 1) * lineHeight) / 2
      lines.forEach((line, index) => {
        const tspan = document.createElementNS(SVG_NS, "tspan")
        tspan.setAttribute("x", "0")
        tspan.setAttribute("dy", index === 0 ? startY : lineHeight)
        tspan.setAttribute("dominant-baseline", "central")
        tspan.setAttribute("font-size", line.fontSize)
        this.renderTextContent(tspan, line.content)
        textEl.appendChild(tspan)
      })

      textBBox = this.measureText(textEl)
    }

    // Calculate actual dimensions (same logic as renderNode)
    const textWidth = textBBox.width + innerSep * 2 * this.scale
    const textHeight = textBBox.height + innerSep * 2 * this.scale
    const nodeWidth = Math.max(width * this.scale, textWidth)
    const nodeHeight = Math.max(height * this.scale, textHeight)

    return {
      center: position,
      width: nodeWidth / this.scale,  // Convert back to TikZ units
      height: nodeHeight / this.scale,
      shape: node.shape || "rectangle"
    }
  }

  calculateBounds(ast) {
    let minX = -1, maxX = 1, minY = -1, maxY = 1

    const updateBounds = (x, y) => {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }

    // Helper to update bounds for a node with its full extent
    const updateNodeBounds = (node) => {
      if (!node.position) return
      const x = node.position.x
      const y = node.position.y
      // Use measured dimensions if available, otherwise fall back to node properties
      const metrics = node.name ? this.nodeMetrics.get(node.name) : null
      const hw = (metrics ? metrics.width : (node.width || 1)) / 2
      const hh = (metrics ? metrics.height : (node.height || 0.5)) / 2
      updateBounds(x - hw, y - hh)
      updateBounds(x + hw, y + hh)
    }

    for (const command of ast.commands) {
      // For NODE commands, account for width/height
      if (command.type === NodeType.NODE && command.position) {
        updateNodeBounds(command)
      } else if (command.position) {
        updateBounds(command.position.x, command.position.y)
      }

      if (command.segments) {
        for (const seg of command.segments) {
          // Check for inline nodes in segments
          if (seg.type === NodeType.NODE && seg.position) {
            updateNodeBounds(seg)
          }
          if (seg.from) updateBounds(seg.from.x, seg.from.y)
          if (seg.to) updateBounds(seg.to.x, seg.to.y)
          if (seg.center) {
            const r = seg.radius || Math.max(seg.rx || 0, seg.ry || 0)
            updateBounds(seg.center.x - r, seg.center.y - r)
            updateBounds(seg.center.x + r, seg.center.y + r)
          }
          if (seg.control1) updateBounds(seg.control1.x, seg.control1.y)
          if (seg.control2) updateBounds(seg.control2.x, seg.control2.y)
          // Include edge label positions with some padding for text
          if (seg.edgeLabel) {
            const pos = seg.edgeLabel.labelPosition?.pos || 0.5
            const offset = seg.edgeLabel.labelPosition?.offset || { x: 0, y: 0 }
            const labelX = seg.from.x + (seg.to.x - seg.from.x) * pos + offset.x
            const labelY = seg.from.y + (seg.to.y - seg.from.y) * pos + offset.y
            // Add padding for text width/height
            updateBounds(labelX - 0.5, labelY - 1)
            updateBounds(labelX + 3, labelY + 1)
          }
          // Include plot points
          if (seg.points) {
            for (const pt of seg.points) {
              updateBounds(pt.x, pt.y)
            }
          }
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
          // Adjust endpoints based on actual node dimensions
          // The parser pre-calculates boundary points with estimated dimensions,
          // but we recalculate using actual measured dimensions
          let fromPoint = segment.from
          let toPoint = segment.to

          // Get actual node centers from metrics (parser's segment.from/to may already be boundary points)
          const fromMetrics = segment.fromNodeName ? this.nodeMetrics.get(segment.fromNodeName) : null
          const toMetrics = segment.toNodeName ? this.nodeMetrics.get(segment.toNodeName) : null

          // Use node centers for boundary calculation
          const fromCenter = fromMetrics ? fromMetrics.center : segment.from
          const toCenter = toMetrics ? toMetrics.center : segment.to

          if (segment.fromNodeName && fromMetrics) {
            fromPoint = this.getNodeBoundaryPoint(segment.fromNodeName, fromCenter, toCenter)
          }
          if (segment.toNodeName && toMetrics) {
            toPoint = this.getNodeBoundaryPoint(segment.toNodeName, toCenter, fromCenter)
          }

          if (pathData === "" && fromPoint) {
            pathData += `M ${this.toSvgX(fromPoint.x)} ${this.toSvgY(fromPoint.y)} `
            firstPoint = fromPoint
          }
          if (toPoint) {
            pathData += `L ${this.toSvgX(toPoint.x)} ${this.toSvgY(toPoint.y)} `
            currentPoint = toPoint
          }
          // Check for edge label
          if (segment.edgeLabel) {
            const edgeLabelElements = this.renderEdgeLabel(fromPoint, toPoint, segment.edgeLabel)
            elements.push(...edgeLabelElements)
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

        case NodeType.PLOT_SEGMENT:
          // Render plot as a series of line segments
          if (segment.points && segment.points.length > 0) {
            const firstPlotPoint = segment.points[0]
            if (pathData === "") {
              pathData += `M ${this.toSvgX(firstPlotPoint.x)} ${this.toSvgY(firstPlotPoint.y)} `
              firstPoint = firstPlotPoint
            } else {
              pathData += `L ${this.toSvgX(firstPlotPoint.x)} ${this.toSvgY(firstPlotPoint.y)} `
            }
            for (let i = 1; i < segment.points.length; i++) {
              const pt = segment.points[i]
              pathData += `L ${this.toSvgX(pt.x)} ${this.toSvgY(pt.y)} `
            }
            currentPoint = segment.points[segment.points.length - 1]
          }
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
    const { position, text, shape, width, height, innerSep, draw, fill, style, align, fontSize } = node

    const group = document.createElementNS(SVG_NS, "g")
    group.setAttribute("transform", `translate(${this.toSvgX(position.x)}, ${this.toSvgY(position.y)}) `)

    // Parse text lines and font sizes (use node's fontSize as default if provided)
    const { lines } = this.parseNodeText(text, fontSize)
    const lineHeight = 16 * this.fontScale

    // Determine text anchor based on align option
    const textAnchor = align === "left" ? "start" : align === "right" ? "end" : "middle"

    // Create text element first so we can measure it
    let textEl = null
    let textBBox = { width: 0, height: 0 }

    if (text && lines.length > 0) {
      textEl = document.createElementNS(SVG_NS, "text")
      textEl.setAttribute("x", "0")
      textEl.setAttribute("text-anchor", textAnchor)
      textEl.setAttribute("font-family", "serif")
      textEl.setAttribute("fill", style?.stroke || this.defaultStroke)

      // Calculate starting Y to center the text block
      const startY = -((lines.length - 1) * lineHeight) / 2

      lines.forEach((line, index) => {
        const tspan = document.createElementNS(SVG_NS, "tspan")
        tspan.setAttribute("x", "0")
        tspan.setAttribute("dy", index === 0 ? startY : lineHeight)
        tspan.setAttribute("dominant-baseline", "central")
        tspan.setAttribute("font-size", line.fontSize)

        // Render content (with math support)
        this.renderTextContent(tspan, line.content)
        textEl.appendChild(tspan)
      })

      // Measure text by temporarily adding to SVG
      textBBox = this.measureText(textEl)
    }

    // Calculate dimensions based on measured text
    const textWidth = textBBox.width + innerSep * 2 * this.scale
    const textHeight = textBBox.height + innerSep * 2 * this.scale
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
        // Apply dash pattern if present
        if (style?.dashPattern) {
          shapeEl.setAttribute("stroke-dasharray", style.dashPattern.map(v => v * 2).join(" "))
        }
      } else {
        shapeEl.setAttribute("stroke", "none")
      }

      group.appendChild(shapeEl)
    }

    // Add text element (already created and measured)
    if (textEl) {
      // Update x position based on alignment and final node width
      const textX = textAnchor === "start" ? -nodeWidth / 2 + innerSep * this.scale :
        textAnchor === "end" ? nodeWidth / 2 - innerSep * this.scale : 0
      textEl.setAttribute("x", textX)
      // Update all tspan x positions
      for (const tspan of textEl.children) {
        tspan.setAttribute("x", textX)
      }
      group.appendChild(textEl)
    }

    elements.push(group)
    return elements
  }

  /**
   * Measure text element by temporarily adding to SVG
   */
  measureText(textEl) {
    // Create a temporary SVG if needed for measurement
    // Must have real dimensions and be in document for getBBox to work
    let tempSvg = document.getElementById("__tikz_measure_svg__")
    if (!tempSvg) {
      tempSvg = document.createElementNS(SVG_NS, "svg")
      tempSvg.setAttribute("id", "__tikz_measure_svg__")
      tempSvg.setAttribute("width", "1000")
      tempSvg.setAttribute("height", "1000")
      tempSvg.style.position = "absolute"
      tempSvg.style.left = "-9999px"
      tempSvg.style.top = "-9999px"
      document.body.appendChild(tempSvg)
    }

    // Add text to measure
    tempSvg.appendChild(textEl)

    // Get bounding box
    let bbox = { width: 0, height: 0 }
    try {
      const rect = textEl.getBBox()
      bbox = { width: rect.width, height: rect.height }
    } catch (e) {
      // getBBox can fail if element has no dimensions
      console.warn("getBBox failed:", e)
    }

    // Remove from temp SVG (will be added to real SVG later)
    tempSvg.removeChild(textEl)

    return bbox
  }

  /**
   * Get the boundary point of a node in the direction of a target point
   * Uses measured node dimensions from nodeMetrics
   */
  getNodeBoundaryPoint(nodeName, nodeCenter, targetPoint) {
    const metrics = this.nodeMetrics.get(nodeName)
    if (!metrics) {
      return nodeCenter // Fallback to center if no metrics
    }

    const center = metrics.center
    const shape = metrics.shape || "rectangle"
    const width = metrics.width
    const height = metrics.height

    // Direction vector from center to target
    const dx = targetPoint.x - center.x
    const dy = targetPoint.y - center.y

    // If target is at the center, return center
    if (dx === 0 && dy === 0) {
      return { x: center.x, y: center.y }
    }

    const hw = width / 2
    const hh = height / 2

    if (shape === "circle") {
      // For circle, use the larger dimension as radius
      const r = Math.max(hw, hh)
      const dist = Math.sqrt(dx * dx + dy * dy)
      const scale = r / dist
      return { x: center.x + dx * scale, y: center.y + dy * scale }
    } else if (shape === "ellipse") {
      // For ellipse, scale the direction vector
      const angle = Math.atan2(dy, dx)
      const x = hw * Math.cos(angle)
      const y = hh * Math.sin(angle)
      return { x: center.x + x, y: center.y + y }
    } else {
      // Rectangle: find intersection with the rectangle boundary
      const dist = Math.sqrt(dx * dx + dy * dy)
      const nx = dx / dist  // normalized direction
      const ny = dy / dist

      // Calculate t for intersection with each edge
      // Right edge: center.x + hw = center.x + t * dx  =>  t = hw / dx
      // Top edge: center.y + hh = center.y + t * dy  =>  t = hh / dy
      let t = Infinity

      if (nx !== 0) {
        const tRight = hw / Math.abs(nx)
        if (tRight < t) t = tRight
      }
      if (ny !== 0) {
        const tTop = hh / Math.abs(ny)
        if (tTop < t) t = tTop
      }

      return { x: center.x + nx * t, y: center.y + ny * t }
    }
  }

  /**
   * Parse node text, handling \\ line breaks, font commands, and tabular environments
   */
  parseNodeText(text, defaultFontSize = null) {
    if (!text) return { lines: [] }

    let processedText = text

    // Handle tabular environment: \begin{tabular}{...}...\end{tabular}
    // Extract the content and treat rows as lines
    const tabularMatch = processedText.match(/\\begin\{tabular\}\{[^}]*\}([\s\S]*?)\\end\{tabular\}/)
    if (tabularMatch) {
      processedText = tabularMatch[1].trim()
    }

    // Split by \\ (double backslash for line breaks)
    const rawLines = processedText.split(/\\\\/)
    const lines = []

    for (const rawLine of rawLines) {
      let content = rawLine.trim()
      let baseFontSize = defaultFontSize || 14

      // Check for font size commands (these override the default)
      if (content.includes("\\footnotesize")) {
        baseFontSize = 10
        content = content.replace(/\\footnotesize\s*/g, "")
      } else if (content.includes("\\scriptsize")) {
        baseFontSize = 8
        content = content.replace(/\\scriptsize\s*/g, "")
      } else if (content.includes("\\small")) {
        baseFontSize = 12
        content = content.replace(/\\small\s*/g, "")
      } else if (content.includes("\\large")) {
        baseFontSize = 16
        content = content.replace(/\\large\s*/g, "")
      } else if (content.includes("\\Large")) {
        baseFontSize = 18
        content = content.replace(/\\Large\s*/g, "")
      }

      // Scale font size with zoom
      const fontSize = baseFontSize * this.fontScale

      content = content.trim()
      if (content) {
        lines.push({ content, fontSize })
      }
    }

    return { lines }
  }

  /**
   * Render text content, handling math mode $...$
   */
  renderTextContent(tspan, content) {
    // Simple math mode support - look for $...$ patterns
    const mathRegex = /\$([^$]+)\$/g
    let lastIndex = 0
    let match

    while ((match = mathRegex.exec(content)) !== null) {
      // Add text before math
      if (match.index > lastIndex) {
        tspan.appendChild(document.createTextNode(content.slice(lastIndex, match.index)))
      }

      // Add math content (italic for variables)
      const mathContent = this.renderMath(match[1])
      tspan.appendChild(mathContent)

      lastIndex = match.index + match[0].length
    }

    // Add remaining text
    if (lastIndex < content.length) {
      tspan.appendChild(document.createTextNode(content.slice(lastIndex)))
    }
  }

  /**
   * Render math content - simple implementation
   */
  renderMath(mathContent) {
    const container = document.createElementNS(SVG_NS, "tspan")

    // Process the math content to extract subscripts/superscripts and main text
    let processed = mathContent

    // Handle common LaTeX commands (Greek letters, symbols)
    processed = processed
      .replace(/\\chi/g, "χ")
      .replace(/\\alpha/g, "α")
      .replace(/\\beta/g, "β")
      .replace(/\\gamma/g, "γ")
      .replace(/\\delta/g, "δ")
      .replace(/\\epsilon/g, "ε")
      .replace(/\\zeta/g, "ζ")
      .replace(/\\eta/g, "η")
      .replace(/\\theta/g, "θ")
      .replace(/\\iota/g, "ι")
      .replace(/\\kappa/g, "κ")
      .replace(/\\lambda/g, "λ")
      .replace(/\\mu/g, "μ")
      .replace(/\\nu/g, "ν")
      .replace(/\\xi/g, "ξ")
      .replace(/\\pi/g, "π")
      .replace(/\\rho/g, "ρ")
      .replace(/\\sigma/g, "σ")
      .replace(/\\tau/g, "τ")
      .replace(/\\upsilon/g, "υ")
      .replace(/\\phi/g, "φ")
      .replace(/\\psi/g, "ψ")
      .replace(/\\omega/g, "ω")
      .replace(/\\Gamma/g, "Γ")
      .replace(/\\Delta/g, "Δ")
      .replace(/\\Theta/g, "Θ")
      .replace(/\\Lambda/g, "Λ")
      .replace(/\\Xi/g, "Ξ")
      .replace(/\\Pi/g, "Π")
      .replace(/\\Sigma/g, "Σ")
      .replace(/\\Phi/g, "Φ")
      .replace(/\\Psi/g, "Ψ")
      .replace(/\\Omega/g, "Ω")
      .replace(/\\infty/g, "∞")
      .replace(/\\partial/g, "∂")
      .replace(/\\nabla/g, "∇")
      .replace(/\\times/g, "×")
      .replace(/\\cdot/g, "·")
      .replace(/\\pm/g, "±")
      .replace(/\\mp/g, "∓")
      .replace(/\\leq/g, "≤")
      .replace(/\\geq/g, "≥")
      .replace(/\\neq/g, "≠")
      .replace(/\\approx/g, "≈")
      .replace(/\\equiv/g, "≡")
      .replace(/\\rightarrow/g, "→")
      .replace(/\\leftarrow/g, "←")
      .replace(/\\Rightarrow/g, "⇒")
      .replace(/\\Leftarrow/g, "⇐")
      .replace(/\\simeq/g, "≃")
      .replace(/\\otimes/g, "⊗")
      .replace(/\\oplus/g, "⊕")
      .replace(/\\subset/g, "⊂")
      .replace(/\\supset/g, "⊃")
      .replace(/\\subseteq/g, "⊆")
      .replace(/\\supseteq/g, "⊇")
      .replace(/\\in/g, "∈")
      .replace(/\\notin/g, "∉")
      .replace(/\\forall/g, "∀")
      .replace(/\\exists/g, "∃")
      .replace(/\\neg/g, "¬")
      .replace(/\\land/g, "∧")
      .replace(/\\lor/g, "∨")

    // Handle \mathcal{...} - convert to mathematical script characters
    processed = processed.replace(/\\mathcal\{([^}]+)\}/g, (match, content) => {
      return this.toMathCaligraphic(content)
    })

    // Handle subscripts with \mathrm inside: _{\mathrm{...}}
    processed = processed.replace(/_\{\\mathrm\{([^}]+)\}\}/g, "\x00subrm:$1\x01")

    // Handle superscripts with \mathrm inside: ^{\mathrm{...}}
    processed = processed.replace(/\^\{\\mathrm\{([^}]+)\}\}/g, "\x00suprm:$1\x01")

    // Handle \mathrm{...} - mark for non-italic rendering
    processed = processed.replace(/\\mathrm\{([^}]+)\}/g, "\x00mathrm:$1\x01")

    // Handle subscripts: _{...} or _x - mark for later
    processed = processed.replace(/_\{([^}]+)\}/g, "\x00sub:$1\x01")
    processed = processed.replace(/_([a-zA-Z0-9])/g, "\x00sub:$1\x01")

    // Handle superscripts: ^{...} or ^x - mark for later
    processed = processed.replace(/\^\{([^}]+)\}/g, "\x00sup:$1\x01")
    processed = processed.replace(/\^([a-zA-Z0-9])/g, "\x00sup:$1\x01")

    // Now parse and build the SVG structure
    const regex = /\x00(mathrm|subrm|suprm|sub|sup):([^\x01]+)\x01/g
    let lastIndex = 0
    let match

    while ((match = regex.exec(processed)) !== null) {
      // Add text before this match (italic, as it's math mode)
      if (match.index > lastIndex) {
        const textSpan = document.createElementNS(SVG_NS, "tspan")
        textSpan.setAttribute("font-style", "italic")
        textSpan.textContent = processed.slice(lastIndex, match.index)
        container.appendChild(textSpan)
      }

      const type = match[1]
      const content = match[2]

      if (type === "mathrm") {
        // Roman (non-italic) text
        const rmSpan = document.createElementNS(SVG_NS, "tspan")
        rmSpan.setAttribute("font-style", "normal")
        rmSpan.textContent = content
        container.appendChild(rmSpan)
      } else if (type === "subrm") {
        // Subscript with roman (non-italic) text
        const subSpan = document.createElementNS(SVG_NS, "tspan")
        subSpan.setAttribute("baseline-shift", "sub")
        subSpan.setAttribute("font-size", "70%")
        subSpan.setAttribute("font-style", "normal")
        subSpan.textContent = content
        container.appendChild(subSpan)
      } else if (type === "suprm") {
        // Superscript with roman (non-italic) text
        const supSpan = document.createElementNS(SVG_NS, "tspan")
        supSpan.setAttribute("baseline-shift", "super")
        supSpan.setAttribute("font-size", "70%")
        supSpan.setAttribute("font-style", "normal")
        supSpan.textContent = content
        container.appendChild(supSpan)
      } else if (type === "sub") {
        // Subscript using baseline-shift and smaller font
        const subSpan = document.createElementNS(SVG_NS, "tspan")
        subSpan.setAttribute("baseline-shift", "sub")
        subSpan.setAttribute("font-size", "70%")
        subSpan.setAttribute("font-style", "italic")
        subSpan.textContent = content
        container.appendChild(subSpan)
      } else if (type === "sup") {
        // Superscript using baseline-shift and smaller font
        const supSpan = document.createElementNS(SVG_NS, "tspan")
        supSpan.setAttribute("baseline-shift", "super")
        supSpan.setAttribute("font-size", "70%")
        supSpan.setAttribute("font-style", "italic")
        supSpan.textContent = content
        container.appendChild(supSpan)
      }

      lastIndex = match.index + match[0].length
    }

    // Add remaining text (italic)
    if (lastIndex < processed.length) {
      const textSpan = document.createElementNS(SVG_NS, "tspan")
      textSpan.setAttribute("font-style", "italic")
      textSpan.textContent = processed.slice(lastIndex)
      container.appendChild(textSpan)
    }

    return container
  }

  /**
   * Convert characters to subscript Unicode
   */
  toSubscript(text) {
    const subscriptMap = {
      "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
      "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
      "a": "ₐ", "e": "ₑ", "h": "ₕ", "i": "ᵢ", "j": "ⱼ",
      "k": "ₖ", "l": "ₗ", "m": "ₘ", "n": "ₙ", "o": "ₒ",
      "p": "ₚ", "r": "ᵣ", "s": "ₛ", "t": "ₜ", "u": "ᵤ",
      "v": "ᵥ", "x": "ₓ", "+": "₊", "-": "₋", "=": "₌",
      "(": "₍", ")": "₎"
    }

    // Also handle common words
    if (text === "eff") return "ₑff"
    if (text === "mathrm{eff}") return "eff"

    return text.split("").map(c => subscriptMap[c.toLowerCase()] || c).join("")
  }

  /**
   * Convert characters to superscript Unicode
   */
  toSuperscript(text) {
    const superscriptMap = {
      "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
      "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
      "a": "ᵃ", "b": "ᵇ", "c": "ᶜ", "d": "ᵈ", "e": "ᵉ",
      "f": "ᶠ", "g": "ᵍ", "h": "ʰ", "i": "ⁱ", "j": "ʲ",
      "k": "ᵏ", "l": "ˡ", "m": "ᵐ", "n": "ⁿ", "o": "ᵒ",
      "p": "ᵖ", "r": "ʳ", "s": "ˢ", "t": "ᵗ", "u": "ᵘ",
      "v": "ᵛ", "w": "ʷ", "x": "ˣ", "y": "ʸ", "z": "ᶻ",
      "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾"
    }

    return text.split("").map(c => superscriptMap[c.toLowerCase()] || c).join("")
  }

  /**
   * Convert characters to mathematical calligraphic/script Unicode
   */
  toMathCaligraphic(text) {
    // Mathematical Script capital letters (U+1D49C onwards, with exceptions)
    const calMap = {
      "A": "𝒜", "B": "ℬ", "C": "𝒞", "D": "𝒟", "E": "ℰ",
      "F": "ℱ", "G": "𝒢", "H": "ℋ", "I": "ℐ", "J": "𝒥",
      "K": "𝒦", "L": "ℒ", "M": "ℳ", "N": "𝒩", "O": "𝒪",
      "P": "𝒫", "Q": "𝒬", "R": "ℛ", "S": "𝒮", "T": "𝒯",
      "U": "𝒰", "V": "𝒱", "W": "𝒲", "X": "𝒳", "Y": "𝒴",
      "Z": "𝒵",
      // Lowercase script letters
      "a": "𝒶", "b": "𝒷", "c": "𝒸", "d": "𝒹", "e": "ℯ",
      "f": "𝒻", "g": "ℊ", "h": "𝒽", "i": "𝒾", "j": "𝒿",
      "k": "𝓀", "l": "𝓁", "m": "𝓂", "n": "𝓃", "o": "ℴ",
      "p": "𝓅", "q": "𝓆", "r": "𝓇", "s": "𝓈", "t": "𝓉",
      "u": "𝓊", "v": "𝓋", "w": "𝓌", "x": "𝓍", "y": "𝓎",
      "z": "𝓏"
    }

    return text.split("").map(c => calMap[c] || c).join("")
  }

  /**
   * Render an edge label at a position along a line segment
   */
  renderEdgeLabel(from, to, label) {
    const elements = []

    // Calculate position along the edge
    const pos = label.labelPosition?.pos || 0.5
    const offset = label.labelPosition?.offset || { x: 0, y: 0 }

    // Interpolate position on the line
    const x = from.x + (to.x - from.x) * pos + offset.x
    const y = from.y + (to.y - from.y) * pos + offset.y

    // Determine alignment based on offset direction
    const align = label.labelPosition?.align || label.align || "left"

    // For edge labels, render text directly without a box wrapper
    // This gives more precise positioning control
    const group = document.createElementNS(SVG_NS, "g")
    group.setAttribute("transform", `translate(${this.toSvgX(x)}, ${this.toSvgY(y)}) `)

    // Parse text lines
    const fontSize = label.fontSize || 10
    const { lines } = this.parseNodeText(label.text, fontSize)
    const lineHeight = 14 * this.fontScale

    if (lines.length > 0) {
      const textEl = document.createElementNS(SVG_NS, "text")

      // For "right=" positioning, text starts from the position (text-anchor: start)
      // For "left=" positioning, text ends at the position (text-anchor: end)
      const textAnchor = align === "left" ? "start" : align === "right" ? "end" : "middle"
      textEl.setAttribute("text-anchor", textAnchor)
      textEl.setAttribute("font-family", "serif")
      textEl.setAttribute("fill", label.style?.stroke || this.defaultStroke)

      // Calculate starting Y to position text block
      const startY = -((lines.length - 1) * lineHeight) / 2

      lines.forEach((line, index) => {
        const tspan = document.createElementNS(SVG_NS, "tspan")
        tspan.setAttribute("x", "0")
        tspan.setAttribute("dy", index === 0 ? startY : lineHeight)
        tspan.setAttribute("dominant-baseline", "central")
        tspan.setAttribute("font-size", line.fontSize)
        this.renderTextContent(tspan, line.content)
        textEl.appendChild(tspan)
      })

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
    // Flip Y axis: TikZ Y increases upward, SVG Y increases downward
    return (this.bounds.maxY - y) * this.scale
  }

  setScale(scale) {
    this.scale = scale
  }
}

export function render(ast, coordSystem, options = {}) {
  const renderer = new Renderer(options)
  return renderer.render(ast, coordSystem)
}
