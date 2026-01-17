/**
 * TikZ Editor - Main entry point
 */

import { TikZEditor } from "./editor.js"
import basic from "./example/basic.tikz?raw"
import arrows from "./example/arrows.tikz?raw"
import curves from "./example/curves.tikz?raw"
import nodes from "./example/nodes.tikz?raw"
import diagram from "./example/diagram.tikz?raw"
import full from "./example/full.tikz?raw"
import styles from "./example/styles.tikz?raw"
import positioning from "./example/positioning.tikz?raw"
import subsystems from "./example/subsystems.tikz?raw"
import wave from "./example/wave.tikz?raw"
import concentric from "./example/concentric.tikz?raw"
import projection from "./example/projection.tikz?raw"
import decay from "./example/decay.tikz?raw"

// Initialize editor
const editor = new TikZEditor()
editor.init()
window.tikzEditor = editor

export const EXAMPLES = {
  basic, arrows, curves, nodes, diagram, full, styles, positioning, subsystems, wave, concentric, projection, decay
}

// Example selector
const exampleSelect = document.getElementById("example-select")
exampleSelect.addEventListener("change", () => {
  const example = EXAMPLES[exampleSelect.value]
  if (example) {
    editor.setValue(example)
  }
})

// Resizable divider
const divider = document.getElementById("divider")
const leftPanel = divider.previousElementSibling
const rightPanel = divider.nextElementSibling
let isDragging = false

divider.addEventListener("mousedown", (e) => {
  isDragging = true
  document.body.style.cursor = "col-resize"
  document.body.style.userSelect = "none"
})

document.addEventListener("mousemove", (e) => {
  if (!isDragging) return

  const containerRect = divider.parentElement.getBoundingClientRect()
  const percentage = ((e.clientX - containerRect.left) / containerRect.width) * 100

  if (percentage > 20 && percentage < 80) {
    leftPanel.style.flex = `0 0 ${percentage}%`
    rightPanel.style.flex = `0 0 ${100 - percentage}%`
  }
})

document.addEventListener("mouseup", () => {
  isDragging = false
  document.body.style.cursor = ""
  document.body.style.userSelect = ""
})
