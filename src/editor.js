import { parse } from "./parser.js"
import { Renderer } from "./renderer.js"
import { Textarea } from "./textarea.js"

/**
 * TikZ Editor UI Controller
 */
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
    const parent = document.getElementById(this.textareaId)
    this.preview = document.getElementById(this.previewId)
    this.errorDiv = document.getElementById(this.errorId)
    this.scaleSlider = document.getElementById(this.scaleId)
    this.scaleValue = document.getElementById(this.scaleValueId)

    if (!parent || !this.preview) {
      console.error("TikZ Editor: Could not find required elements")
      return
    }
    this.textarea = new Textarea(parent)

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
