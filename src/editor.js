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

\\end{tikzpicture}`,

  concentric: `% Concentric circles with foreach and snake decoration
\\begin{tikzpicture}[scale=1]

% Central mass
\\filldraw[black] (0,0) circle (0.25);
\\node[below] at (0,-0.35) {Localized projected configuration};

% Effective ordering contours
\\foreach \\r in {0.8,1.2,1.7,2.3} {
  \\draw[blue!60] (0,0) circle (\\r);
}

% Distortion
\\draw[blue, thick, decorate, decoration={snake, amplitude=0.5mm}]
(0,0) circle (1.7);

% Arrows
\\draw[->, gray] (2.8,0) -- (1.8,0);
\\node[right] at (2.8,0.2) {Reduced admissible ordering};

\\end{tikzpicture}`,

  projection: `% Projection saturation diagram
\\begin{tikzpicture}[font=\\small]

% --- Geometry constants (implicit): boxes are placed in absolute coordinates ---
% Left box: chi
\\draw[thick,rounded corners=2pt] (0,0) rectangle (5.0,4.0);
\\node at (2.5,3.55) {$\\chi$};
\\node[font=\\footnotesize] at (2.5,3.20) {substrate (micro-configurations)};

% Middle box: projection / horizon boundary
\\draw[thick,rounded corners=2pt] (6.0,0) rectangle (9.1,4.0);
\\node at (7.55,3.55) {$\\Pi$};
\\node[font=\\scriptsize] at (7.55,3.20) {projection to $g_{\\mu\\nu}$};

% Right box: g_H (keep minimal to avoid overlap)
\\draw[thick,rounded corners=2pt] (10.1,0) rectangle (15.8,4.0);
\\node at (12.95,3.55) {$g_H$};
\\node[font=\\footnotesize] at (12.95,3.20) {effective horizon geometry};

% --- Microstates (left box) ---
\\foreach \\x/\\y in {0.8/2.8,1.7/3.0,2.6/2.8,3.5/3.0,4.2/2.7,
1.0/2.0,2.0/2.1,3.0/2.0,4.0/2.1,
0.9/1.1,2.0/1.0,3.1/1.2,4.1/1.0}{
  \\draw[thick] (\\x,\\y) circle (0.12);
}
\\node[font=\\scriptsize] at (2.5,0.35) {Many distinct $\\chi$ microstates};

% --- Arrow to middle box ---
\\draw[->,thick] (5.0,2.0) -- (6.0,2.0);
\\node[font=\\scriptsize] at (5.5,2.35) {many-to-one};

% --- Horizon boundary line inside middle box ---
\\draw[thick] (7.55,0.45) -- (7.55,3.55);
\\node[font=\\scriptsize,rotate=90] at (7.82,2.0) {horizon boundary};
\\node[font=\\scriptsize] at (6.55,3.85) {$N(r)\\to 0$};
\\node[font=\\scriptsize] at (7.55,0.20) {non-injective};

% --- Arrow to right box ---
\\draw[->,thick] (9.1,2.0) -- (10.1,2.0);
\\node[font=\\scriptsize] at (9.6,2.35) {$\\Pi(\\chi)\\mapsto g_H$};

% --- Horizon disk + pixels (right box) ---
\\draw[thick] (12.95,1.95) circle (1.30);
\\node[font=\\scriptsize] at (12.95,3.80) {projection saturation: $A \\sim N\\,\\hbar_\\chi$};

% pixels inside the disk (all are safely inside)
\\foreach \\x/\\y in {12.25/2.55,12.65/2.55,13.05/2.55,13.45/2.55,
12.05/2.15,12.45/2.15,12.85/2.15,13.25/2.15,13.65/2.15,
12.05/1.75,12.45/1.75,12.85/1.75,13.25/1.75,13.65/1.75,
12.05/1.35,12.45/1.35,12.85/1.35,13.25/1.35,13.65/1.35,
12.25/0.95,12.65/0.95,13.05/0.95,13.45/0.95}{
  \\draw[thick] (\\x,\\y) rectangle ++(0.18,0.18);
}

% --- Dotted arrows: selected microstates collapse to same horizon pixel ---
\\draw[->,thick,densely dotted] (1.0,2.8) .. controls (6.5,2.7) and (10.8,2.3) .. (12.65,2.05);
\\draw[->,thick,densely dotted] (2.0,2.1) .. controls (6.5,2.0) and (10.8,2.0) .. (12.65,2.05);
\\draw[->,thick,densely dotted] (4.1,1.0) .. controls (6.5,1.3) and (10.8,1.7) .. (12.65,2.05);

% --- External annotations (kept outside boxes to avoid overlap) ---
\\node[font=\\scriptsize,align=left] at (2.5,4.55) {Fiber multiplicity: $\\Pi^{-1}(g_H)$};
\\node[font=\\scriptsize,align=left] at (14.95,2.80) {$S \\sim \\log |\\Pi^{-1}(g_H)|$};
\\node[font=\\scriptsize,align=center] at (12.95,0.35)
  {fourfold degeneracy per projected pixel\\\\$\\Rightarrow\\ S \\propto A/4$};

\\end{tikzpicture}`,

  decay: `% Factorization/decay diagram
\\begin{tikzpicture}[
  box/.style={draw, rounded corners, align=center, inner sep=6pt},
  arr/.style={->, thick},
  lab/.style={font=\\small, align=center}
]

% Parent
\\node[box] (A) {$\\chi_{\\mathrm{eff},A}$\\\\\\footnotesize metastable\\\\\\footnotesize (single knot)};

% Trigger
\\node[box, right=2.7cm of A, yshift=1.1cm] (T) {Trigger\\\\\\footnotesize projective variability\\\\\\footnotesize (threshold crossing)};

% Branching
\\node[box, right=2.5cm of A, yshift=-0.8cm] (B1) {$\\chi_{\\mathrm{eff},B_1}$};
\\node[box, below=0.4cm of B1] (B2) {$\\chi_{\\mathrm{eff},B_2}$};
\\node[box, below=0.4cm of B2] (B3) {$\\chi_{\\mathrm{eff},B_3}$};

% Result
\\node[box, right=2.5cm of B2] (R) {$\\chi_{\\mathrm{eff},R}$\\\\\\footnotesize new stable\\\\\\footnotesize configuration};

% Arrows
\\draw[arr] (A) -- node[above, lab] {internal\\\\instability} (T);
\\draw[arr] (T) -| (B1);
\\draw[arr] (A) -- (B1);
\\draw[arr] (A) -- (B2);
\\draw[arr] (A) -- (B3);
\\draw[arr] (B1) -- (R);
\\draw[arr] (B2) -- (R);
\\draw[arr] (B3) -- (R);

% Quanta release
\\node[box, below=1.5cm of R] (Q) {$\\Delta\\chi$\\\\\\footnotesize released quanta};
\\draw[arr, dashed] (R) -- node[right, lab] {energy\\\\conservation} (Q);

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
