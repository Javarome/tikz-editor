/**
 * TikZ Editor - Main entry point
 */

import { EXAMPLES, TikZEditor } from "./editor.js"

// Initialize editor
const editor = new TikZEditor()
editor.init()
window.tikzEditor = editor

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
