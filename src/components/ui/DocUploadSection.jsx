import { useRef, useState } from "react"

const DOC_TYPES = ["Business Card", "NID", "Passport", "Photo", "Others"]
const MAX_DOCS = 5

function FileIcon() {
  return (
    <svg className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

// Staged document list for use inside modals.
// Props:
//   staged: [{ id, file, docType }]
//   onChange: (newStaged) => void
export default function DocUploadSection({ staged, onChange }) {
  const fileInputRef = useRef(null)
  const [selectedType, setSelectedType] = useState("NID")

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    onChange([...staged, { id: crypto.randomUUID(), file, docType: selectedType }])
    e.target.value = ""
  }

  const remove = (id) => onChange(staged.filter((d) => d.id !== id))

  const updateType = (id, docType) =>
    onChange(staged.map((d) => (d.id === id ? { ...d, docType } : d)))

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Documents</span>
        <span className="text-xs text-gray-400 dark:text-gray-500">{staged.length} / {MAX_DOCS}</span>
      </div>

      {staged.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {staged.map((doc) => (
            <div key={doc.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-800 rounded-lg">
              <FileIcon />
              <span className="text-xs text-gray-700 dark:text-gray-300 flex-1 truncate">{doc.file.name}</span>
              <select
                value={doc.docType}
                onChange={(e) => updateType(doc.id, e.target.value)}
                className="text-xs border border-gray-200 dark:border-gray-800 rounded px-1.5 py-0.5 text-gray-600 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
              <button
                type="button"
                onClick={() => remove(doc.id)}
                className="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors text-base leading-none"
                aria-label="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {staged.length < MAX_DOCS ? (
        <div className="flex items-center gap-2">
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="text-xs border border-gray-300 dark:border-gray-700 rounded-lg px-2 py-1.5 text-gray-600 dark:text-gray-400 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-400 font-medium border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 px-3 py-1.5 rounded-lg transition-colors"
          >
            + Attach file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      ) : (
        <p className="text-xs text-gray-400 dark:text-gray-500">Maximum of {MAX_DOCS} documents reached.</p>
      )}
    </div>
  )
}

export async function uploadStagedDocuments(supabase, agentId, entityType, entityId, staged) {
  for (const doc of staged) {
    const parts = doc.file.name.split(".")
    const ext = parts.length > 1 ? parts.pop() : "bin"
    const storagePath = `${agentId}/${entityType}/${entityId}/${crypto.randomUUID()}.${ext}`

    const { error: uploadErr } = await supabase.storage
      .from("documents")
      .upload(storagePath, doc.file)
    if (uploadErr) throw uploadErr

    const { error: dbErr } = await supabase.from("entity_documents").insert({
      agent_id: agentId,
      entity_type: entityType,
      entity_id: entityId,
      doc_type: doc.docType,
      file_name: doc.file.name,
      storage_path: storagePath,
    })
    if (dbErr) throw dbErr
  }
}
