import { basicSetup } from "codemirror"
import { EditorView, placeholder } from "@codemirror/view"
import { EditorState } from "@codemirror/state"
import { indentSelection } from "@codemirror/commands"

export class Textarea extends EventTarget {

  constructor(parent, placeholderText) {
    super()
    this.editorView = new EditorView({
      parent,
      state: EditorState.create({
        extensions: [
          basicSetup,
          placeholder(placeholderText),
          //          EditorView.lineWrapping,
          // tikzLang(),
          EditorView.updateListener.of((viewUpdate) => {
            if (viewUpdate.docChanged) {
              this.dispatchEvent(new UIEvent("input"))
            }
          })]
      })
      /*dispatch: (transaction) => {
        const view = this.editorView
        view.update([transaction])
        if (transaction.docChanged) {
          const userEvent = transaction.annotation(Transaction.userEvent)
          if (userEvent) {
            const newSelection = transaction.newSelection ?? transaction.startState.selection.map(transaction.changes)
            view.dispatch({ selection: newSelection })
            this.trigger(TagEditor.triggeredEvents.userChange, transaction)
          }
        }
      }*/
    })
  }

  get value() {
    return this.editorView.state.doc.toString()
  }

  /**
   * Set the HTML to edit.
   *
   * @param {string} insert
   */
  set value(insert) {
    const view = this.editorView
    const state = view.state
    const editorChanges = { from: 0, to: state.doc.length, insert }
    const editorTransaction = state.update({ changes: editorChanges })
    view.dispatch(editorTransaction)
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
    indentSelection({ state, dispatch: transaction => (view.update([transaction])) })
    view.dispatch({ selection: { anchor: 0, head: 0 } })
  }
}
