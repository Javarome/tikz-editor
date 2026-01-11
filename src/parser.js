/**
 * TikZ Parser - Builds AST from tokens
 */

import { Lexer, TokenType } from "./lexer.js"
import { CoordinateSystem, parseCoordinateToken, Point } from "./coordinates.js"
import { parseOptions } from "./styles.js"

// AST Node Types
export const NodeType = {
  DOCUMENT: "DOCUMENT",
  DRAW: "DRAW",
  FILL: "FILL",
  FILLDRAW: "FILLDRAW",
  PATH: "PATH",
  NODE: "NODE",
  COORDINATE: "COORDINATE",
  LINE_SEGMENT: "LINE_SEGMENT",
  CURVE_SEGMENT: "CURVE_SEGMENT",
  ARC_SEGMENT: "ARC_SEGMENT",
  CIRCLE: "CIRCLE",
  ELLIPSE: "ELLIPSE",
  RECTANGLE: "RECTANGLE",
  GRID: "GRID",
  CYCLE: "CYCLE"
}

export class ASTNode {
  constructor(type, data = {}) {
    this.type = type
    Object.assign(this, data)
  }
}

export class Parser {
  constructor(input) {
    this.lexer = new Lexer(input)
    this.tokens = this.lexer.tokenize()
    this.position = 0
    this.coordSystem = new CoordinateSystem()
    this.styles = new Map() // Style registry for .style definitions
    this.errors = []
  }

  peek(offset = 0) {
    const index = this.position + offset
    return index < this.tokens.length ? this.tokens[index] : null
  }

  advance() {
    return this.tokens[this.position++]
  }

  expect(type) {
    const token = this.peek()
    if (!token || token.type !== type) {
      this.errors.push({
        message: `Expected ${type} but got ${token ? token.type : "EOF"}`,
        position: token ? token.position : { line: 0, column: 0 }
      })
      return null
    }
    return this.advance()
  }

  match(type) {
    if (this.peek()?.type === type) {
      return this.advance()
    }
    return null
  }

  parse() {
    const document = new ASTNode(NodeType.DOCUMENT, { commands: [] })

    while (this.peek()?.type !== TokenType.EOF) {
      try {
        const command = this.parseCommand()
        if (command) {
          document.commands.push(command)
        }
      } catch (e) {
        this.errors.push({
          message: e.message,
          position: this.peek()?.position || { line: 0, column: 0 }
        })
        // Skip to next semicolon or EOF
        while (this.peek()?.type !== TokenType.SEMICOLON && this.peek()?.type !== TokenType.EOF) {
          this.advance()
        }
        this.match(TokenType.SEMICOLON)
      }
    }

    return { ast: document, errors: this.errors, coordSystem: this.coordSystem }
  }

  parseCommand() {
    const token = this.peek()

    if (token?.type !== TokenType.COMMAND) {
      // Skip unknown tokens
      this.advance()
      return null
    }

    switch (token.value) {
      case "\\draw":
        return this.parseDrawCommand(NodeType.DRAW)
      case "\\fill":
        return this.parseDrawCommand(NodeType.FILL)
      case "\\filldraw":
        return this.parseDrawCommand(NodeType.FILLDRAW)
      case "\\path":
        return this.parseDrawCommand(NodeType.PATH)
      case "\\node":
        return this.parseNodeCommand()
      case "\\coordinate":
        return this.parseCoordinateCommand()
      case "\\begin":
        return this.parseBegin()
      case "\\end":
        return this.parseEnd()
      default:
        // Unknown command, skip
        this.advance()
        return null
    }
  }

  parseBegin() {
    this.advance() // consume \begin

    // Expect {tikzpicture}
    if (this.peek()?.type === TokenType.STRING) {
      const envName = this.advance().value
      if (envName === "tikzpicture") {
        // Parse picture options with style definitions
        const options = this.parseOptionsBlock()
        this.parsePictureOptions(options)
      }
    }

    return null // \begin doesn't produce an AST node
  }

  parseEnd() {
    this.advance() // consume \end

    // Expect {tikzpicture}
    if (this.peek()?.type === TokenType.STRING) {
      this.advance() // consume environment name
    }

    return null // \end doesn't produce an AST node
  }

  parsePictureOptions(options) {
    for (const opt of options) {
      // Check for style definition: name/.style={...}
      const styleMatch = opt.match(/^([a-zA-Z][a-zA-Z0-9-]*)\/\.style\s*=\s*\{(.+)\}$/s)
      if (styleMatch) {
        const styleName = styleMatch[1]
        const styleValue = styleMatch[2]
        // Parse the style value into individual options
        const styleOptions = this.parseStyleValue(styleValue)
        this.styles.set(styleName, styleOptions)
      }
    }
  }

  parseStyleValue(value) {
    // Split by commas, handling nested braces
    const options = []
    let current = ""
    let depth = 0

    for (const char of value) {
      if (char === "{") {
        depth++
        current += char
      } else if (char === "}") {
        depth--
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

  parseDrawCommand(type) {
    this.advance() // consume command

    const options = this.parseOptionsBlock()
    const style = parseOptions(options)
    const segments = this.parsePath()

    this.match(TokenType.SEMICOLON)

    return new ASTNode(type, { style, segments, options })
  }

  parseNodeCommand() {
    this.advance() // consume \node

    const options = this.parseOptionsBlock()
    const style = parseOptions(options)

    // Parse node name if present: (name)
    let name = null
    if (this.peek()?.type === TokenType.COORDINATE) {
      const coordToken = this.advance()
      // Check if this is a name (no comma, no colon)
      if (!coordToken.value.includes(",") && !coordToken.value.includes(":")) {
        name = coordToken.value
      } else {
        // It's actually a position, put it back
        this.position--
      }
    }

    // Parse "at (coord)"
    let position = new Point(0, 0)
    if (this.match(TokenType.AT)) {
      const coordToken = this.expect(TokenType.COORDINATE)
      if (coordToken) {
        const result = parseCoordinateToken(coordToken.value, this.coordSystem)
        position = result.point
      }
    }

    // Parse node text
    let text = ""
    if (this.peek()?.type === TokenType.STRING) {
      text = this.advance().value
    }

    this.match(TokenType.SEMICOLON)

    // Parse node options for shape, size, etc.
    const nodeOptions = this.parseNodeOptions(options)

    // Register the node if it has a name
    if (name) {
      const anchors = this.coordSystem.calculateAnchors(
        position,
        nodeOptions.shape,
        nodeOptions.width,
        nodeOptions.height
      )
      this.coordSystem.registerNode(name, position, anchors)
    }

    return new ASTNode(NodeType.NODE, {
      name,
      position,
      text,
      style,
      ...nodeOptions
    })
  }

  parseNodeOptions(options) {
    const result = {
      shape: "rectangle",
      anchor: "center",
      width: 1,
      height: 0.5,
      innerSep: 0.3333,
      outerSep: 0.5,
      draw: false,
      fill: null
    }

    for (const opt of options) {
      const [key, value] = this.parseOptionKeyValue(opt)

      switch (key) {
        case "circle":
          result.shape = "circle"
          break
        case "rectangle":
          result.shape = "rectangle"
          break
        case "ellipse":
          result.shape = "ellipse"
          break
        case "box":
          result.shape = "rectangle"
          result.draw = true
          break
        case "anchor":
          result.anchor = value
          break
        case "minimum width":
          result.width = parseFloat(value) || 1
          break
        case "minimum height":
          result.height = parseFloat(value) || 0.5
          break
        case "minimum size":
          result.width = result.height = parseFloat(value) || 1
          break
        case "inner sep":
          result.innerSep = parseFloat(value) || 0.3333
          break
        case "outer sep":
          result.outerSep = parseFloat(value) || 0.5
          break
        case "draw":
          result.draw = true
          break
        case "fill":
          result.fill = value || "currentColor"
          break
        case "above":
        case "below":
        case "left":
        case "right":
          result.anchor = this.oppositeAnchor(key)
          break
      }
    }

    return result
  }

  oppositeAnchor(direction) {
    const opposites = {
      above: "south",
      below: "north",
      left: "east",
      right: "west"
    }
    return opposites[direction] || "center"
  }

  parseCoordinateCommand() {
    this.advance() // consume \coordinate

    // Parse name
    let name = null
    if (this.peek()?.type === TokenType.COORDINATE) {
      name = this.advance().value
    }

    // Parse "at (coord)"
    let position = new Point(0, 0)
    if (this.match(TokenType.AT)) {
      const coordToken = this.expect(TokenType.COORDINATE)
      if (coordToken) {
        const result = parseCoordinateToken(coordToken.value, this.coordSystem)
        position = result.point
      }
    }

    this.match(TokenType.SEMICOLON)

    // Register the coordinate
    if (name) {
      this.coordSystem.setNamedCoordinate(name, position)
    }

    return new ASTNode(NodeType.COORDINATE, { name, position })
  }

  parseOptionsBlock() {
    const options = []

    if (!this.match(TokenType.OPTION_START)) {
      return options
    }

    let current = ""
    let depth = 0

    while (this.peek()?.type !== TokenType.OPTION_END && this.peek()?.type !== TokenType.EOF) {
      const token = this.advance()

      if (token.type === TokenType.BRACE_START) {
        current += "{"
        depth++
      } else if (token.type === TokenType.BRACE_END) {
        current += "}"
        depth--
      } else if (token.type === TokenType.COMMA && depth === 0) {
        if (current.trim()) {
          options.push(current.trim())
        }
        current = ""
      } else if (token.type === TokenType.EQUALS) {
        current += "="
      } else if (token.type === TokenType.STRING) {
        current += "{" + token.value + "}"
      } else if (token.value !== null) {
        current += token.value
      }
    }

    if (current.trim()) {
      options.push(current.trim())
    }

    this.match(TokenType.OPTION_END)

    // Expand style references
    return this.expandStyleReferences(options)
  }

  expandStyleReferences(options) {
    const expanded = []

    for (const opt of options) {
      // Check if this option is a style reference (just a name, no '=')
      if (!opt.includes("=") && this.styles.has(opt)) {
        // Expand the style
        const styleOptions = this.styles.get(opt)
        expanded.push(...this.expandStyleReferences(styleOptions))
      } else {
        expanded.push(opt)
      }
    }

    return expanded
  }

  parsePath() {
    const segments = []
    this.coordSystem.reset()

    // Parse first coordinate
    let firstPoint = null
    if (this.peek()?.type === TokenType.COORDINATE) {
      const token = this.advance()
      const coordValue = this.getCoordinateValue(token)
      const result = parseCoordinateToken(coordValue, this.coordSystem)
      firstPoint = result.point
    }

    // Parse path operations
    while (this.peek()?.type !== TokenType.SEMICOLON && this.peek()?.type !== TokenType.EOF) {
      const segment = this.parsePathSegment(firstPoint)
      if (segment) {
        segments.push(segment)
        if (segment.to) {
          firstPoint = segment.to
        }
      } else {
        break
      }
    }

    return segments
  }

  getCoordinateValue(token) {
    // Handle relative coordinates that might have + prefix outside parentheses
    let value = token.value

    // Check for + or ++ prefix before this token
    // This is handled by looking at the raw token value which preserves the prefix
    return value
  }

  parsePathSegment(fromPoint) {
    const token = this.peek()

    if (!token) return null

    switch (token.type) {
      case TokenType.LINE_TO:
        return this.parseLineTo(fromPoint)

      case TokenType.CURVE_TO:
        return this.parseCurveTo(fromPoint)

      case TokenType.TO:
        return this.parseToOperation(fromPoint)

      case TokenType.CIRCLE:
        return this.parseCircle(fromPoint)

      case TokenType.ELLIPSE:
        return this.parseEllipse(fromPoint)

      case TokenType.RECTANGLE:
        return this.parseRectangle(fromPoint)

      case TokenType.ARC:
        return this.parseArc(fromPoint)

      case TokenType.GRID:
        return this.parseGrid(fromPoint)

      case TokenType.CYCLE:
        this.advance()
        return new ASTNode(NodeType.CYCLE, { from: fromPoint })

      case TokenType.NODE:
        return this.parseInlineNode(fromPoint)

      case TokenType.PLUS:
        // Handle relative coordinate
        this.advance()
        const isDouble = this.match(TokenType.PLUS)
        if (this.peek()?.type === TokenType.COORDINATE) {
          const coordToken = this.advance()
          const prefix = isDouble ? "++" : "+"
          const result = parseCoordinateToken(prefix + coordToken.value, this.coordSystem)
          return new ASTNode(NodeType.LINE_SEGMENT, {
            from: fromPoint,
            to: result.point
          })
        }
        return null

      case TokenType.COORDINATE:
        // Bare coordinate - implicit line to
        const coordToken = this.advance()
        const result = parseCoordinateToken(coordToken.value, this.coordSystem)
        return new ASTNode(NodeType.LINE_SEGMENT, {
          from: fromPoint,
          to: result.point
        })

      default:
        return null
    }
  }

  parseLineTo(fromPoint) {
    this.advance() // consume --

    // Check for options like [out=45, in=135]
    const options = this.parseOptionsBlock()

    // Check for cycle (-- cycle is valid in TikZ)
    if (this.peek()?.type === TokenType.CYCLE) {
      this.advance()
      return new ASTNode(NodeType.CYCLE, { from: fromPoint })
    }

    // Check for + or ++ prefix
    let coordValue = ""
    while (this.match(TokenType.PLUS)) {
      coordValue += "+"
    }

    const coordToken = this.expect(TokenType.COORDINATE)
    if (!coordToken) return null

    coordValue += coordToken.value
    const result = parseCoordinateToken(coordValue, this.coordSystem)

    return new ASTNode(NodeType.LINE_SEGMENT, {
      from: fromPoint,
      to: result.point,
      options
    })
  }

  parseCurveTo(fromPoint) {
    this.advance() // consume ..

    // Expect "controls"
    if (!this.match(TokenType.CONTROLS)) {
      return null
    }

    // First control point
    const control1Token = this.expect(TokenType.COORDINATE)
    if (!control1Token) return null
    const control1 = parseCoordinateToken(control1Token.value, this.coordSystem)

    // Check for "and" (second control point)
    let control2 = control1
    if (this.match(TokenType.AND)) {
      const control2Token = this.expect(TokenType.COORDINATE)
      if (control2Token) {
        control2 = parseCoordinateToken(control2Token.value, this.coordSystem)
      }
    }

    // Expect ".."
    if (!this.match(TokenType.CURVE_TO)) {
      return null
    }

    // End point
    const endToken = this.expect(TokenType.COORDINATE)
    if (!endToken) return null
    const end = parseCoordinateToken(endToken.value, this.coordSystem)

    return new ASTNode(NodeType.CURVE_SEGMENT, {
      from: fromPoint,
      control1: control1.point,
      control2: control2.point,
      to: end.point
    })
  }

  parseToOperation(fromPoint) {
    this.advance() // consume "to"

    const options = this.parseOptionsBlock()

    // Parse out/in angles for curved paths
    let outAngle = null
    let inAngle = null

    for (const opt of options) {
      const [key, value] = this.parseOptionKeyValue(opt)
      if (key === "out") outAngle = parseFloat(value)
      if (key === "in") inAngle = parseFloat(value)
    }

    // Check for + or ++ prefix
    let coordValue = ""
    while (this.match(TokenType.PLUS)) {
      coordValue += "+"
    }

    const coordToken = this.expect(TokenType.COORDINATE)
    if (!coordToken) return null

    coordValue += coordToken.value
    const result = parseCoordinateToken(coordValue, this.coordSystem)

    if (outAngle !== null && inAngle !== null) {
      // Curved path
      const distance = Math.sqrt(
        Math.pow(result.point.x - fromPoint.x, 2) +
        Math.pow(result.point.y - fromPoint.y, 2)
      ) / 3

      const control1 = new Point(
        fromPoint.x + distance * Math.cos(outAngle * Math.PI / 180),
        fromPoint.y + distance * Math.sin(outAngle * Math.PI / 180)
      )
      const control2 = new Point(
        result.point.x + distance * Math.cos(inAngle * Math.PI / 180),
        result.point.y + distance * Math.sin(inAngle * Math.PI / 180)
      )

      return new ASTNode(NodeType.CURVE_SEGMENT, {
        from: fromPoint,
        control1,
        control2,
        to: result.point
      })
    }

    return new ASTNode(NodeType.LINE_SEGMENT, {
      from: fromPoint,
      to: result.point,
      options
    })
  }

  parseCircle(fromPoint) {
    this.advance() // consume "circle"

    let radius = 1
    const options = this.parseOptionsBlock()

    for (const opt of options) {
      const [key, value] = this.parseOptionKeyValue(opt)
      if (key === "radius") {
        radius = parseFloat(value)
      }
    }

    // Check for (radius) shorthand
    if (this.peek()?.type === TokenType.COORDINATE) {
      const radiusToken = this.advance()
      const parsed = parseFloat(radiusToken.value)
      if (!isNaN(parsed)) {
        radius = parsed
      }
    }

    return new ASTNode(NodeType.CIRCLE, {
      center: fromPoint,
      radius
    })
  }

  parseEllipse(fromPoint) {
    this.advance() // consume "ellipse"

    let rx = 1, ry = 0.5
    const options = this.parseOptionsBlock()

    for (const opt of options) {
      const [key, value] = this.parseOptionKeyValue(opt)
      if (key === "x radius") rx = parseFloat(value)
      if (key === "y radius") ry = parseFloat(value)
    }

    // Check for (rx and ry) shorthand
    if (this.peek()?.type === TokenType.COORDINATE) {
      const dimsToken = this.advance()
      const andMatch = dimsToken.value.match(/(-?\d+\.?\d*)\s+and\s+(-?\d+\.?\d*)/)
      if (andMatch) {
        rx = parseFloat(andMatch[1])
        ry = parseFloat(andMatch[2])
      }
    }

    return new ASTNode(NodeType.ELLIPSE, {
      center: fromPoint,
      rx,
      ry
    })
  }

  parseRectangle(fromPoint) {
    this.advance() // consume "rectangle"

    // Check for + or ++ prefix
    let coordValue = ""
    while (this.match(TokenType.PLUS)) {
      coordValue += "+"
    }

    const cornerToken = this.expect(TokenType.COORDINATE)
    if (!cornerToken) return null

    coordValue += cornerToken.value
    const result = parseCoordinateToken(coordValue, this.coordSystem)

    return new ASTNode(NodeType.RECTANGLE, {
      from: fromPoint,
      to: result.point
    })
  }

  parseArc(fromPoint) {
    this.advance() // consume "arc"

    let startAngle = 0, endAngle = 90, radius = 1
    let rx = null, ry = null

    const options = this.parseOptionsBlock()
    for (const opt of options) {
      const [key, value] = this.parseOptionKeyValue(opt)
      if (key === "start angle") startAngle = parseFloat(value)
      if (key === "end angle") endAngle = parseFloat(value)
      if (key === "radius") radius = parseFloat(value)
      if (key === "x radius") rx = parseFloat(value)
      if (key === "y radius") ry = parseFloat(value)
    }

    // Check for (start:end:radius) shorthand
    if (this.peek()?.type === TokenType.COORDINATE) {
      const arcToken = this.advance()
      const arcMatch = arcToken.value.match(/(-?\d+\.?\d*)\s*:\s*(-?\d+\.?\d*)\s*:\s*(-?\d+\.?\d*)/)
      if (arcMatch) {
        startAngle = parseFloat(arcMatch[1])
        endAngle = parseFloat(arcMatch[2])
        radius = parseFloat(arcMatch[3])
      }
    }

    return new ASTNode(NodeType.ARC_SEGMENT, {
      start: fromPoint,
      startAngle,
      endAngle,
      radius,
      rx: rx || radius,
      ry: ry || radius
    })
  }

  parseGrid(fromPoint) {
    this.advance() // consume "grid"

    const options = this.parseOptionsBlock()

    // Check for + or ++ prefix
    let coordValue = ""
    while (this.match(TokenType.PLUS)) {
      coordValue += "+"
    }

    const cornerToken = this.expect(TokenType.COORDINATE)
    if (!cornerToken) return null

    coordValue += cornerToken.value
    const result = parseCoordinateToken(coordValue, this.coordSystem)

    let step = 1
    for (const opt of options) {
      const [key, value] = this.parseOptionKeyValue(opt)
      if (key === "step") step = parseFloat(value)
    }

    return new ASTNode(NodeType.GRID, {
      from: fromPoint,
      to: result.point,
      step
    })
  }

  parseInlineNode(fromPoint) {
    this.advance() // consume "node"

    const options = this.parseOptionsBlock()
    const nodeOptions = this.parseNodeOptions(options)
    const style = parseOptions(options)

    // Parse optional name
    let name = null
    if (this.peek()?.type === TokenType.COORDINATE) {
      const nameToken = this.peek()
      if (!nameToken.value.includes(",") && !nameToken.value.includes(":")) {
        name = this.advance().value
      }
    }

    // Parse node text
    let text = ""
    if (this.peek()?.type === TokenType.STRING) {
      text = this.advance().value
    }

    // Register the node
    if (name) {
      const anchors = this.coordSystem.calculateAnchors(
        fromPoint,
        nodeOptions.shape,
        nodeOptions.width,
        nodeOptions.height
      )
      this.coordSystem.registerNode(name, fromPoint, anchors)
    }

    return new ASTNode(NodeType.NODE, {
      name,
      position: fromPoint,
      text,
      style,
      inline: true,
      ...nodeOptions
    })
  }

  parseOptionKeyValue(opt) {
    const trimmed = opt.trim()
    const eqIndex = trimmed.indexOf("=")
    if (eqIndex !== -1) {
      return [
        trimmed.slice(0, eqIndex).trim(),
        trimmed.slice(eqIndex + 1).trim()
      ]
    }
    return [trimmed, null]
  }
}

export function parse(input) {
  const parser = new Parser(input)
  return parser.parse()
}
