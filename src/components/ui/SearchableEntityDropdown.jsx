import { useEffect, useRef, useState } from "react"

const ID_PREFIXES = { client: "C", supplier: "S" }

// Builds the "[C-028] Ehsan Vai" style label when entityType/idField are given,
// falling back to the plain name otherwise.
function entityLabel(entity, entityType, idField) {
  const prefix = ID_PREFIXES[entityType]
  const num = idField ? entity[idField] : null
  if (!prefix || num == null) return entity.name
  return `[${prefix}-${String(num).padStart(3, "0")}] ${entity.name}`
}

// Searchable dropdown for entities (clients, suppliers) that have {id, name}.
// - entityType: 'client' | 'supplier' — selects the ID prefix for display ([C-028] / [S-031])
// - idField: name of the sequential id column (e.g. 'client_id_number') used for display + search
// - extraOption: optional { label, onSelect } shown pinned at top regardless of search
// - onAddNew: async fn(name) called when user selects the "Add new" item
// - onChange: called with entity.id string
export default function SearchableEntityDropdown({
  entities,
  value,
  onChange,
  placeholder = "Search…",
  onAddNew,
  extraOption,
  entityType,
  idField,
}) {
  const [query, setQuery] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const containerRef = useRef(null)
  const listRef = useRef(null)

  const labelFor = (entity) => entityLabel(entity, entityType, idField)

  // Sync input display when external value or entities list changes
  useEffect(() => {
    const match = entities.find((e) => e.id === value)
    setQuery(match ? labelFor(match) : "")
  }, [value, entities])

  // Close on outside click and reset display
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false)
        const match = entities.find((en) => en.id === value)
        setQuery(match ? labelFor(match) : "")
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [value, entities])

  const filtered = query.trim()
    ? entities.filter((e) => {
        const q = query.trim().toLowerCase()
        if (e.name.toLowerCase().includes(q)) return true
        const prefix = ID_PREFIXES[entityType]
        const num = idField ? e[idField] : null
        if (prefix && num != null) {
          const idLabel = `${prefix}-${String(num).padStart(3, "0")}`.toLowerCase()
          if (idLabel.includes(q) || String(num).includes(q)) return true
        }
        return false
      })
    : entities

  const showAdd =
    !!onAddNew &&
    query.trim().length > 0 &&
    !filtered.some(
      (e) => e.name.toLowerCase() === query.trim().toLowerCase()
    )

  const extraCount = extraOption ? 1 : 0
  const totalItems = extraCount + filtered.length + (showAdd ? 1 : 0)

  const scrollItemIntoView = (idx) => {
    if (listRef.current) {
      listRef.current.children[idx]?.scrollIntoView({ block: "nearest" })
    }
  }

  const handleSelect = (entity) => {
    onChange(entity.id)
    setQuery(labelFor(entity))
    setIsOpen(false)
    setHighlighted(0)
  }

  const handleExtra = () => {
    extraOption.onSelect()
    setIsOpen(false)
    setHighlighted(0)
  }

  const handleAdd = async () => {
    const name = query.trim()
    setIsOpen(false)
    setHighlighted(0)
    if (onAddNew) await onAddNew(name)
  }

  const handleInputChange = (e) => {
    setQuery(e.target.value)
    setIsOpen(true)
    setHighlighted(0)
  }

  const handleKeyDown = (e) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault()
        setIsOpen(true)
      }
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setHighlighted((h) => {
        const next = Math.min(h + 1, totalItems - 1)
        scrollItemIntoView(next)
        return next
      })
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setHighlighted((h) => {
        const prev = Math.max(h - 1, 0)
        scrollItemIntoView(prev)
        return prev
      })
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (extraOption && highlighted === 0) {
        handleExtra()
      } else {
        const filteredIdx = highlighted - extraCount
        if (filteredIdx >= 0 && filteredIdx < filtered.length) {
          handleSelect(filtered[filteredIdx])
        } else if (showAdd) {
          handleAdd()
        }
      }
    } else if (e.key === "Escape") {
      setIsOpen(false)
      const match = entities.find((en) => en.id === value)
      setQuery(match ? labelFor(match) : "")
    }
  }

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={handleInputChange}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={inputCls}
        autoComplete="off"
      />
      {isOpen && totalItems > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
          <ul ref={listRef}>
            {extraOption && (
              <li
                onMouseDown={handleExtra}
                className={`px-3 py-2 text-sm cursor-pointer border-b border-gray-100 ${
                  highlighted === 0
                    ? "bg-blue-50 text-blue-700"
                    : "text-blue-600 hover:bg-blue-50"
                }`}
              >
                {extraOption.label}
              </li>
            )}
            {filtered.map((entity, i) => {
              const idx = extraCount + i
              return (
                <li
                  key={entity.id}
                  onMouseDown={() => handleSelect(entity)}
                  className={`px-3 py-2 text-sm cursor-pointer ${
                    idx === highlighted
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {labelFor(entity)}
                </li>
              )
            })}
            {showAdd && (
              <li
                onMouseDown={handleAdd}
                className={`px-3 py-2 text-sm cursor-pointer border-t border-gray-100 ${
                  highlighted === totalItems - 1
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-500 hover:bg-gray-50"
                }`}
              >
                Add new:{" "}
                <span className="font-medium text-gray-700">{query.trim()}</span>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
