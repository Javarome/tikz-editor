/**
 * TikZ Lexer - Tokenizes TikZ source code
 */

export const TokenType = {
  COMMAND: "COMMAND",           // \draw, \fill, \node, etc.
  COORDINATE: "COORDINATE",     // (x,y), (name), (angle:radius)
  OPTION_START: "OPTION_START", // [
  OPTION_END: "OPTION_END",     // ]
  BRACE_START: "BRACE_START",   // {
  BRACE_END: "BRACE_END",       // }
  LINE_TO: "LINE_TO",           // --
  CURVE_TO: "CURVE_TO",         // .. controls
  TO: "TO",                     // to
  CYCLE: "CYCLE",               // cycle
  ARC: "ARC",                   // arc
  CIRCLE: "CIRCLE",             // circle
  ELLIPSE: "ELLIPSE",           // ellipse
  RECTANGLE: "RECTANGLE",       // rectangle
  GRID: "GRID",                 // grid
  NODE: "NODE",                 // node (inline)
  AT: "AT",                     // at
  AND: "AND",                   // and
  CONTROLS: "CONTROLS",         // controls
  SEMICOLON: "SEMICOLON",       // ;
  COMMA: "COMMA",               // ,
  EQUALS: "EQUALS",             // =
  COLON: "COLON",               // :
  NUMBER: "NUMBER",             // 1, 2.5, -3, etc.
  IDENTIFIER: "IDENTIFIER",     // color names, option names, etc.
  STRING: "STRING",             // text content
  PLUS: "PLUS",                 // + (for relative coords)
  SLASH: "SLASH",               // / (for style definitions)
  DOT: "DOT",                   // . (for .style)
  EOF: "EOF",
  ERROR: "ERROR"
}

export class Token {
  constructor(type, value, position) {
    this.type = type
    this.value = value
    this.position = position
  }
}

export class Lexer {
  constructor(input) {
    this.input = input
    this.position = 0
    this.line = 1
    this.column = 1
  }

  peek(offset = 0) {
    return this.input[this.position + offset]
  }

  advance() {
    const char = this.input[this.position]
    this.position++
    if (char === "\n") {
      this.line++
      this.column = 1
    } else {
      this.column++
    }
    return char
  }

  skipWhitespace() {
    while (this.position < this.input.length) {
      const char = this.peek()
      if (char === " " || char === "\t" || char === "\n" || char === "\r") {
        this.advance()
      } else if (char === "%") {
        // Skip comments
        while (this.position < this.input.length && this.peek() !== "\n") {
          this.advance()
        }
      } else {
        break
      }
    }
  }

  getPosition() {
    return { line: this.line, column: this.column, offset: this.position }
  }

  isDigit(char) {
    return char >= "0" && char <= "9"
  }

  isAlpha(char) {
    return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z")
  }

  isAlphaNumeric(char) {
    return this.isAlpha(char) || this.isDigit(char) || char === "_" || char === "-"
  }

  readNumber() {
    const pos = this.getPosition()
    let value = ""

    // Optional negative sign
    if (this.peek() === "-" || this.peek() === "+") {
      value += this.advance()
    }

    // Integer part
    while (this.position < this.input.length && this.isDigit(this.peek())) {
      value += this.advance()
    }

    // Decimal part
    if (this.peek() === "." && this.isDigit(this.peek(1))) {
      value += this.advance() // .
      while (this.position < this.input.length && this.isDigit(this.peek())) {
        value += this.advance()
      }
    }

    return new Token(TokenType.NUMBER, parseFloat(value), pos)
  }

  readIdentifier() {
    const pos = this.getPosition()
    let value = ""

    while (this.position < this.input.length && this.isAlphaNumeric(this.peek())) {
      value += this.advance()
    }

    // Check for keywords
    const keywords = {
      "to": TokenType.TO,
      "cycle": TokenType.CYCLE,
      "arc": TokenType.ARC,
      "circle": TokenType.CIRCLE,
      "ellipse": TokenType.ELLIPSE,
      "rectangle": TokenType.RECTANGLE,
      "grid": TokenType.GRID,
      "node": TokenType.NODE,
      "at": TokenType.AT,
      "and": TokenType.AND,
      "controls": TokenType.CONTROLS
    }

    const type = keywords[value] || TokenType.IDENTIFIER
    return new Token(type, value, pos)
  }

  readCommand() {
    const pos = this.getPosition()
    this.advance() // skip backslash

    let value = "\\"
    while (this.position < this.input.length && this.isAlpha(this.peek())) {
      value += this.advance()
    }

    return new Token(TokenType.COMMAND, value, pos)
  }

  readCoordinate() {
    const pos = this.getPosition()
    this.advance() // skip (

    let value = ""
    let depth = 1

    while (this.position < this.input.length && depth > 0) {
      const char = this.peek()
      if (char === "(") {
        depth++
      } else if (char === ")") {
        depth--
        if (depth === 0) {
          this.advance()
          break
        }
      }
      value += this.advance()
    }

    return new Token(TokenType.COORDINATE, value.trim(), pos)
  }

  readBraceContent() {
    const pos = this.getPosition()
    this.advance() // skip {

    let value = ""
    let depth = 1

    while (this.position < this.input.length && depth > 0) {
      const char = this.peek()
      if (char === "{") {
        depth++
        value += this.advance()
      } else if (char === "}") {
        depth--
        if (depth === 0) {
          this.advance()
          break
        }
        value += this.advance()
      } else {
        value += this.advance()
      }
    }

    return new Token(TokenType.STRING, value, pos)
  }

  nextToken() {
    this.skipWhitespace()

    if (this.position >= this.input.length) {
      return new Token(TokenType.EOF, null, this.getPosition())
    }

    const char = this.peek()
    const pos = this.getPosition()

    // Two-character tokens
    if (char === "-" && this.peek(1) === "-") {
      this.advance()
      this.advance()
      return new Token(TokenType.LINE_TO, "--", pos)
    }

    if (char === "." && this.peek(1) === ".") {
      this.advance()
      this.advance()
      return new Token(TokenType.CURVE_TO, "..", pos)
    }

    // Single character tokens
    switch (char) {
      case "\\":
        return this.readCommand()
      case "(":
        return this.readCoordinate()
      case "{":
        return this.readBraceContent()
      case "[":
        this.advance()
        return new Token(TokenType.OPTION_START, "[", pos)
      case "]":
        this.advance()
        return new Token(TokenType.OPTION_END, "]", pos)
      case ";":
        this.advance()
        return new Token(TokenType.SEMICOLON, ";", pos)
      case ",":
        this.advance()
        return new Token(TokenType.COMMA, ",", pos)
      case "=":
        this.advance()
        return new Token(TokenType.EQUALS, "=", pos)
      case ":":
        this.advance()
        return new Token(TokenType.COLON, ":", pos)
      case "+":
        this.advance()
        return new Token(TokenType.PLUS, "+", pos)
      case "/":
        this.advance()
        return new Token(TokenType.SLASH, "/", pos)
      case ".":
        this.advance()
        return new Token(TokenType.DOT, ".", pos)
    }

    // Numbers (including negative)
    if (this.isDigit(char) || (char === "-" && this.isDigit(this.peek(1)))) {
      return this.readNumber()
    }

    // Identifiers and keywords
    if (this.isAlpha(char)) {
      return this.readIdentifier()
    }

    // Unknown character
    this.advance()
    return new Token(TokenType.ERROR, char, pos)
  }

  tokenize() {
    const tokens = []
    let token

    do {
      token = this.nextToken()
      tokens.push(token)
    } while (token.type !== TokenType.EOF)

    return tokens
  }
}
