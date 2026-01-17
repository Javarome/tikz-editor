import { parseOptions } from "../styles.js"
import { Point } from "../coordinates.js"

const LINEWIDTH_CM = 10

const parseLength = (value) => {
  if (!value) return null
  const trimmed = value.trim()
  const linewidthMatch = trimmed.match(/^(-?\d+\.?\d*)?\s*\\linewidth$/)
  if (linewidthMatch) {
    const factor = linewidthMatch[1] ? parseFloat(linewidthMatch[1]) : 1
    return Number.isFinite(factor) ? factor * LINEWIDTH_CM : LINEWIDTH_CM
  }

  const parsed = parseFloat(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

const parseRange = (min, max) => {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return null
  return { min, max }
}

const computeRange = (values) => {
  if (!values.length) return null
  let min = values[0]
  let max = values[0]
  for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
  }
  return parseRange(min, max)
}

const stripBraces = (value) => {
  if (!value) return value
  const trimmed = value.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

const splitNestedOptions = (value) => {
  const options = []
  let current = ""
  let depth = 0

  for (const char of value) {
    if (char === "{") {
      depth += 1
      current += char
    } else if (char === "}") {
      depth -= 1
      current += char
    } else if (char === "," && depth === 0) {
      if (current.trim()) {
        options.push(current.trim())
      }
      current = ""
    } else {
      current += char
    }
  }

  if (current.trim()) {
    options.push(current.trim())
  }

  return options
}

const parseTickList = (value) => {
  const trimmed = stripBraces(value)
  if (!trimmed) return null
  return trimmed.split(",").map(entry => parseFloat(entry.trim())).filter(v => Number.isFinite(v))
}

const buildAxisSettings = (parser, options) => {
  const settings = {
    width: null,
    height: null,
    xMin: null,
    xMax: null,
    yMin: null,
    yMax: null,
    domain: null,
    samples: null,
    xTicks: null,
    yTicks: null,
    title: null,
    xlabel: null,
    ylabel: null,
    grid: null,
    gridStyle: null,
    majorGridStyle: null,
    legendStyle: null,
    legendPos: null
  }

  for (const opt of options) {
    const [key, value] = parser.parseOptionKeyValue(opt)
    switch (key) {
      case "width":
        settings.width = parseLength(value)
        break
      case "height":
        settings.height = parseLength(value)
        break
      case "xmin":
        settings.xMin = parseFloat(value)
        break
      case "xmax":
        settings.xMax = parseFloat(value)
        break
      case "ymin":
        settings.yMin = parseFloat(value)
        break
      case "ymax":
        settings.yMax = parseFloat(value)
        break
      case "domain": {
        const match = value?.match(/^(-?\d+\.?\d*)\s*:\s*(-?\d+\.?\d*)$/)
        if (match) {
          settings.domain = { min: parseFloat(match[1]), max: parseFloat(match[2]) }
        }
        break
      }
      case "samples":
        settings.samples = parseInt(value, 10)
        break
      case "xtick":
        settings.xTicks = parseTickList(value)
        break
      case "ytick":
        settings.yTicks = parseTickList(value)
        break
      case "title":
        settings.title = stripBraces(value)
        break
      case "xlabel":
        settings.xlabel = stripBraces(value)
        break
      case "ylabel":
        settings.ylabel = stripBraces(value)
        break
      case "grid":
        settings.grid = value
        break
      case "grid style":
        settings.gridStyle = stripBraces(value)
        break
      case "major grid style":
        settings.majorGridStyle = stripBraces(value)
        break
      case "legend style":
        settings.legendStyle = splitNestedOptions(stripBraces(value))
        break
      case "legend pos":
        settings.legendPos = value
        break
      default:
        break
    }
  }

  return settings
}

const parsePlotOptions = (parser, options) => {
  let domain = null
  let samples = null
  let namePath = null

  for (const opt of options) {
    const [key, value] = parser.parseOptionKeyValue(opt)
    if (key === "domain" && value) {
      const match = value.match(/^(-?\d+\.?\d*)\s*:\s*(-?\d+\.?\d*)$/)
      if (match) {
        domain = {
          min: parseFloat(match[1]),
          max: parseFloat(match[2])
        }
      }
    } else if (key === "samples" && value) {
      const parsed = parseInt(value, 10)
      if (Number.isFinite(parsed)) {
        samples = parsed
      }
    } else if (key === "name path" && value) {
      namePath = value
    }
  }

  return { domain, samples, namePath }
}

const parseFillBetween = (parser, style, TokenType) => {
  if (!parser.peek() || parser.peek().type !== TokenType.IDENTIFIER) {
    return null
  }
  const first = parser.peek()
  if (first.value !== "fill") return null

  parser.advance()
  if (parser.peek()?.type !== TokenType.IDENTIFIER || parser.peek().value !== "between") {
    return null
  }
  parser.advance()

  const options = parser.parseOptionsBlock()
  let source = null
  let target = null
  for (const opt of options) {
    const [key, value] = parser.parseOptionKeyValue(opt)
    if (key === "of" && value) {
      const parts = value.split("and").map(part => part.trim()).filter(Boolean)
      if (parts.length >= 2) {
        source = parts[0]
        target = parts[1]
      }
    }
  }

  parser.match(TokenType.SEMICOLON)

  if (!source || !target) return null
  return { type: "fillBetween", source, target, style }
}

const parseAddPlot = (parser, axisSettings, deps) => {
  const { TokenType } = deps

  parser.advance() // consume \addplot

  if (parser.match(TokenType.PLUS)) {
    // Ignore the '+' in \addplot+
  }

  const options = parser.parseOptionsBlock()
  const style = parseOptions(options)
  const { domain: domainFromOptions, samples: samplesFromOptions, namePath } = parsePlotOptions(parser, options)

  const fillBetween = parseFillBetween(parser, style, TokenType)
  if (fillBetween) {
    return fillBetween
  }

  let expression = null
  if (parser.peek()?.type === TokenType.STRING) {
    expression = parser.advance().value
  }

  parser.match(TokenType.SEMICOLON)

  if (!expression) {
    return null
  }

  const domain = domainFromOptions || axisSettings.domain || parseRange(axisSettings.xMin, axisSettings.xMax) || {
    min: 0,
    max: 1
  }
  const samples = samplesFromOptions || axisSettings.samples || 100
  const step = (domain.max - domain.min) / Math.max(1, samples - 1)

  const points = []
  for (let i = 0; i < samples; i++) {
    const x = domain.min + i * step
    const y = parser.evaluateExpression(expression, "x", x)
    points.push(new Point(x, y))
  }

  return { type: "plot", style, options, domain, samples, expression, points, namePath }
}

const parseAxisContent = (parser, axisSettings, deps) => {
  const { TokenType } = deps
  const plots = []
  const legendEntries = []
  const legendItems = []
  const fills = []
  let lastItem = null

  while (parser.peek()?.type !== TokenType.EOF) {
    const token = parser.peek()

    if (token?.type === TokenType.COMMAND && token.value === "\\end") {
      parser.advance()
      if (parser.peek()?.type === TokenType.STRING) {
        const envName = parser.advance().value
        if (envName === "axis") {
          break
        }
      }
      continue
    }

    if (token?.type === TokenType.COMMAND && token.value === "\\addplot") {
      const plot = parseAddPlot(parser, axisSettings, deps)
      if (plot) {
        if (plot.type === "fillBetween") {
          fills.push(plot)
          lastItem = plot
        } else {
          plots.push(plot)
          lastItem = plot
        }
      }
      continue
    }

    if (token?.type === TokenType.COMMAND && token.value === "\\addlegendentry") {
      parser.advance()
      if (parser.peek()?.type === TokenType.STRING) {
        const text = parser.advance().value
        legendEntries.push(text)
        legendItems.push({ text, item: lastItem })
      }
      parser.match(TokenType.SEMICOLON)
      continue
    }

    parser.advance()
  }

  return { plots, legendEntries, legendItems, fills }
}

export function createPgfplotsModule(deps) {
  const { TokenType, NodeType, ASTNode } = deps

  return {
    name: "pgfplots",
    parseBegin(parser, envName) {
      if (envName !== "axis") return null

      const axisOptions = parser.parseOptionsBlock()
      const axisSettings = buildAxisSettings(parser, axisOptions)
      const { plots, legendEntries, legendItems, fills } = parseAxisContent(parser, axisSettings, deps)

      return new ASTNode(NodeType.AXIS, {
        options: axisOptions,
        settings: axisSettings,
        plots,
        legendEntries,
        legendItems,
        fills
      })
    }
  }
}
