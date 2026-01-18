/**
 * TikZ Editor - Main entry point
 */

import { TikZEditor } from "./editor.js"

// Initialize editor
const editor = new TikZEditor()
editor.init()
window.tikzEditor = editor

export const EXAMPLES = {
  basic: "/example/basic.tikz",
  arrows: "/example/arrows.tikz",
  curves: "/example/curves.tikz",
  nodes: "/example/nodes.tikz",
  diagram: "/example/diagram.tikz",
  full: "/example/full.tikz",
  styles: "/example/styles.tikz",
  positioning: "/example/positioning.tikz",
  subsystems: "/example/subsystems.tikz",
  wave: "/example/wave.tikz",
  concentric: "/example/concentric.tikz",
  projection: "/example/projection.tikz",
  decay: "/example/decay.tikz",
  entangled: "/example/entangled.tikz",
  comparison: "/example/comparison.tikz",
  oriented: "/example/oriented.tikz",
  vortical: "/example/vortical.tikz",
  skyrmion: "/example/skyrmion.tikz",
  spectral: "/example/spectral.tikz",
  hubble: "/example/hubble.tikz",
  fibration: "/example/fibration.tikz",
  spectrum: "/example/spectrum.tikz",
  bell: "/example/bell.tikz"
}
// Example selector
const exampleSelect = document.getElementById("example-select")

async function load(url) {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      alert(response.statusText)
      return
    }
    const example = await response.text()
    if (example) {
      editor.setValue(example)
    }
  } catch (e) {
    alert(`Could not load ${url}: ${e.message}`)
  }
}

const searchParams = new URLSearchParams(window.location.search)
let url = searchParams.get("file")
if (url) {
  load(url)
}

exampleSelect.addEventListener("change", async () => {
  let value = exampleSelect.value
  if (value) {
    let url = EXAMPLES[value]
    if (!url) {
      alert(`Could not find example with ID "${value}"`)
      return
    }
    await load(url)
  } else {
    editor.setValue("")
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
