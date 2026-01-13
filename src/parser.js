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
  PLOT_SEGMENT: "PLOT_SEGMENT",
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
    this.nodeDistance = 1 // Default node distance in cm
    this.defaultFontSize = null // Global font size
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
          // Handle foreach results (multiple commands)
          if (command.type === "FOREACH_RESULT") {
            document.commands.push(...command.commands)
          } else {
            document.commands.push(command)
          }
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
      case "\\foreach":
        return this.parseForeach()
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

  /**
   * Parse \foreach loop: \foreach \var in {values} { body }
   * Also supports multi-variable: \foreach \x/\y in {a/b, c/d} { body }
   * Returns an array of commands (one for each iteration)
   */
  parseForeach() {
    this.advance() // consume \foreach

    // Parse variable name(s) (e.g., \r, \x, or \x/\y for multi-variable)
    const varNames = []
    while (this.peek()?.type === TokenType.COMMAND) {
      varNames.push(this.advance().value) // e.g., "\x"
      // Check for slash separator for multi-variable
      if (this.peek()?.type === TokenType.SLASH) {
        this.advance() // consume /
      } else {
        break
      }
    }

    if (varNames.length === 0) {
      this.errors.push({
        message: "Expected variable name after \\foreach",
        position: this.peek()?.position || { line: 0, column: 0 }
      })
      return null
    }

    // Expect "in" keyword
    if (this.peek()?.type !== TokenType.IDENTIFIER || this.peek()?.value !== "in") {
      this.errors.push({
        message: "Expected 'in' after foreach variable",
        position: this.peek()?.position || { line: 0, column: 0 }
      })
      return null
    }
    this.advance() // consume "in"

    // Parse values list: {0.8, 1.2, ...} or {a/b, c/d, ...} for multi-variable
    const values = []
    if (this.peek()?.type === TokenType.STRING) {
      const valuesStr = this.advance().value
      // Split by comma and parse each value (or value tuple)
      const parts = valuesStr.split(",")
      for (const part of parts) {
        const trimmed = part.trim()
        if (trimmed) {
          if (varNames.length > 1) {
            // Multi-variable: split by /
            const subParts = trimmed.split("/").map(s => s.trim())
            values.push(subParts)
          } else {
            // Single variable
            const num = parseFloat(trimmed)
            values.push(!isNaN(num) ? num : trimmed)
          }
        }
      }
    }

    // Parse body: { commands }
    let bodyStr = ""
    if (this.peek()?.type === TokenType.STRING) {
      bodyStr = this.advance().value
    }

    // Execute loop: parse body for each value
    const commands = []
    for (const value of values) {
      let substituted = bodyStr

      if (varNames.length > 1 && Array.isArray(value)) {
        // Multi-variable substitution
        for (let i = 0; i < varNames.length && i < value.length; i++) {
          const varRegex = new RegExp(varNames[i].replace("\\", "\\\\"), "g")
          substituted = substituted.replace(varRegex, String(value[i]))
        }
      } else {
        // Single variable substitution
        const varRegex = new RegExp(varNames[0].replace("\\", "\\\\"), "g")
        substituted = substituted.replace(varRegex, String(value))
      }

      // Parse the substituted body
      const subParser = new Parser(substituted)
      subParser.coordSystem = this.coordSystem
      subParser.styles = this.styles
      subParser.nodeDistance = this.nodeDistance

      const result = subParser.parse()
      if (result.ast && result.ast.commands) {
        commands.push(...result.ast.commands)
      }
    }

    // Return commands as a special "multi-command" result
    return { type: "FOREACH_RESULT", commands }
  }

  parsePictureOptions(options) {
    for (const opt of options) {
      // Check for style definition: name/.style={...}
      const styleMatch = opt.match(/^([a-zA-Z][a-zA-Z0-9_-]*)\/\.style\s*=\s*\{(.+)\}$/s)
      if (styleMatch) {
        const styleName = styleMatch[1]
        const styleValue = styleMatch[2]
        // Parse the style value into individual options
        const styleOptions = this.parseStyleValue(styleValue)
        this.styles.set(styleName, styleOptions)
        continue
      }

      // Check for node distance
      const distMatch = opt.match(/^node\s+distance\s*=\s*(\d+\.?\d*)(mm|cm|pt|em)?$/i)
      if (distMatch) {
        let distance = parseFloat(distMatch[1])
        const unit = distMatch[2] || "cm"
        // Convert to cm (our internal unit)
        switch (unit.toLowerCase()) {
          case "mm":
            distance *= 0.1
            break
          case "pt":
            distance *= 0.0353
            break
          case "em":
            distance *= 0.423 // Approximate
            break
          // cm is default
        }
        this.nodeDistance = distance
        continue
      }

      // Check for global font setting
      const [key, value] = this.parseOptionKeyValue(opt)
      if (key === "font") {
        this.defaultFontSize = this.parseFontSize(value)
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
    // Store options temporarily for plot parsing
    this.currentDrawOptions = options
    const segments = this.parsePath()
    this.currentDrawOptions = null

    this.match(TokenType.SEMICOLON)

    return new ASTNode(type, { style, segments, options })
  }

  parseNodeCommand() {
    this.advance() // consume \node

    // TikZ supports both syntaxes:
    // 1. \node (name) [options] at (coord) {text};
    // 2. \node [options] (name) at (coord) {text};

    // Try to parse name FIRST if present before options: (name)
    let name = null
    if (this.peek()?.type === TokenType.COORDINATE) {
      const coordToken = this.peek()
      // Check if this is a name (no comma, no colon) - names are simple identifiers
      if (!coordToken.value.includes(",") && !coordToken.value.includes(":")) {
        name = this.advance().value
      }
    }

    // Parse options: [options]
    const options = this.parseOptionsBlock()
    const style = parseOptions(options)

    // If name wasn't before options, try to parse it after: \node [options] (name)
    if (!name && this.peek()?.type === TokenType.COORDINATE) {
      const coordToken = this.peek()
      if (!coordToken.value.includes(",") && !coordToken.value.includes(":")) {
        name = this.advance().value
      }
    }

    // Parse "at (coord)" or check for positioning options
    let position = new Point(0, 0)
    let positionFromOptions = this.parsePositioningOptions(options)

    if (this.match(TokenType.AT)) {
      const coordToken = this.expect(TokenType.COORDINATE)
      if (coordToken) {
        const result = parseCoordinateToken(coordToken.value, this.coordSystem)
        position = result.point
      }
    } else if (positionFromOptions) {
      position = positionFromOptions
    }

    // Parse node text
    let text = ""
    if (this.peek()?.type === TokenType.STRING) {
      text = this.advance().value
    }

    this.match(TokenType.SEMICOLON)

    // Parse node options for shape, size, etc. (pass text for dimension estimation)
    const nodeOptions = this.parseNodeOptions(options, text)

    // Register the node if it has a name
    if (name) {
      const anchors = this.coordSystem.calculateAnchors(
        position,
        nodeOptions.shape,
        nodeOptions.width,
        nodeOptions.height
      )
      this.coordSystem.registerNode(name, position, anchors, nodeOptions.shape, nodeOptions.width, nodeOptions.height)
    }

    return new ASTNode(NodeType.NODE, {
      name,
      position,
      text,
      style,
      ...nodeOptions
    })
  }

  /**
   * Parse positioning options like "below=of nodename", "below left=10mm and 12mm of node"
   * Returns a Point if positioning is found, null otherwise
   */
  parsePositioningOptions(options) {
    const simpleDirections = ["above", "below", "left", "right"]
    const compoundDirections = ["above left", "above right", "below left", "below right"]
    const offsets = { x: 0, y: 0 }
    let refNode = null
    let direction = null
    let compoundDistances = { vertical: null, horizontal: null }

    for (const opt of options) {
      const [key, value] = this.parseOptionKeyValue(opt)

      // Check for compound directions first (e.g., "below left")
      if (compoundDirections.includes(key)) {
        direction = key
        if (value) {
          // Check for "Xmm and Ymm of nodename" syntax
          const compoundOfMatch = value.match(/^(\d+\.?\d*)(mm|cm|pt|em)?\s+and\s+(\d+\.?\d*)(mm|cm|pt|em)?\s+of\s+([a-zA-Z_][a-zA-Z0-9_-]*)$/)
          if (compoundOfMatch) {
            compoundDistances.vertical = this.parseDistance(compoundOfMatch[1] + (compoundOfMatch[2] || "mm"))
            compoundDistances.horizontal = this.parseDistance(compoundOfMatch[3] + (compoundOfMatch[4] || "mm"))
            refNode = compoundOfMatch[5]
          } else {
            // Simple "of nodename" syntax
            const ofMatch = value.match(/^of\s+([a-zA-Z_][a-zA-Z0-9_-]*)$/)
            if (ofMatch) {
              refNode = ofMatch[1]
            }
          }
        }
      } else if (simpleDirections.includes(key)) {
        direction = key
        if (value) {
          // Check for "Xmm of nodename" syntax (distance + ref node)
          const distOfMatch = value.match(/^(\d+\.?\d*)(mm|cm|pt|em)?\s+of\s+([a-zA-Z_][a-zA-Z0-9_-]*)$/)
          if (distOfMatch) {
            compoundDistances.vertical = this.parseDistance(distOfMatch[1] + (distOfMatch[2] || "mm"))
            compoundDistances.horizontal = compoundDistances.vertical
            refNode = distOfMatch[3]
          } else {
            // Check for simple "of nodename" syntax
            const ofMatch = value.match(/^of\s+([a-zA-Z_][a-zA-Z0-9_-]*)$/)
            if (ofMatch) {
              refNode = ofMatch[1]
            } else {
              // Parse distance value (no ref node)
              const dist = this.parseDistance(value)
              if (dist !== null) {
                switch (key) {
                  case "above":
                    offsets.y = dist
                    break
                  case "below":
                    offsets.y = -dist
                    break
                  case "right":
                    offsets.x = dist
                    break
                  case "left":
                    offsets.x = -dist
                    break
                }
              }
            }
          }
        }
      }
    }

    // If we have a reference node with "of" syntax
    if (refNode && direction) {
      const node = this.coordSystem.nodes.get(refNode)
      if (node) {
        const refPoint = node.center
        // Use specified distance or fall back to nodeDistance
        const dist = compoundDistances.vertical !== null ? compoundDistances.vertical : this.nodeDistance
        // Use anchors to get edge-to-edge distance (like TikZ positioning library)
        // Add extra spacing for the new node's half-height (approximate)
        const nodeHalfHeight = 0.8 // Approximate half-height of a typical node in cm

        // Handle compound directions
        if (compoundDirections.includes(direction)) {
          const vDist = compoundDistances.vertical !== null ? compoundDistances.vertical : dist
          const hDist = compoundDistances.horizontal !== null ? compoundDistances.horizontal : dist

          let x = refPoint.x
          let y = refPoint.y

          if (direction.includes("above")) {
            const topAnchor = node.anchors?.north || refPoint
            y = topAnchor.y + vDist + nodeHalfHeight
          } else if (direction.includes("below")) {
            const bottomAnchor = node.anchors?.south || refPoint
            y = bottomAnchor.y - vDist - nodeHalfHeight
          }

          if (direction.includes("left")) {
            const leftAnchor = node.anchors?.west || refPoint
            x = leftAnchor.x - hDist - nodeHalfHeight
          } else if (direction.includes("right")) {
            const rightAnchor = node.anchors?.east || refPoint
            x = rightAnchor.x + hDist + nodeHalfHeight
          }

          return new Point(x, y)
        }

        // Handle simple directions
        switch (direction) {
          case "above":
            const topAnchor = node.anchors?.north || refPoint
            return new Point(refPoint.x, topAnchor.y + dist + nodeHalfHeight)
          case "below":
            const bottomAnchor = node.anchors?.south || refPoint
            return new Point(refPoint.x, bottomAnchor.y - dist - nodeHalfHeight)
          case "right":
            const rightAnchor = node.anchors?.east || refPoint
            return new Point(rightAnchor.x + dist + nodeHalfHeight, refPoint.y)
          case "left":
            const leftAnchor = node.anchors?.west || refPoint
            return new Point(leftAnchor.x - dist - nodeHalfHeight, refPoint.y)
        }
      }
    }

    // If we only have offsets (no reference node)
    if (offsets.x !== 0 || offsets.y !== 0) {
      return new Point(offsets.x, offsets.y)
    }

    return null
  }

  /**
   * Parse a distance value with optional unit (e.g., "2mm", "1cm", "10pt")
   */
  parseDistance(value) {
    if (!value) return null

    const match = value.match(/^(-?\d+\.?\d*)(mm|cm|pt|em)?$/)
    if (!match) return null

    let dist = parseFloat(match[1])
    const unit = match[2] || "cm"

    // Convert to cm
    switch (unit.toLowerCase()) {
      case "mm":
        dist *= 0.1
        break
      case "pt":
        dist *= 0.0353
        break
      case "em":
        dist *= 0.423
        break
      // cm is default
    }

    return dist
  }

  parseNodeOptions(options, text = "") {
    const result = {
      shape: "rectangle",
      anchor: "center",
      width: 1,
      height: 0.5,
      innerSep: 0.3333,
      outerSep: 0.5,
      draw: false,
      fill: null,
      align: "center",
      fontSize: this.defaultFontSize // Use global default if set
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
          result.width = this.parseDistance(value) || 1
          break
        case "minimum height":
          result.height = this.parseDistance(value) || 0.5
          break
        case "minimum size":
          result.width = result.height = this.parseDistance(value) || 1
          break
        case "inner sep":
          result.innerSep = this.parseDistance(value) || 0.3333
          break
        case "outer sep":
          result.outerSep = this.parseDistance(value) || 0.5
          break
        case "draw":
          result.draw = true
          break
        case "fill":
          result.fill = value || "currentColor"
          break
        case "align":
          result.align = value || "center"
          break
        case "font":
          // Parse font size commands
          result.fontSize = this.parseFontSize(value)
          break
        case "rotate":
          result.rotate = parseFloat(value) || 0
          break
        case "above":
        case "below":
        case "left":
        case "right":
          result.anchor = this.oppositeAnchor(key)
          break
      }
    }

    // Text-based dimensions are now calculated by the renderer using getBBox()
    // Parser only sets width/height if explicitly specified via minimum width/height

    return result
  }

  /**
   * Parse font size command (e.g., \small, \footnotesize)
   */
  parseFontSize(value) {
    if (!value) return null

    const fontSizes = {
      "\\tiny": 6,
      "\\scriptsize": 8,
      "\\footnotesize": 10,
      "\\small": 12,
      "\\normalsize": 14,
      "\\large": 16,
      "\\Large": 18,
      "\\LARGE": 20,
      "\\huge": 24,
      "\\Huge": 28
    }

    return fontSizes[value] || null
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
    let lastTokenType = null

    while (this.peek()?.type !== TokenType.OPTION_END && this.peek()?.type !== TokenType.EOF) {
      const token = this.advance()

      // Add space between consecutive identifiers (for multi-word keys like "inner sep")
      // But NOT between number and unit (like "14mm")
      // Note: Some keywords like "node" are tokenized as NODE, not IDENTIFIER
      const isUnit = token.type === TokenType.IDENTIFIER &&
        ["mm", "cm", "pt", "em", "ex", "in"].includes(token.value)

      const isWordToken = (type) => type === TokenType.IDENTIFIER || type === TokenType.NODE ||
        type === TokenType.AT || type === TokenType.TO || type === TokenType.AND ||
        type === TokenType.CONTROLS || type === TokenType.CYCLE

      const needsSpace = (
        isWordToken(lastTokenType) && token.type === TokenType.IDENTIFIER && !isUnit
      ) || (
        isWordToken(lastTokenType) && token.type === TokenType.NUMBER
      ) || (
        lastTokenType === TokenType.IDENTIFIER && isWordToken(token.type) && token.type !== TokenType.IDENTIFIER
      )

      if (needsSpace) {
        current += " "
      }

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
        lastTokenType = null
        continue
      } else if (token.type === TokenType.EQUALS) {
        current += "="
      } else if (token.type === TokenType.STRING) {
        current += "{" + token.value + "}"
      } else if (token.value !== null) {
        current += token.value
      }

      lastTokenType = token.type
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
    let firstNodeName = null  // Track if first point is a node reference
    if (this.peek()?.type === TokenType.COORDINATE) {
      const token = this.advance()
      const coordValue = this.getCoordinateValue(token)
      const result = parseCoordinateToken(coordValue, this.coordSystem)
      firstPoint = result.point
      firstNodeName = result.nodeName
    }

    // Parse path operations
    while (this.peek()?.type !== TokenType.SEMICOLON && this.peek()?.type !== TokenType.EOF) {
      const { segment, toNodeName } = this.parsePathSegment(firstPoint, firstNodeName)
      if (segment) {
        segments.push(segment)
        if (segment.to) {
          firstPoint = segment.to
          firstNodeName = toNodeName
        } else {
          firstNodeName = null
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

  parsePathSegment(fromPoint, fromNodeName = null) {
    const token = this.peek()

    if (!token) return { segment: null, toNodeName: null }

    switch (token.type) {
      case TokenType.LINE_TO:
        return this.parseLineTo(fromPoint, fromNodeName)

      case TokenType.CURVE_TO:
        return this.parseCurveTo(fromPoint, fromNodeName)

      case TokenType.TO:
        return this.parseToOperation(fromPoint, fromNodeName)

      case TokenType.CIRCLE:
        return { segment: this.parseCircle(fromPoint), toNodeName: null }

      case TokenType.ELLIPSE:
        return { segment: this.parseEllipse(fromPoint), toNodeName: null }

      case TokenType.RECTANGLE:
        return { segment: this.parseRectangle(fromPoint), toNodeName: null }

      case TokenType.ARC:
        return { segment: this.parseArc(fromPoint), toNodeName: null }

      case TokenType.GRID:
        return { segment: this.parseGrid(fromPoint), toNodeName: null }

      case TokenType.PLOT:
        return { segment: this.parsePlot(fromPoint), toNodeName: null }

      case TokenType.CYCLE:
        this.advance()
        return { segment: new ASTNode(NodeType.CYCLE, { from: fromPoint }), toNodeName: null }

      case TokenType.NODE:
        return { segment: this.parseInlineNode(fromPoint), toNodeName: null }

      case TokenType.PLUS:
        // Handle relative coordinate
        this.advance()
        const isDouble = this.match(TokenType.PLUS)
        if (this.peek()?.type === TokenType.COORDINATE) {
          const coordToken = this.advance()
          const prefix = isDouble ? "++" : "+"
          const result = parseCoordinateToken(prefix + coordToken.value, this.coordSystem)
          return {
            segment: new ASTNode(NodeType.LINE_SEGMENT, {
              from: fromPoint,
              to: result.point
            }),
            toNodeName: null
          }
        }
        return { segment: null, toNodeName: null }

      case TokenType.COORDINATE:
        // Bare coordinate - implicit line to
        const coordToken = this.advance()
        const result = parseCoordinateToken(coordToken.value, this.coordSystem)
        // Adjust endpoints for node references
        let adjustedFrom = fromPoint
        let adjustedTo = result.point
        if (fromNodeName && result.nodeName) {
          // Both endpoints are nodes - adjust both
          adjustedFrom = this.coordSystem.getNodeBoundaryPoint(fromNodeName, result.point)
          adjustedTo = this.coordSystem.getNodeBoundaryPoint(result.nodeName, fromPoint)
        } else if (fromNodeName) {
          // Only from is a node
          adjustedFrom = this.coordSystem.getNodeBoundaryPoint(fromNodeName, result.point)
        } else if (result.nodeName) {
          // Only to is a node
          adjustedTo = this.coordSystem.getNodeBoundaryPoint(result.nodeName, fromPoint)
        }
        return {
          segment: new ASTNode(NodeType.LINE_SEGMENT, {
            from: adjustedFrom,
            to: adjustedTo,
            fromNodeName,
            toNodeName: result.nodeName
          }),
          toNodeName: result.nodeName
        }

      default:
        return { segment: null, toNodeName: null }
    }
  }

  parseLineTo(fromPoint, fromNodeName = null) {
    this.advance() // consume --

    // Check for options like [out=45, in=135]
    const options = this.parseOptionsBlock()

    // Check for cycle (-- cycle is valid in TikZ)
    if (this.peek()?.type === TokenType.CYCLE) {
      this.advance()
      return { segment: new ASTNode(NodeType.CYCLE, { from: fromPoint }), toNodeName: null }
    }

    // Check for edge label (node between -- and coordinate)
    let edgeLabel = null
    if (this.peek()?.type === TokenType.NODE) {
      edgeLabel = this.parseEdgeLabel()
    }

    // Check for + or ++ prefix
    let coordValue = ""
    while (this.match(TokenType.PLUS)) {
      coordValue += "+"
    }

    const coordToken = this.expect(TokenType.COORDINATE)
    if (!coordToken) return { segment: null, toNodeName: null }

    coordValue += coordToken.value
    const result = parseCoordinateToken(coordValue, this.coordSystem)

    // Adjust endpoints for node references
    let adjustedFrom = fromPoint
    let adjustedTo = result.point
    if (fromNodeName && result.nodeName) {
      // Both endpoints are nodes - adjust both
      adjustedFrom = this.coordSystem.getNodeBoundaryPoint(fromNodeName, result.point)
      adjustedTo = this.coordSystem.getNodeBoundaryPoint(result.nodeName, fromPoint)
    } else if (fromNodeName) {
      // Only from is a node
      adjustedFrom = this.coordSystem.getNodeBoundaryPoint(fromNodeName, result.point)
    } else if (result.nodeName) {
      // Only to is a node
      adjustedTo = this.coordSystem.getNodeBoundaryPoint(result.nodeName, fromPoint)
    }

    return {
      segment: new ASTNode(NodeType.LINE_SEGMENT, {
        from: adjustedFrom,
        to: adjustedTo,
        options,
        edgeLabel,
        fromNodeName,
        toNodeName: result.nodeName
      }),
      toNodeName: result.nodeName
    }
  }

  /**
   * Parse an edge label: node[options] {text}
   */
  parseEdgeLabel() {
    this.advance() // consume "node"

    const options = this.parseOptionsBlock()
    const style = parseOptions(options)

    // Parse edge label positioning options
    const labelPosition = this.parseEdgeLabelPosition(options)

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

    // Parse node options (pass text for dimension estimation)
    const nodeOptions = this.parseNodeOptions(options, text)

    return {
      name,
      text,
      style,
      labelPosition,
      ...nodeOptions
    }
  }

  /**
   * Parse edge label positioning options (above, below, left, right, pos, etc.)
   */
  parseEdgeLabelPosition(options) {
    const position = {
      pos: 0.5, // Default: middle of edge
      offset: { x: 0, y: 0 },
      anchor: "center",
      align: null // Will be set based on positioning
    }

    for (const opt of options) {
      const [key, value] = this.parseOptionKeyValue(opt)

      switch (key) {
        case "pos":
          position.pos = parseFloat(value) || 0.5
          break
        case "midway":
          position.pos = 0.5
          break
        case "near start":
          position.pos = 0.25
          break
        case "near end":
          position.pos = 0.75
          break
        case "at start":
          position.pos = 0
          break
        case "at end":
          position.pos = 1
          break
        case "above":
          position.offset.y = this.parseDistance(value) || 0.15
          position.anchor = "south"
          position.align = "center"
          break
        case "below":
          position.offset.y = -(this.parseDistance(value) || 0.15)
          position.anchor = "north"
          position.align = "center"
          break
        case "left":
          position.offset.x = -(this.parseDistance(value) || 0.15)
          position.anchor = "east"
          position.align = "right" // Text aligned to the right (ends at anchor)
          break
        case "right":
          position.offset.x = this.parseDistance(value) || 0.15
          position.anchor = "west"
          position.align = "left" // Text aligned to the left (starts from anchor)
          break
        case "sloped":
          position.sloped = true
          break
      }
    }

    return position
  }

  parseCurveTo(fromPoint, fromNodeName = null) {
    this.advance() // consume ..

    // Expect "controls"
    if (!this.match(TokenType.CONTROLS)) {
      return { segment: null, toNodeName: null }
    }

    // First control point
    const control1Token = this.expect(TokenType.COORDINATE)
    if (!control1Token) return { segment: null, toNodeName: null }
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
      return { segment: null, toNodeName: null }
    }

    // End point
    const endToken = this.expect(TokenType.COORDINATE)
    if (!endToken) return { segment: null, toNodeName: null }
    const end = parseCoordinateToken(endToken.value, this.coordSystem)

    // Adjust endpoints for node references
    let adjustedFrom = fromPoint
    let adjustedTo = end.point
    if (fromNodeName && end.nodeName) {
      adjustedFrom = this.coordSystem.getNodeBoundaryPoint(fromNodeName, end.point)
      adjustedTo = this.coordSystem.getNodeBoundaryPoint(end.nodeName, fromPoint)
    } else if (fromNodeName) {
      adjustedFrom = this.coordSystem.getNodeBoundaryPoint(fromNodeName, end.point)
    } else if (end.nodeName) {
      adjustedTo = this.coordSystem.getNodeBoundaryPoint(end.nodeName, fromPoint)
    }

    return {
      segment: new ASTNode(NodeType.CURVE_SEGMENT, {
        from: adjustedFrom,
        control1: control1.point,
        control2: control2.point,
        to: adjustedTo
      }),
      toNodeName: end.nodeName
    }
  }

  parseToOperation(fromPoint, fromNodeName = null) {
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
    if (!coordToken) return { segment: null, toNodeName: null }

    coordValue += coordToken.value
    const result = parseCoordinateToken(coordValue, this.coordSystem)

    // Adjust endpoints for node references
    let adjustedFrom = fromPoint
    let adjustedTo = result.point
    if (fromNodeName && result.nodeName) {
      adjustedFrom = this.coordSystem.getNodeBoundaryPoint(fromNodeName, result.point)
      adjustedTo = this.coordSystem.getNodeBoundaryPoint(result.nodeName, fromPoint)
    } else if (fromNodeName) {
      adjustedFrom = this.coordSystem.getNodeBoundaryPoint(fromNodeName, result.point)
    } else if (result.nodeName) {
      adjustedTo = this.coordSystem.getNodeBoundaryPoint(result.nodeName, fromPoint)
    }

    if (outAngle !== null && inAngle !== null) {
      // Curved path
      const distance = Math.sqrt(
        Math.pow(adjustedTo.x - adjustedFrom.x, 2) +
        Math.pow(adjustedTo.y - adjustedFrom.y, 2)
      ) / 3

      const control1 = new Point(
        adjustedFrom.x + distance * Math.cos(outAngle * Math.PI / 180),
        adjustedFrom.y + distance * Math.sin(outAngle * Math.PI / 180)
      )
      const control2 = new Point(
        adjustedTo.x + distance * Math.cos(inAngle * Math.PI / 180),
        adjustedTo.y + distance * Math.sin(inAngle * Math.PI / 180)
      )

      return {
        segment: new ASTNode(NodeType.CURVE_SEGMENT, {
          from: adjustedFrom,
          control1,
          control2,
          to: adjustedTo
        }),
        toNodeName: result.nodeName
      }
    }

    return {
      segment: new ASTNode(NodeType.LINE_SEGMENT, {
        from: adjustedFrom,
        to: adjustedTo,
        options,
        fromNodeName,
        toNodeName: result.nodeName
      }),
      toNodeName: result.nodeName
    }
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

  parsePlot(fromPoint) {
    this.advance() // consume "plot"

    // Get domain and samples from draw command options
    let domain = { min: 0, max: 1 }
    let samples = 100

    if (this.currentDrawOptions) {
      for (const opt of this.currentDrawOptions) {
        const [key, value] = this.parseOptionKeyValue(opt)
        if (key === "domain" && value) {
          const domainMatch = value.match(/^(-?\d+\.?\d*)\s*:\s*(-?\d+\.?\d*)$/)
          if (domainMatch) {
            domain.min = parseFloat(domainMatch[1])
            domain.max = parseFloat(domainMatch[2])
          }
        } else if (key === "samples" && value) {
          samples = parseInt(value)
        }
      }
    }

    // Parse the plot expression: (\x, {expression})
    // The coordinate contains the variable and expression
    let xVar = "\\x"
    let expression = "0"

    if (this.peek()?.type === TokenType.COORDINATE) {
      const coordToken = this.advance()
      const coordValue = coordToken.value

      // Parse (\x, {expression}) format
      // The expression might be wrapped in braces
      const plotMatch = coordValue.match(/^(\\[a-z]+)\s*,\s*\{(.+)\}$/)
      if (plotMatch) {
        xVar = plotMatch[1]
        expression = plotMatch[2]
      } else {
        // Try simpler format: (\x, expression)
        const simpleMatch = coordValue.match(/^(\\[a-z]+)\s*,\s*(.+)$/)
        if (simpleMatch) {
          xVar = simpleMatch[1]
          expression = simpleMatch[2]
        }
      }
    }

    // Generate points by evaluating the expression
    const points = []
    const step = (domain.max - domain.min) / (samples - 1)

    for (let i = 0; i < samples; i++) {
      const x = domain.min + i * step
      const y = this.evaluateExpression(expression, xVar, x)
      points.push(new Point(x, y))
    }

    return new ASTNode(NodeType.PLOT_SEGMENT, {
      from: fromPoint,
      points,
      domain,
      samples,
      expression
    })
  }

  /**
   * Evaluate a mathematical expression with a variable
   */
  evaluateExpression(expression, variable, value) {
    try {
      // Replace the variable with its value
      let expr = expression.replace(new RegExp(variable.replace("\\", "\\\\"), "g"), `(${value})`)

      // Handle TikZ's 'r' suffix for radians (e.g., "2*pi*x r" means the result is in radians)
      // In TikZ, sin(x r) means x is in radians, otherwise degrees
      // We'll convert degrees to radians for trig functions
      expr = expr.replace(/\s+r\b/g, "") // Remove 'r' suffix - we'll use radians

      // Replace pi with Math.PI
      expr = expr.replace(/\bpi\b/g, `(${Math.PI})`)

      // Replace trig functions
      expr = expr.replace(/\bsin\s*\(/g, "Math.sin(")
      expr = expr.replace(/\bcos\s*\(/g, "Math.cos(")
      expr = expr.replace(/\btan\s*\(/g, "Math.tan(")
      expr = expr.replace(/\bsqrt\s*\(/g, "Math.sqrt(")
      expr = expr.replace(/\babs\s*\(/g, "Math.abs(")
      expr = expr.replace(/\bexp\s*\(/g, "Math.exp(")
      expr = expr.replace(/\bln\s*\(/g, "Math.log(")
      expr = expr.replace(/\blog\s*\(/g, "Math.log10(")
      expr = expr.replace(/\bpow\s*\(/g, "Math.pow(")

      // Handle exponentiation: x^2 -> Math.pow(x, 2)
      expr = expr.replace(/\(([^)]+)\)\s*\^\s*(\d+\.?\d*|\([^)]+\))/g, "Math.pow($1, $2)")
      expr = expr.replace(/(\d+\.?\d*)\s*\^\s*(\d+\.?\d*|\([^)]+\))/g, "Math.pow($1, $2)")

      // Evaluate the expression
      const result = Function(`"use strict"; return (${expr})`)()
      return isNaN(result) || !isFinite(result) ? 0 : result
    } catch (e) {
      console.warn("Expression evaluation error:", e.message, "for:", expression)
      return 0
    }
  }

  parseInlineNode(fromPoint) {
    this.advance() // consume "node"

    const options = this.parseOptionsBlock()
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

    // Parse node options (pass text for dimension estimation)
    const nodeOptions = this.parseNodeOptions(options, text)

    // Register the node
    if (name) {
      const anchors = this.coordSystem.calculateAnchors(
        fromPoint,
        nodeOptions.shape,
        nodeOptions.width,
        nodeOptions.height
      )
      this.coordSystem.registerNode(name, fromPoint, anchors, nodeOptions.shape, nodeOptions.width, nodeOptions.height)
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
