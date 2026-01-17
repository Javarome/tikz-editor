/**
 * TikZ SVG Renderer - Converts AST to SVG elements
 */

import { NodeType } from "./parser.js"
import { parseColor, parseOptions } from "./styles.js"
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
    this.axisClipCounter = 0
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

    // Helper to update bounds for a node with its full extent, accounting for anchor
    const updateNodeBounds = (node) => {
      if (!node.position) return
      const x = node.position.x
      const y = node.position.y
      // Use measured dimensions if available, otherwise estimate from text
      const metrics = node.name ? this.nodeMetrics.get(node.name) : null
      let w, h
      if (metrics) {
        w = metrics.width
        h = metrics.height
      } else if (node.text) {
        // Estimate dimensions from text length (rough approximation)
        // Average character width ~0.12cm for serif font at default size
        const textLen = node.text.replace(/\\[a-z]+/g, "").length
        w = Math.max(node.width || 0, textLen * 0.12 + 0.3)
        h = Math.max(node.height || 0, 0.5)
      } else {
        // Empty node - size based on innerSep (default ~1mm = 0.1cm)
        const innerSep = node.innerSep || 0.1
        w = node.width || innerSep * 2
        h = node.height || innerSep * 2
      }
      const anchor = node.anchor || "center"

      // Calculate actual bounds based on anchor
      let minNodeX = x - w / 2, maxNodeX = x + w / 2
      let minNodeY = y - h / 2, maxNodeY = y + h / 2

      switch (anchor) {
        case "west":
          minNodeX = x
          maxNodeX = x + w
          break
        case "east":
          minNodeX = x - w
          maxNodeX = x
          break
        case "north":
          minNodeY = y - h
          maxNodeY = y
          break
        case "south":
          minNodeY = y
          maxNodeY = y + h
          break
        case "north west":
          minNodeX = x
          maxNodeX = x + w
          minNodeY = y - h
          maxNodeY = y
          break
        case "north east":
          minNodeX = x - w
          maxNodeX = x
          minNodeY = y - h
          maxNodeY = y
          break
        case "south west":
          minNodeX = x
          maxNodeX = x + w
          minNodeY = y
          maxNodeY = y + h
          break
        case "south east":
          minNodeX = x - w
          maxNodeX = x
          minNodeY = y
          maxNodeY = y + h
          break
      }

      updateBounds(minNodeX, minNodeY)
      updateBounds(maxNodeX, maxNodeY)
    }

    for (const command of ast.commands) {
      if (command.type === NodeType.AXIS) {
        const { width, height } = this.getAxisDimensions(command.settings || {})
        const origin = command.origin || { x: 0, y: 0 }
        const titleOffset = command.settings?.title ? 1.0 : 0
        const xLabelOffset = command.settings?.xlabel ? 0.9 : 0.6
        const yLabelOffset = command.settings?.ylabel ? 0.9 : 0.6

        updateBounds(origin.x - yLabelOffset, origin.y - xLabelOffset)
        updateBounds(origin.x + width, origin.y + height + titleOffset)
        continue
      }
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
      case NodeType.AXIS:
        return this.renderAxis(command)
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
          if (style.decorate && style.decoration?.type === "brace") {
            elements.push(this.renderBraceSegment(segment, style, strokeColor))
            if (segment.edgeLabel) {
              elements.push(...this.renderEdgeLabel(segment.from, segment.to, segment.edgeLabel))
            }
            break
          }
          // Adjust endpoints based on actual node dimensions
          // The parser pre-calculates boundary points with estimated dimensions,
          // but we recalculate using actual measured dimensions
          let fromPoint = segment.from
          let toPoint = segment.to

          // Get actual node centers from metrics (parser's segment.from/to may already be boundary points)
          const fromMetrics = segment.fromNodeName ? this.nodeMetrics.get(segment.fromNodeName) : null
          const toMetrics = segment.toNodeName ? this.nodeMetrics.get(segment.toNodeName) : null

          // Check for explicit anchor reference (e.g., node.north, node.south west)
          // Recalculate anchor position using measured dimensions
          const toAnchorMetrics = segment.toAnchorNodeName ? this.nodeMetrics.get(segment.toAnchorNodeName) : null
          const hasExplicitToAnchor = toAnchorMetrics && segment.toAnchorName
          if (hasExplicitToAnchor) {
            toPoint = this.calculateAnchorPosition(toAnchorMetrics, segment.toAnchorName)
          }

          // Use node centers for boundary calculation
          const fromCenter = fromMetrics ? fromMetrics.center : segment.from
          const toCenter = toMetrics ? toMetrics.center : segment.to

          if (segment.fromNodeName && fromMetrics) {
            fromPoint = this.getNodeBoundaryPoint(segment.fromNodeName, fromCenter, toPoint)
          }
          // Only calculate boundary point if no explicit anchor was specified
          if (segment.toNodeName && toMetrics && !hasExplicitToAnchor) {
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

  getAxisDimensions(settings) {
    const width = Number.isFinite(settings.width) ? settings.width : 10
    const height = Number.isFinite(settings.height) ? settings.height : 6
    return { width, height }
  }

  getAxisRanges(settings, plots) {
    const xRange = this.buildAxisRange(settings.xMin, settings.xMax, plots, "x")
    const yRange = this.buildAxisRange(settings.yMin, settings.yMax, plots, "y")
    return {
      x: xRange || { min: 0, max: 1 },
      y: yRange || { min: 0, max: 1 }
    }
  }

  buildAxisRange(min, max, plots, axis) {
    if (Number.isFinite(min) && Number.isFinite(max) && min !== max) {
      return { min, max }
    }

    let values = []
    for (const plot of plots || []) {
      if (plot.points) {
        for (const point of plot.points) {
          values.push(axis === "x" ? point.x : point.y)
        }
      }
    }

    if (!values.length) return null
    let rangeMin = values[0]
    let rangeMax = values[0]
    for (const value of values) {
      if (value < rangeMin) rangeMin = value
      if (value > rangeMax) rangeMax = value
    }
    if (rangeMin === rangeMax) return null
    return { min: rangeMin, max: rangeMax }
  }

  generateTicks(range, desired = 6) {
    const span = range.max - range.min
    if (!Number.isFinite(span) || span <= 0) return []
    const rawStep = span / (desired - 1)
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)))
    const steps = [1, 2, 5, 10]
    let step = steps[0] * magnitude
    for (const candidate of steps) {
      if (rawStep <= candidate * magnitude) {
        step = candidate * magnitude
        break
      }
    }
    const start = Math.ceil(range.min / step) * step
    const ticks = []
    for (let value = start; value <= range.max + step * 0.5; value += step) {
      ticks.push(Number(value.toFixed(6)))
    }
    return ticks
  }

  formatTick(value) {
    const rounded = Math.abs(value) >= 1 ? value.toFixed(2) : value.toFixed(3)
    return rounded.replace(/\.?0+$/, "")
  }

  parseStyleString(styleString) {
    if (!styleString) return {}
    const options = []
    let current = ""
    let depth = 0
    for (const char of styleString) {
      if (char === "{") {
        depth += 1
        current += char
      } else if (char === "}") {
        depth -= 1
        current += char
      } else if (char === "," && depth === 0) {
        if (current.trim()) options.push(current.trim())
        current = ""
      } else {
        current += char
      }
    }
    if (current.trim()) options.push(current.trim())
    return parseOptions(options)
  }

  parseLegendStyle(styleOptions) {
    const style = {
      anchor: "south east",
      relPos: { x: 0.98, y: 0.02 },
      draw: "#000000",
      fill: "#ffffff",
      fillOpacity: 0.9,
      textOpacity: 1,
      fontSize: 12
    }

    if (!Array.isArray(styleOptions)) return style

    for (const opt of styleOptions) {
      const eqIndex = opt.indexOf("=")
      const key = eqIndex >= 0 ? opt.slice(0, eqIndex).trim() : opt.trim()
      const value = eqIndex >= 0 ? opt.slice(eqIndex + 1).trim() : null

      if (key === "at" && value) {
        const match = value.match(/rel axis cs:\s*([-\d.]+)\s*,\s*([-\d.]+)/)
        if (match) {
          style.relPos = { x: parseFloat(match[1]), y: parseFloat(match[2]) }
        }
      } else if (key === "anchor" && value) {
        style.anchor = value
      } else if (key === "draw" && value) {
        style.draw = parseColor(value) || value
      } else if (key === "fill" && value) {
        style.fill = parseColor(value) || value
      } else if (key === "fill opacity" && value) {
        style.fillOpacity = parseFloat(value)
      } else if (key === "text opacity" && value) {
        style.textOpacity = parseFloat(value)
      } else if (key === "font" && value) {
        if (value.includes("\\small")) style.fontSize = 12
        if (value.includes("\\footnotesize")) style.fontSize = 10
        if (value.includes("\\scriptsize")) style.fontSize = 8
      }
    }

    return style
  }

  renderAxis(command) {
    const elements = []
    const settings = command.settings || {}
    const plots = command.plots || []
    const fills = command.fills || []
    const { width, height } = this.getAxisDimensions(settings)
    const origin = command.origin || { x: 0, y: 0 }
    const ranges = this.getAxisRanges(settings, plots)
    const xRange = ranges.x
    const yRange = ranges.y

    const mapX = (x) => origin.x + ((x - xRange.min) / (xRange.max - xRange.min)) * width
    const mapY = (y) => origin.y + ((y - yRange.min) / (yRange.max - yRange.min)) * height

    const xTicks = settings.xTicks || this.generateTicks(xRange, 6)
    const yTicks = settings.yTicks || this.generateTicks(yRange, 6)

    const gridStyle = this.parseStyleString(settings.majorGridStyle || settings.gridStyle)
    const gridStroke = gridStyle.stroke || parseColor("gray!40") || "#cccccc"
    const gridWidth = gridStyle.lineWidth || 0.2

    if (settings.grid && settings.grid !== "none") {
      for (const tick of xTicks) {
        const x = mapX(tick)
        const line = document.createElementNS(SVG_NS, "line")
        line.setAttribute("x1", this.toSvgX(x))
        line.setAttribute("y1", this.toSvgY(origin.y))
        line.setAttribute("x2", this.toSvgX(x))
        line.setAttribute("y2", this.toSvgY(origin.y + height))
        line.setAttribute("stroke", gridStroke)
        line.setAttribute("stroke-width", gridWidth * 2)
        elements.push(line)
      }
      for (const tick of yTicks) {
        const y = mapY(tick)
        const line = document.createElementNS(SVG_NS, "line")
        line.setAttribute("x1", this.toSvgX(origin.x))
        line.setAttribute("y1", this.toSvgY(y))
        line.setAttribute("x2", this.toSvgX(origin.x + width))
        line.setAttribute("y2", this.toSvgY(y))
        line.setAttribute("stroke", gridStroke)
        line.setAttribute("stroke-width", gridWidth * 2)
        elements.push(line)
      }
    }

    const frame = document.createElementNS(SVG_NS, "rect")
    frame.setAttribute("x", this.toSvgX(origin.x))
    frame.setAttribute("y", this.toSvgY(origin.y + height))
    frame.setAttribute("width", width * this.scale)
    frame.setAttribute("height", height * this.scale)
    frame.setAttribute("fill", "none")
    frame.setAttribute("stroke", this.defaultStroke)
    frame.setAttribute("stroke-width", 0.8)
    elements.push(frame)

    const tickSize = 0.12
    for (const tick of xTicks) {
      const x = mapX(tick)
      const line = document.createElementNS(SVG_NS, "line")
      line.setAttribute("x1", this.toSvgX(x))
      line.setAttribute("y1", this.toSvgY(origin.y))
      line.setAttribute("x2", this.toSvgX(x))
      line.setAttribute("y2", this.toSvgY(origin.y - tickSize))
      line.setAttribute("stroke", this.defaultStroke)
      line.setAttribute("stroke-width", 0.8)
      elements.push(line)

      elements.push(this.renderAxisText(this.formatTick(tick), x, origin.y - 0.35, {
        anchor: "middle"
      }))
    }

    for (const tick of yTicks) {
      const y = mapY(tick)
      const line = document.createElementNS(SVG_NS, "line")
      line.setAttribute("x1", this.toSvgX(origin.x))
      line.setAttribute("y1", this.toSvgY(y))
      line.setAttribute("x2", this.toSvgX(origin.x - tickSize))
      line.setAttribute("y2", this.toSvgY(y))
      line.setAttribute("stroke", this.defaultStroke)
      line.setAttribute("stroke-width", 0.8)
      elements.push(line)

      elements.push(this.renderAxisText(this.formatTick(tick), origin.x - 0.3, y, {
        anchor: "end"
      }))
    }

    const plotGroup = document.createElementNS(SVG_NS, "g")
    const clipId = `axis-clip-${this.axisClipCounter++}`
    const clipPath = document.createElementNS(SVG_NS, "clipPath")
    clipPath.setAttribute("id", clipId)
    const clipRect = document.createElementNS(SVG_NS, "rect")
    clipRect.setAttribute("x", this.toSvgX(origin.x))
    clipRect.setAttribute("y", this.toSvgY(origin.y + height))
    clipRect.setAttribute("width", width * this.scale)
    clipRect.setAttribute("height", height * this.scale)
    clipPath.appendChild(clipRect)
    this.defs.appendChild(clipPath)
    plotGroup.setAttribute("clip-path", `url(#${clipId})`)

    const plotByName = new Map()
    for (const plot of plots) {
      if (plot.namePath) {
        plotByName.set(plot.namePath, plot)
      }
    }

    for (const fill of fills) {
      const fromPlot = plotByName.get(fill.source)
      const toPlot = plotByName.get(fill.target)
      if (!fromPlot?.points || !toPlot?.points) continue

      const forward = fromPlot.points.map(point => ({
        x: mapX(point.x),
        y: mapY(point.y)
      }))
      const backward = [...toPlot.points].reverse().map(point => ({
        x: mapX(point.x),
        y: mapY(point.y)
      }))
      if (!forward.length || !backward.length) continue

      let pathData = ""
      forward.forEach((point, index) => {
        pathData += `${index === 0 ? "M" : "L"} ${this.toSvgX(point.x)} ${this.toSvgY(point.y)} `
      })
      backward.forEach(point => {
        pathData += `L ${this.toSvgX(point.x)} ${this.toSvgY(point.y)} `
      })
      pathData += "Z"

      const fillPath = document.createElementNS(SVG_NS, "path")
      fillPath.setAttribute("d", pathData)
      const fillStyle = fill.style || {}
      if (!fillStyle.fill) {
        fillStyle.fill = "#999999"
      }
      this.applyStyle(fillPath, fillStyle, false, true, this.defaultStroke)
      plotGroup.appendChild(fillPath)
    }

    for (const plot of plots) {
      if (!plot.points || plot.points.length === 0) continue
      let pathData = ""
      for (let i = 0; i < plot.points.length; i++) {
        const point = plot.points[i]
        const px = mapX(point.x)
        const py = mapY(point.y)
        pathData += `${i === 0 ? "M" : "L"} ${this.toSvgX(px)} ${this.toSvgY(py)} `
      }
      const path = document.createElementNS(SVG_NS, "path")
      path.setAttribute("d", pathData)
      const strokeColor = plot.style?.stroke || this.defaultStroke
      const doStroke = plot.style?.stroke !== "none"
      if (doStroke) {
        this.applyStyle(path, plot.style || {}, true, false, strokeColor)
        plotGroup.appendChild(path)
      }
    }
    elements.push(plotGroup)

    if (settings.title) {
      elements.push(this.renderAxisText(settings.title, origin.x + width / 2, origin.y + height + 0.7, {
        anchor: "middle"
      }))
    }
    if (settings.xlabel) {
      elements.push(this.renderAxisText(settings.xlabel, origin.x + width / 2, origin.y - 0.8, {
        anchor: "middle"
      }))
    }
    if (settings.ylabel) {
      elements.push(this.renderAxisText(settings.ylabel, origin.x - 0.9, origin.y + height / 2, {
        anchor: "middle",
        rotation: -90
      }))
    }

    if ((command.legendEntries || []).length > 0) {
      const legendStyle = this.parseLegendStyle(settings.legendStyle)
      if (settings.legendPos) {
        const pos = settings.legendPos.toLowerCase()
        if (pos.includes("north")) legendStyle.relPos.y = 0.98
        if (pos.includes("south")) legendStyle.relPos.y = 0.02
        if (pos.includes("east")) legendStyle.relPos.x = 0.98
        if (pos.includes("west")) legendStyle.relPos.x = 0.02
        legendStyle.anchor = pos
      }
      const legendItems = command.legendItems || null
      const legendElements = this.renderAxisLegend(command.legendEntries, plots, origin, width, height, legendStyle, legendItems)
      elements.push(...legendElements)
    }

    return elements
  }

  renderAxisText(text, x, y, { anchor = "middle", rotation = 0, fontSize = null, fill = null } = {}) {
    const group = document.createElementNS(SVG_NS, "g")
    const transform = `translate(${this.toSvgX(x)}, ${this.toSvgY(y)})` + (rotation ? ` rotate(${rotation})` : "")
    group.setAttribute("transform", transform)

    const textEl = document.createElementNS(SVG_NS, "text")
    textEl.setAttribute("text-anchor", anchor)
    textEl.setAttribute("font-family", "serif")
    textEl.setAttribute("fill", fill || this.defaultStroke)

    const { lines } = this.parseNodeText(text, fontSize)
    const lineHeight = 16 * this.fontScale
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
    return group
  }

  renderAxisLegend(entries, plots, origin, width, height, legendStyle, legendItems = null) {
    const elements = []
    const lineHeight = 0.5
    const labelPadding = 0.25
    const lineLength = 0.7
    const fontSize = legendStyle.fontSize

    let maxLabelWidth = 0
    for (const entry of entries) {
      const plain = entry.replace(/\\[a-z]+\b/g, "")
      maxLabelWidth = Math.max(maxLabelWidth, plain.length * 0.12)
    }

    const boxWidth = lineLength + labelPadding + maxLabelWidth + 0.6
    const boxHeight = entries.length * lineHeight + 0.4

    const legendX = origin.x + width * legendStyle.relPos.x
    const legendY = origin.y + height * legendStyle.relPos.y

    let boxX = legendX
    let boxY = legendY

    if (legendStyle.anchor.includes("east")) {
      boxX -= boxWidth
    } else if (!legendStyle.anchor.includes("west")) {
      boxX -= boxWidth / 2
    }
    if (legendStyle.anchor.includes("north")) {
      boxY -= boxHeight
    } else if (!legendStyle.anchor.includes("south")) {
      boxY -= boxHeight / 2
    }

    const rect = document.createElementNS(SVG_NS, "rect")
    rect.setAttribute("x", this.toSvgX(boxX))
    rect.setAttribute("y", this.toSvgY(boxY + boxHeight))
    rect.setAttribute("width", boxWidth * this.scale)
    rect.setAttribute("height", boxHeight * this.scale)
    rect.setAttribute("fill", legendStyle.fill)
    rect.setAttribute("fill-opacity", legendStyle.fillOpacity)
    rect.setAttribute("stroke", legendStyle.draw)
    rect.setAttribute("stroke-width", 0.6)
    elements.push(rect)

    entries.forEach((entry, index) => {
      const y = boxY + boxHeight - 0.3 - index * lineHeight
      const xStart = boxX + 0.3
      const xEnd = xStart + lineLength
      const legendItem = legendItems?.[index]?.item || plots[index] || {}
      if (legendItem?.type === "fillBetween") {
        const rect = document.createElementNS(SVG_NS, "rect")
        rect.setAttribute("x", this.toSvgX(xStart))
        rect.setAttribute("y", this.toSvgY(y + 0.2))
        rect.setAttribute("width", lineLength * this.scale)
        rect.setAttribute("height", 0.2 * this.scale)
        rect.setAttribute("fill", legendItem.style?.fill || "#999999")
        rect.setAttribute("fill-opacity", legendItem.style?.fillOpacity ?? 0.25)
        rect.setAttribute("stroke", legendStyle.draw)
        rect.setAttribute("stroke-width", 0.4)
        elements.push(rect)
      } else {
        const strokeColor = legendItem.style?.stroke || this.defaultStroke
        const line = document.createElementNS(SVG_NS, "line")
        line.setAttribute("x1", this.toSvgX(xStart))
        line.setAttribute("y1", this.toSvgY(y))
        line.setAttribute("x2", this.toSvgX(xEnd))
        line.setAttribute("y2", this.toSvgY(y))
        line.setAttribute("stroke", strokeColor)
        line.setAttribute("stroke-width", (legendItem.style?.lineWidth || 0.4) * 2)
        if (legendItem.style?.dashPattern) {
          line.setAttribute("stroke-dasharray", legendItem.style.dashPattern.map(v => v * 2).join(" "))
        }
        elements.push(line)
      }

      const label = this.renderAxisText(entry, xEnd + labelPadding, y, {
        anchor: "start",
        fontSize,
        fill: `rgba(0,0,0,${legendStyle.textOpacity})`
      })
      elements.push(label)
    })

    return elements
  }

  renderCircle(segment, style, doStroke, doFill, strokeColor) {
    // Check for snake decoration
    if (style.decorate && style.decoration?.type === "snake") {
      return this.renderSnakeCircle(segment, style, doStroke, doFill, strokeColor)
    }

    const circle = document.createElementNS(SVG_NS, "circle")
    circle.setAttribute("cx", this.toSvgX(segment.center.x))
    circle.setAttribute("cy", this.toSvgY(segment.center.y))
    circle.setAttribute("r", segment.radius * this.scale)
    this.applyStyle(circle, style, doStroke, doFill, strokeColor)
    return circle
  }

  renderBraceSegment(segment, style, strokeColor) {
    const from = segment.from
    const to = segment.to
    const amplitude = style.decoration?.amplitude || 0.2

    const isVertical = Math.abs(from.x - to.x) < Math.abs(from.y - to.y)
    let pathData = ""

    if (isVertical) {
      const x = from.x
      const y1 = from.y
      const y2 = to.y
      const dir = y2 >= y1 ? 1 : -1
      const length = Math.abs(y2 - y1)
      const a = amplitude * 1.8
      const q = length / 4

      pathData = [
        `M ${this.toSvgX(x)} ${this.toSvgY(y1)}`,
        `C ${this.toSvgX(x + a)} ${this.toSvgY(y1 + dir * q * 0.2)}, ${this.toSvgX(x + a)} ${this.toSvgY(y1 + dir * q * 0.8)}, ${this.toSvgX(x)} ${this.toSvgY(y1 + dir * q)}`,
        `C ${this.toSvgX(x - a)} ${this.toSvgY(y1 + dir * q * 1.2)}, ${this.toSvgX(x - a)} ${this.toSvgY(y1 + dir * q * 1.8)}, ${this.toSvgX(x - a)} ${this.toSvgY(y1 + dir * q * 2)}`,
        `C ${this.toSvgX(x - a)} ${this.toSvgY(y1 + dir * q * 2.2)}, ${this.toSvgX(x - a)} ${this.toSvgY(y1 + dir * q * 2.8)}, ${this.toSvgX(x)} ${this.toSvgY(y1 + dir * q * 3)}`,
        `C ${this.toSvgX(x + a)} ${this.toSvgY(y1 + dir * q * 3.2)}, ${this.toSvgX(x + a)} ${this.toSvgY(y1 + dir * q * 3.8)}, ${this.toSvgX(x)} ${this.toSvgY(y2)}`
      ].join(" ")
    } else {
      const y = from.y
      const x1 = from.x
      const x2 = to.x
      const dir = x2 >= x1 ? 1 : -1
      const length = Math.abs(x2 - x1)
      const a = amplitude * 1.8
      const q = length / 4

      pathData = [
        `M ${this.toSvgX(x1)} ${this.toSvgY(y)}`,
        `C ${this.toSvgX(x1 + dir * q * 0.2)} ${this.toSvgY(y + a)}, ${this.toSvgX(x1 + dir * q * 0.8)} ${this.toSvgY(y + a)}, ${this.toSvgX(x1 + dir * q)} ${this.toSvgY(y)}`,
        `C ${this.toSvgX(x1 + dir * q * 1.2)} ${this.toSvgY(y - a)}, ${this.toSvgX(x1 + dir * q * 1.8)} ${this.toSvgY(y - a)}, ${this.toSvgX(x1 + dir * q * 2)} ${this.toSvgY(y)}`,
        `C ${this.toSvgX(x1 + dir * q * 2.2)} ${this.toSvgY(y - a)}, ${this.toSvgX(x1 + dir * q * 2.8)} ${this.toSvgY(y - a)}, ${this.toSvgX(x1 + dir * q * 3)} ${this.toSvgY(y)}`,
        `C ${this.toSvgX(x1 + dir * q * 3.2)} ${this.toSvgY(y + a)}, ${this.toSvgX(x1 + dir * q * 3.8)} ${this.toSvgY(y + a)}, ${this.toSvgX(x2)} ${this.toSvgY(y)}`
      ].join(" ")
    }

    const path = document.createElementNS(SVG_NS, "path")
    path.setAttribute("d", pathData)
    this.applyStyle(path, style, true, false, strokeColor)
    return path
  }

  /**
   * Render a circle with snake (wavy) decoration
   */
  renderSnakeCircle(segment, style, doStroke, doFill, strokeColor) {
    const cx = segment.center.x
    const cy = segment.center.y
    const r = segment.radius

    // amplitude in cm (0.5mm = 0.05cm)
    const amplitude = style.decoration?.amplitude || 0.05
    // segment length in cm (default ~3mm = 0.3cm for snake)
    const segmentLength = style.decoration?.segmentLength || 0.3

    // Calculate circumference in cm
    const circumference = 2 * Math.PI * r

    // Number of complete waves around the circle
    // Each wave is one segment length (half-wave = half segment)
    const numWaves = Math.max(20, Math.round(circumference / segmentLength))

    // High resolution for smooth curves
    const pointsPerWave = 12
    const numPoints = numWaves * pointsPerWave

    // Generate wavy path
    let pathData = ""
    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints
      const angle = t * 2 * Math.PI
      // Wave oscillates with numWaves complete cycles
      const wavePhase = t * numWaves * 2 * Math.PI
      const waveOffset = amplitude * Math.sin(wavePhase)

      // Point on the circle with radial perturbation
      const px = cx + (r + waveOffset) * Math.cos(angle)
      const py = cy + (r + waveOffset) * Math.sin(angle)

      const svgX = this.toSvgX(px)
      const svgY = this.toSvgY(py)

      if (i === 0) {
        pathData += `M ${svgX} ${svgY} `
      } else {
        pathData += `L ${svgX} ${svgY} `
      }
    }
    pathData += "Z"

    const path = document.createElementNS(SVG_NS, "path")
    path.setAttribute("d", pathData)
    this.applyStyle(path, style, doStroke, doFill, strokeColor)
    return path
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
    const { position, text, shape, width, height, innerSep, draw, fill, style, align, fontSize, anchor, rotate } = node

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

    // Calculate anchor offset - position the anchor point of the node at the given position
    // For text-only nodes, use smaller offsets (just text bounds + small gap)
    // For nodes with shapes, use full node dimensions
    let anchorOffsetX = 0
    let anchorOffsetY = 0
    const nodeAnchor = anchor || "center"
    const hasShape = draw || fill

    // Use text dimensions for text-only nodes, node dimensions for shaped nodes
    const anchorWidth = hasShape ? nodeWidth : textBBox.width
    const anchorHeight = hasShape ? nodeHeight : textBBox.height
    const smallGap = 3 * this.fontScale  // Small gap between text and anchor point

    switch (nodeAnchor) {
      case "west":
        // West (left) side at position - move node right
        anchorOffsetX = anchorWidth / 2 + (hasShape ? 0 : smallGap)
        break
      case "east":
        // East (right) side at position - move node left
        anchorOffsetX = -(anchorWidth / 2 + (hasShape ? 0 : smallGap))
        break
      case "north":
        // North (top) side at position - move node down (positive in SVG)
        anchorOffsetY = anchorHeight / 2 + (hasShape ? 0 : smallGap)
        break
      case "south":
        // South (bottom) side at position - move node up (negative in SVG)
        anchorOffsetY = -(anchorHeight / 2 + (hasShape ? 0 : smallGap))
        break
      case "north west":
        anchorOffsetX = anchorWidth / 2 + (hasShape ? 0 : smallGap)
        anchorOffsetY = anchorHeight / 2 + (hasShape ? 0 : smallGap)
        break
      case "north east":
        anchorOffsetX = -(anchorWidth / 2 + (hasShape ? 0 : smallGap))
        anchorOffsetY = anchorHeight / 2 + (hasShape ? 0 : smallGap)
        break
      case "south west":
        anchorOffsetX = anchorWidth / 2 + (hasShape ? 0 : smallGap)
        anchorOffsetY = -(anchorHeight / 2 + (hasShape ? 0 : smallGap))
        break
      case "south east":
        anchorOffsetX = -(anchorWidth / 2 + (hasShape ? 0 : smallGap))
        anchorOffsetY = -(anchorHeight / 2 + (hasShape ? 0 : smallGap))
        break
      // "center" - no offset needed
    }

    const group = document.createElementNS(SVG_NS, "g")
    // Apply translation and optional rotation
    let transform = `translate(${this.toSvgX(position.x) + anchorOffsetX}, ${this.toSvgY(position.y) + anchorOffsetY})`
    if (rotate) {
      // TikZ rotation is counter-clockwise, SVG is clockwise, so negate the angle
      transform += ` rotate(${-rotate})`
    }
    group.setAttribute("transform", transform)

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

      // Strip LaTeX vertical spacing commands like [-2pt] or [5mm] at start of line
      content = content.replace(/^\[-?\d+\.?\d*(pt|mm|cm|ex|em)?\]\s*/i, "")

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
   * Render math content using a recursive parser to handle nested subscripts/superscripts
   */
  renderMath(mathContent) {
    const container = document.createElementNS(SVG_NS, "tspan")
    this.parseMathExpression(mathContent, container, "italic")
    return container
  }

  /**
   * Recursively parse and render a math expression
   */
  parseMathExpression(expr, parent, defaultStyle) {
    let i = 0
    let textBuffer = ""

    const flushText = (style) => {
      if (textBuffer) {
        const span = document.createElementNS(SVG_NS, "tspan")
        span.setAttribute("font-style", style)
        span.textContent = textBuffer
        parent.appendChild(span)
        textBuffer = ""
      }
    }

    while (i < expr.length) {
      if (expr[i] === "\\") {
        // Handle LaTeX commands
        const cmdMatch = expr.slice(i).match(/^\\([a-zA-Z]+)/)
        if (cmdMatch) {
          const cmd = cmdMatch[1]
          i += cmdMatch[0].length

          // Check for commands that take a braced argument
          if (cmd === "mathrm" && expr[i] === "{") {
            flushText(defaultStyle)
            const end = this.findMatchingBrace(expr, i)
            const content = expr.slice(i + 1, end)
            // mathrm content is rendered in roman (normal) style, recursively parsed
            this.parseMathExpression(content, parent, "normal")
            i = end + 1
          } else if (cmd === "mathcal" && expr[i] === "{") {
            flushText(defaultStyle)
            const end = this.findMatchingBrace(expr, i)
            const content = expr.slice(i + 1, end)
            textBuffer = this.toMathCaligraphic(content)
            flushText(defaultStyle)
            i = end + 1
          } else if (cmd === "displaystyle" || cmd === "textstyle" || cmd === "scriptstyle") {
            flushText(defaultStyle)
          } else if (cmd === "sqrt" && expr[i] === "{") {
            flushText(defaultStyle)
            const end = this.findMatchingBrace(expr, i)
            const content = expr.slice(i + 1, end)
            const sqrtSpan = document.createElementNS(SVG_NS, "tspan")
            sqrtSpan.textContent = "√"
            parent.appendChild(sqrtSpan)

            const barSpan = document.createElementNS(SVG_NS, "tspan")
            barSpan.setAttribute("dy", "-0.4em")
            barSpan.setAttribute("font-size", "70%")
            const barLength = Math.max(1, this.stripMathText(content).length)
            barSpan.textContent = "‾".repeat(barLength)
            parent.appendChild(barSpan)

            const contentSpan = document.createElementNS(SVG_NS, "tspan")
            contentSpan.setAttribute("dy", "0.4em")
            this.parseMathExpression(content, contentSpan, defaultStyle)
            parent.appendChild(contentSpan)
            i = end + 1
          } else if (cmd === "frac" && expr[i] === "{") {
            flushText(defaultStyle)
            const numEnd = this.findMatchingBrace(expr, i)
            const numerator = expr.slice(i + 1, numEnd)
            let j = numEnd + 1
            if (expr[j] === "{") {
              const denEnd = this.findMatchingBrace(expr, j)
              const denominator = expr.slice(j + 1, denEnd)
              const numLen = this.stripMathText(numerator).length
              const denLen = this.stripMathText(denominator).length
              const barLength = Math.max(1, Math.max(numLen, denLen))

              const numSpan = document.createElementNS(SVG_NS, "tspan")
              numSpan.setAttribute("dy", "-0.6em")
              numSpan.setAttribute("font-size", "70%")
              this.parseMathExpression(numerator, numSpan, defaultStyle)
              parent.appendChild(numSpan)

              const barSpan = document.createElementNS(SVG_NS, "tspan")
              barSpan.setAttribute("dy", "0.4em")
              barSpan.setAttribute("font-size", "70%")
              barSpan.setAttribute("dx", `${-numLen * 0.6}em`)
              barSpan.textContent = "―".repeat(barLength)
              parent.appendChild(barSpan)

              const denSpan = document.createElementNS(SVG_NS, "tspan")
              denSpan.setAttribute("dy", "0.6em")
              denSpan.setAttribute("font-size", "70%")
              denSpan.setAttribute("dx", `${-barLength * 0.6}em`)
              this.parseMathExpression(denominator, denSpan, defaultStyle)
              parent.appendChild(denSpan)
              i = denEnd + 1
            } else {
              this.parseMathExpression(numerator, parent, defaultStyle)
              i = numEnd + 1
            }
          } else {
            // Replace known commands with symbols
            const symbol = this.latexSymbol(cmd)
            if (symbol) {
              textBuffer += symbol
            } else {
              textBuffer += "\\" + cmd // Unknown command, keep as-is
            }
          }
        } else {
          textBuffer += expr[i]
          i++
        }
      } else if (expr[i] === "_") {
        // Subscript
        flushText(defaultStyle)
        i++
        const subSpan = document.createElementNS(SVG_NS, "tspan")
        subSpan.setAttribute("baseline-shift", "sub")
        subSpan.setAttribute("font-size", "70%")

        if (i < expr.length && expr[i] === "{") {
          const end = this.findMatchingBrace(expr, i)
          const content = expr.slice(i + 1, end)
          this.parseMathExpression(content, subSpan, defaultStyle)
          i = end + 1
        } else if (i < expr.length) {
          // Single character subscript
          const charSpan = document.createElementNS(SVG_NS, "tspan")
          charSpan.setAttribute("font-style", defaultStyle)
          charSpan.textContent = expr[i]
          subSpan.appendChild(charSpan)
          i++
        }
        parent.appendChild(subSpan)
      } else if (expr[i] === "^") {
        // Superscript
        flushText(defaultStyle)
        i++
        const supSpan = document.createElementNS(SVG_NS, "tspan")
        supSpan.setAttribute("baseline-shift", "super")
        supSpan.setAttribute("font-size", "70%")

        if (i < expr.length && expr[i] === "{") {
          const end = this.findMatchingBrace(expr, i)
          const content = expr.slice(i + 1, end)
          this.parseMathExpression(content, supSpan, defaultStyle)
          i = end + 1
        } else if (i < expr.length) {
          // Single character superscript
          const charSpan = document.createElementNS(SVG_NS, "tspan")
          charSpan.setAttribute("font-style", defaultStyle)
          charSpan.textContent = expr[i]
          supSpan.appendChild(charSpan)
          i++
        }
        parent.appendChild(supSpan)
      } else if (expr[i] === "{") {
        // Grouped content - parse recursively
        flushText(defaultStyle)
        const end = this.findMatchingBrace(expr, i)
        const content = expr.slice(i + 1, end)
        this.parseMathExpression(content, parent, defaultStyle)
        i = end + 1
      } else if (expr[i] === "}") {
        // Stray closing brace - skip
        i++
      } else {
        // Regular character
        textBuffer += expr[i]
        i++
      }
    }

    flushText(defaultStyle)
  }

  stripMathText(text) {
    return text.replace(/\\[a-zA-Z]+/g, "").replace(/[{}]/g, "").trim()
  }

  /**
   * Find the position of the matching closing brace
   */
  findMatchingBrace(str, openPos) {
    let depth = 1
    let i = openPos + 1
    while (i < str.length && depth > 0) {
      if (str[i] === "{") depth++
      else if (str[i] === "}") depth--
      i++
    }
    return i - 1
  }

  /**
   * Convert a LaTeX command name to its symbol
   */
  latexSymbol(cmd) {
    const symbols = {
      // Greek letters
      chi: "χ", alpha: "α", beta: "β", gamma: "γ", delta: "δ",
      epsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", iota: "ι",
      kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ",
      pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ",
      phi: "φ", psi: "ψ", omega: "ω",
      Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ",
      Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
      // Symbols
      infty: "∞", sum: "∑", prod: "∏", int: "∫",
      partial: "∂", nabla: "∇", times: "×", cdot: "·",
      pm: "±", mp: "∓", leq: "≤", geq: "≥", neq: "≠",
      approx: "≈", equiv: "≡", rightarrow: "→", leftarrow: "←",
      Rightarrow: "⇒", Leftarrow: "⇐", simeq: "≃",
      otimes: "⊗", oplus: "⊕", subset: "⊂", supset: "⊃",
      subseteq: "⊆", supseteq: "⊇", in: "∈", notin: "∉",
      forall: "∀", exists: "∃", neg: "¬", land: "∧", lor: "∨",
      hbar: "ℏ", to: "→", mapsto: "↦", sim: "∼", propto: "∝",
      // Spacing (ignore)
      ",": "", ";": " ", "!": "", quad: "  ", qquad: "    ",
      // Misc
      log: "log", sin: "sin", cos: "cos", tan: "tan",
      exp: "exp", ln: "ln", lim: "lim", max: "max", min: "min"
    }
    return symbols[cmd] || null
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
    if (doFill) {
      // Use explicit fill color if set, otherwise use stroke color for filldraw
      let fillColor
      if (style.fill && style.fill !== "none") {
        fillColor = parseColor(style.fill) || style.fill
      } else {
        // For filldraw with only a color specified, use that color for fill
        fillColor = strokeColor
      }
      element.setAttribute("fill", fillColor)

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

  /**
   * Calculate anchor position using measured node dimensions
   * @param {Object} metrics - Node metrics from nodeMetrics Map {center, width, height, shape}
   * @param {string} anchorName - Anchor name (north, south, east, west, north west, etc.)
   * @returns {Object} Point with x, y coordinates
   */
  calculateAnchorPosition(metrics, anchorName) {
    const center = metrics.center
    const hw = metrics.width / 2
    const hh = metrics.height / 2
    const shape = metrics.shape || "rectangle"

    // Normalize anchor name (handle both "north west" and "northwest")
    const normalizedAnchor = anchorName.toLowerCase().replace(/\s+/g, " ").trim()

    switch (normalizedAnchor) {
      case "center":
        return { x: center.x, y: center.y }
      case "north":
        return { x: center.x, y: center.y + hh }
      case "south":
        return { x: center.x, y: center.y - hh }
      case "east":
        return { x: center.x + hw, y: center.y }
      case "west":
        return { x: center.x - hw, y: center.y }
      case "north east":
      case "northeast":
        if (shape === "circle") {
          const r = Math.max(hw, hh)
          const diag = r * Math.SQRT1_2
          return { x: center.x + diag, y: center.y + diag }
        }
        return { x: center.x + hw, y: center.y + hh }
      case "north west":
      case "northwest":
        if (shape === "circle") {
          const r = Math.max(hw, hh)
          const diag = r * Math.SQRT1_2
          return { x: center.x - diag, y: center.y + diag }
        }
        return { x: center.x - hw, y: center.y + hh }
      case "south east":
      case "southeast":
        if (shape === "circle") {
          const r = Math.max(hw, hh)
          const diag = r * Math.SQRT1_2
          return { x: center.x + diag, y: center.y - diag }
        }
        return { x: center.x + hw, y: center.y - hh }
      case "south west":
      case "southwest":
        if (shape === "circle") {
          const r = Math.max(hw, hh)
          const diag = r * Math.SQRT1_2
          return { x: center.x - diag, y: center.y - diag }
        }
        return { x: center.x - hw, y: center.y - hh }
      default:
        // Unknown anchor, return center
        return { x: center.x, y: center.y }
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
