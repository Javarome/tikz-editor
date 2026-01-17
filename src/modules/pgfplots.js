import { parseOptions } from "../styles.js"
import { Point } from "../coordinates.js"

const parseLength = (value) => {
  if (!value) return null
  const parsed = parseFloat(value)
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
    xTicks: null,
    yTicks: null,
    title: null,
    xlabel: null,
    ylabel: null,
    grid: null,
    gridStyle: null,
    majorGridStyle: null,
    legendStyle: null
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
      default:
        break
    }
  }

  return settings
}

const parsePlotOptions = (parser, options) => {
  let domain = null
  let samples = null

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
    }
  }

  return { domain, samples }
}

const parseAddPlot = (parser, axisSettings, deps) => {
  const { TokenType } = deps

  parser.advance() // consume \addplot

  const options = parser.parseOptionsBlock()
  const style = parseOptions(options)
  const { domain: domainFromOptions, samples: samplesFromOptions } = parsePlotOptions(parser, options)

  let expression = null
  if (parser.peek()?.type === TokenType.STRING) {
    expression = parser.advance().value
  }

  parser.match(TokenType.SEMICOLON)

  if (!expression) {
    return null
  }

  const domain = domainFromOptions || parseRange(axisSettings.xMin, axisSettings.xMax) || { min: 0, max: 1 }
  const samples = samplesFromOptions || 100
  const step = (domain.max - domain.min) / Math.max(1, samples - 1)

  const points = []
  for (let i = 0; i < samples; i++) {
    const x = domain.min + i * step
    const y = parser.evaluateExpression(expression, "x", x)
    points.push(new Point(x, y))
  }

  return { style, options, domain, samples, expression, points }
}

const parseAxisContent = (parser, axisSettings, deps) => {
  const { TokenType } = deps
  const plots = []
  const legendEntries = []

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
        plots.push(plot)
      }
      continue
    }

    if (token?.type === TokenType.COMMAND && token.value === "\\addlegendentry") {
      parser.advance()
      if (parser.peek()?.type === TokenType.STRING) {
        legendEntries.push(parser.advance().value)
      }
      parser.match(TokenType.SEMICOLON)
      continue
    }

    parser.advance()
  }

  return { plots, legendEntries }
}

export function createPgfplotsModule(deps) {
  const { TokenType, NodeType, ASTNode } = deps

  return {
    name: "pgfplots",
    parseBegin(parser, envName) {
      if (envName !== "axis") return null

      const axisOptions = parser.parseOptionsBlock()
      const axisSettings = buildAxisSettings(parser, axisOptions)
      const { plots, legendEntries } = parseAxisContent(parser, axisSettings, deps)

      return new ASTNode(NodeType.AXIS, {
        options: axisOptions,
        settings: axisSettings,
        plots,
        legendEntries
      })
    }
  }
}
