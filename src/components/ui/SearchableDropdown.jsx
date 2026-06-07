import { useEffect, useRef, useState } from "react"

export default function SearchableDropdown({
  options,
  value,
  onChange,
  placeholder = "Search…",
  allowCustom = false,
}) {
  const [query, setQuery] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const containerRef = useRef(null)
  const listRef = useRef(null)

  // Sync input display when external value changes
  useEffect(() => {
    const match = options.find((o) => o.value === value)
    setQuery(match ? match.label : value || "")
  }, [value, options])

  // Close on outside click and reset display
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false)
        const match = options.find((o) => o.value === value)
        setQuery(match ? match.label : value || "")
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [value, options])

  const filtered = query.trim()
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(query.toLowerCase()) ||
          o.value.toLowerCase().includes(query.toLowerCase())
      )
    : options

  const trimmedQuery = query.trim().toLowerCase()
  const exactMatch = options.some(
    (o) =>
      o.value.toLowerCase() === trimmedQuery ||
      o.label.toLowerCase() === trimmedQuery
  )

  const showAdd = allowCustom && query.trim().length > 0 && !exactMatch

  const totalItems = filtered.length + (showAdd ? 1 : 0)

  const scrollItemIntoView = (idx) => {
    if (listRef.current) {
      listRef.current.children[idx]?.scrollIntoView({ block: "nearest" })
    }
  }

  const handleSelect = (opt) => {
    onChange(opt.value)
    setQuery(opt.label)
    setIsOpen(false)
    setHighlighted(0)
  }

  const handleAdd = () => {
    const val = query.trim()
    onChange(val)
    setQuery(val)
    setIsOpen(false)
    setHighlighted(0)
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
      if (highlighted < filtered.length) {
        handleSelect(filtered[highlighted])
      } else if (showAdd) {
        handleAdd()
      }
    } else if (e.key === "Escape") {
      setIsOpen(false)
      const match = options.find((o) => o.value === value)
      setQuery(match ? match.label : value || "")
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
            {filtered.map((opt, i) => (
              <li
                key={opt.value + i}
                onMouseDown={() => handleSelect(opt)}
                className={`px-3 py-2 text-sm cursor-pointer ${
                  i === highlighted
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                {opt.label}
              </li>
            ))}
            {showAdd && (
              <li
                onMouseDown={handleAdd}
                className={`px-3 py-2 text-sm cursor-pointer border-t border-gray-100 ${
                  highlighted === filtered.length
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-500 hover:bg-gray-50"
                }`}
              >
                Add:{" "}
                <span className="font-medium text-gray-700">{query.trim()}</span>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
