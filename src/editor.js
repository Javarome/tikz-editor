/**
 * TikZ Editor UI Controller
 */

import { parse } from "./parser.js"
import { Renderer } from "./renderer.js"

export class TikZEditor {
  constructor(options = {}) {
    this.textareaId = options.textareaId || "tikz-input"
    this.previewId = options.previewId || "tikz-preview"
    this.errorId = options.errorId || "tikz-errors"
    this.scaleId = options.scaleId || "tikz-scale"
    this.scaleValueId = options.scaleValueId || "tikz-scale-value"

    this.textarea = null
    this.preview = null
    this.errorDiv = null
    this.scaleSlider = null
    this.scaleValue = null

    this.scale = options.scale || 50
    this.debounceDelay = options.debounceDelay || 150
    this.debounceTimer = null

    this.renderer = new Renderer({ scale: this.scale })
  }

  init() {
    this.textarea = document.getElementById(this.textareaId)
    this.preview = document.getElementById(this.previewId)
    this.errorDiv = document.getElementById(this.errorId)
    this.scaleSlider = document.getElementById(this.scaleId)
    this.scaleValue = document.getElementById(this.scaleValueId)

    if (!this.textarea || !this.preview) {
      console.error("TikZ Editor: Could not find required elements")
      return
    }

    // Set up event listeners
    this.textarea.addEventListener("input", () => this.onInput())
    this.textarea.addEventListener("keydown", (e) => this.onKeyDown(e))

    if (this.scaleSlider) {
      this.scaleSlider.addEventListener("input", () => this.onScaleChange())
      this.scaleSlider.value = this.scale
    }

    if (this.scaleValue) {
      this.scaleValue.textContent = this.scale
    }

    // Initial render
    this.render()
  }

  onInput() {
    // Debounce rendering
    clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.render(), this.debounceDelay)
  }

  onKeyDown(e) {
    // Handle Tab key for indentation
    if (e.key === "Tab") {
      e.preventDefault()
      const start = this.textarea.selectionStart
      const end = this.textarea.selectionEnd
      const value = this.textarea.value

      this.textarea.value = value.substring(0, start) + "  " + value.substring(end)
      this.textarea.selectionStart = this.textarea.selectionEnd = start + 2
      this.onInput()
    }
  }

  onScaleChange() {
    this.scale = parseInt(this.scaleSlider.value)
    if (this.scaleValue) {
      this.scaleValue.textContent = this.scale
    }
    this.renderer.setScale(this.scale)
    this.render()
  }

  render() {
    const input = this.textarea.value

    // Clear previous content
    this.preview.innerHTML = ""
    if (this.errorDiv) {
      this.errorDiv.innerHTML = ""
      this.errorDiv.style.display = "none"
    }

    if (!input.trim()) {
      return
    }

    try {
      // Parse the input
      const { ast, errors, coordSystem } = parse(input)

      // Show any parse errors
      if (errors.length > 0) {
        this.showErrors(errors)
      }

      // Render to SVG
      this.renderer = new Renderer({ scale: this.scale })
      const svg = this.renderer.render(ast, coordSystem)
      this.preview.appendChild(svg)

    } catch (e) {
      this.showErrors([{
        message: e.message,
        position: { line: 0, column: 0 }
      }])
    }
  }

  showErrors(errors) {
    if (!this.errorDiv) return

    this.errorDiv.style.display = "block"
    this.errorDiv.innerHTML = errors.map(err => {
      const pos = err.position ? `Line ${err.position.line}, Col ${err.position.column}: ` : ""
      return `<div class="error-item">${pos}${this.escapeHtml(err.message)}</div>`
    }).join("")
  }

  escapeHtml(text) {
    const div = document.createElement("div")
    div.textContent = text
    return div.innerHTML
  }

  setValue(code) {
    this.textarea.value = code
    this.render()
  }

  getValue() {
    return this.textarea.value
  }

  setScale(scale) {
    this.scale = scale
    if (this.scaleSlider) {
      this.scaleSlider.value = scale
    }
    if (this.scaleValue) {
      this.scaleValue.textContent = scale
    }
    this.renderer.setScale(scale)
    this.render()
  }
}

// Example snippets
export const EXAMPLES = {
  basic: `% Basic shapes
\\draw (0,0) -- (2,0) -- (2,1) -- (0,1) -- cycle;
\\draw[red, thick] (1,0.5) circle (0.3);`,

  arrows: `% Arrows and lines
\\draw[->] (0,0) -- (2,0);
\\draw[<->] (0,0.5) -- (2,0.5);
\\draw[->, thick, blue] (0,1) -- (2,1);`,

  curves: `% Bezier curves
\\draw (0,0) .. controls (1,1) and (2,1) .. (3,0);
\\draw[red] (0,0) to[out=45, in=135] (3,0);`,

  nodes: `% Nodes with text
\\node[draw] at (0,0) {Hello};
\\node[draw, fill=yellow, circle] at (2,0) {World};`,

  diagram: `% A simple diagram
\\draw[thick, ->] (0,0) -- (3,0);
\\draw[thick, ->] (0,0) -- (0,2);
\\draw[blue, thick] (0,0) -- (2,1.5);
\\draw[red, dashed] (2,0) -- (2,1.5);
\\draw[red, dashed] (0,1.5) -- (2,1.5);
\\node at (2,1.5) [above right] {P};
\\node at (3,0) [below] {x};
\\node at (0,2) [left] {y};`,

  full: `% Complete example
\\draw[help lines, step=0.5] (-0.5,-0.5) grid (3.5,2.5);
\\draw[thick, ->] (-0.5,0) -- (3.5,0) node[right] {x};
\\draw[thick, ->] (0,-0.5) -- (0,2.5) node[above] {y};
\\draw[blue, thick] (0,0) .. controls (1,2) and (2,2) .. (3,0);
\\fill[red] (0,0) circle (0.1);
\\fill[red] (3,0) circle (0.1);
\\node[draw, fill=white] at (1.5,1.5) {Curve};`,

  styles: `% Using style definitions
\\begin{tikzpicture}[
  box/.style={draw, rounded corners, fill=yellow},
  arrow/.style={->, thick, blue}
]
\\node[box] (A) at (0,0) {Start};
\\node[box] (B) at (3,0) {End};
\\draw[arrow] (A) -- (B);
\\end{tikzpicture}`
}

// Auto-initialize if DOM is ready
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      const editor = new TikZEditor()
      editor.init()
      window.tikzEditor = editor
    })
  } else {
    const editor = new TikZEditor()
    editor.init()
    window.tikzEditor = editor
  }
}
