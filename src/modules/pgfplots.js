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

const buildAxisSettings = (parser, options) => {
  const settings = {
    width: null,
    height: null,
    xMin: null,
    xMax: null,
    yMin: null,
    yMax: null
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

const scalePointsToAxis = (points, axisSettings, domain) => {
  const xRange = parseRange(axisSettings.xMin, axisSettings.xMax) || domain
  const yRange = parseRange(axisSettings.yMin, axisSettings.yMax) || computeRange(points.map(pt => pt.y))

  if (!xRange || !yRange) return points

  const width = Number.isFinite(axisSettings.width) ? axisSettings.width : (xRange.max - xRange.min)
  const height = Number.isFinite(axisSettings.height) ? axisSettings.height : (yRange.max - yRange.min)

  if (!Number.isFinite(width) || !Number.isFinite(height) || width === 0 || height === 0) {
    return points
  }

  const xScale = width / (xRange.max - xRange.min)
  const yScale = height / (yRange.max - yRange.min)

  return points.map(point => new Point(
    (point.x - xRange.min) * xScale,
    (point.y - yRange.min) * yScale
  ))
}

const parseAddPlot = (parser, axisSettings, deps) => {
  const { TokenType, NodeType, ASTNode } = deps

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

  const scaledPoints = scalePointsToAxis(points, axisSettings, domain)
  const plotSegment = new ASTNode(NodeType.PLOT_SEGMENT, {
    from: scaledPoints[0] || new Point(0, 0),
    points: scaledPoints,
    domain,
    samples,
    expression
  })

  return new ASTNode(NodeType.DRAW, { style, segments: [plotSegment], options })
}

const parseAxisContent = (parser, axisSettings, deps) => {
  const { TokenType } = deps
  const commands = []

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
      const plotCommand = parseAddPlot(parser, axisSettings, deps)
      if (plotCommand) {
        commands.push(plotCommand)
      }
      continue
    }

    if (token?.type === TokenType.COMMAND && token.value === "\\addlegendentry") {
      parser.advance()
      if (parser.peek()?.type === TokenType.STRING) {
        parser.advance()
      }
      parser.match(TokenType.SEMICOLON)
      continue
    }

    parser.advance()
  }

  return commands
}

export function createPgfplotsModule(deps) {
  const { TokenType, NodeType, ASTNode } = deps

  return {
    name: "pgfplots",
    parseBegin(parser, envName) {
      if (envName !== "axis") return null

      const axisOptions = parser.parseOptionsBlock()
      const axisSettings = buildAxisSettings(parser, axisOptions)
      const commands = parseAxisContent(parser, axisSettings, deps)

      if (commands.length > 0) {
        return { type: "FOREACH_RESULT", commands }
      }

      return new ASTNode(NodeType.AXIS, { options: axisOptions, settings: axisSettings })
    }
  }
}
