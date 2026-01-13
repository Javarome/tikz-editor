import { parse } from "./parser.js"
import { Renderer } from "./renderer.js"

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
\\end{tikzpicture}`,

  positioning: `% Positioning and edge labels
\\begin{tikzpicture}[
  font=\\small,
  node distance=14mm,
  box/.style={draw, rounded corners, align=center, inner sep=6pt},
  arrow/.style={-Latex, thick},
  note/.style={align=left, font=\\footnotesize}
]

\\node[box] (chi) {$\\chi$\\\\\\footnotesize infra-physical\\\\\\footnotesize relational substrate};

\\node[box, below=of chi] (chieff) {$\\chi_{\\mathrm{eff}}$\\\\\\footnotesize physical effective reality\\\\\\footnotesize (projectable regime)};

\\node[box, below=of chieff] (obs) {Observables\\\\\\footnotesize context-dependent\\\\\\footnotesize operational quantities};

\\draw[arrow] (chi) -- node[right=2mm, note] {infra-physical\\\\projection $\\pi$\\\\\\footnotesize (generally non-injective)} (chieff);
\\draw[arrow] (chieff) -- node[right=2mm, note] {operational\\\\projection $\\mathcal{O}$\\\\\\footnotesize (contextual access)} (obs);

\\end{tikzpicture}`,

  subsystems: `% Subsystems diagram with dashed box
\\begin{tikzpicture}[
  font=\\small,
  node distance=10mm,
  box/.style={draw, rounded corners, align=center, inner sep=6pt},
  arrow/.style={-Latex, thick},
  note/.style={align=left, font=\\footnotesize},
  dashedbox/.style={draw, dashed, rounded corners, inner sep=6pt}
]

\\node[box] (chi) {$\\chi$\\\\\\footnotesize infra-physical substrate};

\\node[box, below=of chi] (chieff) {$\\chi_{\\mathrm{eff}}$\\\\\\footnotesize factorisable regime};

\\node[dashedbox, below=of chieff, minimum width=6.6cm] (decomp) {
  \\begin{tabular}{c}
    \\footnotesize $\\chi_{\\mathrm{eff}} \\simeq \\chi_{\\mathrm{eff}}^{(A)} \\otimes \\chi_{\\mathrm{eff}}^{(B)}$\\\\
    \\footnotesize (independent subsystems)
  \\end{tabular}
};

\\node[box, below left=10mm and 12mm of decomp] (obsA) {Local observables\\\\in subsystem $A$};
\\node[box, below right=10mm and 12mm of decomp] (obsB) {Local observables\\\\in subsystem $B$};

\\draw[arrow] (chi) -- node[right=2mm, note] {infra-physical\\\\projection $\\pi$} (chieff);
\\draw[arrow] (chieff) -- (decomp);

\\draw[arrow] (decomp) -- node[left=2mm, note] {operational\\\\projection $\\mathcal{O}_A$} (obsA);
\\draw[arrow] (decomp) -- node[right=2mm, note] {operational\\\\projection $\\mathcal{O}_B$} (obsB);

\\node[note, below=7mm of decomp, align=center] (compat)
{\\footnotesize Compatible operational readings: joint assignment of local observables is well-defined.};

\\end{tikzpicture}`,

  wave: `% Wave with plot command
\\begin{tikzpicture}[scale=1.1]

% Axes
\\draw[->] (-0.2,0) -- (6.5,0) node[right]{Space};
\\draw[->] (0,-0.2) -- (0,3.5) node[above]{Time};

% Wave
\\draw[thick, blue, domain=0:6, samples=200]
plot (\\x,{0.6*sin(2*pi*\\x/1.5 r) + 0.4*\\x/6});

% Particle crest
\\draw[red, thick] (3.2,1.3) circle (0.15);
\\node[red, right] at (3.4,1.3) {Topological excitation};

% Annotation
\\node[blue] at (4.5,2.4) {effective $\\chi$ relaxation};

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
