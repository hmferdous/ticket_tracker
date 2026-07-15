// type="number" alone doesn't stop a user from typing letters — most
// browsers happily accept keystrokes like "e" (scientific notation) into
// the field and only reject the value's validity on blur/submit, which
// reads as a broken/janky input. Block non-numeric keys at keydown instead
// so the field only ever shows digits, a decimal point, and a leading
// minus (fare_difference-style fields can legitimately go negative).
export function blockNonNumericKeys(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return // copy/paste/select-all etc.

  const allowedKeys = [
    "Backspace", "Delete", "Tab", "Escape", "Enter",
    "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End",
    ".", "-",
  ]
  if (allowedKeys.includes(e.key)) return

  if (!/^[0-9]$/.test(e.key)) {
    e.preventDefault()
  }
}
