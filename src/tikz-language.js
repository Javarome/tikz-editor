import { bracketMatching, LanguageSupport, StreamLanguage } from "@codemirror/language"
import { autocompletion, closeBrackets } from "@codemirror/autocomplete"

const tikzCompletionOptions = [
  { label: "\\draw", type: "keyword", detail: "path" },
  { label: "\\path", type: "keyword", detail: "path" },
  { label: "\\fill", type: "keyword", detail: "path" },
  { label: "\\filldraw", type: "keyword", detail: "path" },
  { label: "\\shade", type: "keyword", detail: "path" },
  { label: "\\shadedraw", type: "keyword", detail: "path" },
  { label: "\\clip", type: "keyword", detail: "path" },
  { label: "\\node", type: "keyword", detail: "node" },
  { label: "\\coordinate", type: "keyword", detail: "node" },
  { label: "\\foreach", type: "keyword", detail: "loop" },
  { label: "\\matrix", type: "keyword", detail: "matrix" },
  { label: "\\pgfmathsetmacro", type: "keyword", detail: "macro" },
  { label: "\\tikzset", type: "keyword", detail: "styles" },
  { label: "cycle", type: "keyword" },
  { label: "to", type: "keyword" },
  { label: "controls", type: "keyword" },
  { label: "and", type: "keyword" },
  { label: "at", type: "keyword" },
  { label: "node", type: "keyword" },
  { label: "plot", type: "keyword" },
  { label: "grid", type: "keyword" },
  { label: "arc", type: "keyword" },
  { label: "circle", type: "keyword" },
  { label: "ellipse", type: "keyword" },
  { label: "rectangle", type: "keyword" }
]

const tikzCompletionSource = (context) => {
  const word = context.matchBefore(/\\?[A-Za-z]*$/)
  if (!word || (word.from === word.to && !context.explicit)) return null

  return {
    from: word.from,
    options: tikzCompletionOptions,
    validFor: /\\?[A-Za-z]*$/
  }
}

const tikzLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null

    const char = stream.peek()
    if (char === "%") {
      stream.skipToEnd()
      return "comment"
    }

    if (char === "\\") {
      stream.next()
      stream.eatWhile(/[A-Za-z@]+/)
      return "keyword"
    }

    if (char === "(") {
      stream.next()
      let depth = 1
      while (!stream.eol() && depth > 0) {
        const nextChar = stream.next()
        if (nextChar === "(") depth += 1
        if (nextChar === ")") depth -= 1
      }
      return "atom"
    }

    if (stream.match(/--|<->|->|<-|\.\./)) return "operator"
    if (stream.match(/[+-]?\d+(\.\d+)?/)) return "number"
    if (stream.match(/[;,=]/)) return "punctuation"
    if (stream.match(/[\[\]{}]/)) return "bracket"
    if (stream.match(/[A-Za-z_][A-Za-z0-9_-]*/)) return "variableName"

    stream.next()
    return null
  }
})

export function tikz(config = {}) {
  const options = {
    enableAutocomplete: config.enableAutocomplete ?? true,
    autoCloseBrackets: config.autoCloseBrackets ?? true
  }

  const extensions = [
    tikzLanguage.data.of({
      commentTokens: { line: "%" },
      closeBrackets: { brackets: ["(", "[", "{", "'", "\""] },
      wordChars: "-_:"
    }),
    bracketMatching()
  ]

  if (options.autoCloseBrackets) {
    extensions.push(closeBrackets())
  }

  if (options.enableAutocomplete) {
    extensions.push(autocompletion({
      override: [tikzCompletionSource],
      defaultKeymap: true,
      activateOnTyping: true,
      icons: true
    }))
  }

  return new LanguageSupport(tikzLanguage, extensions)
}
