import { useEffect, useRef, useState } from "react"
import { supabase } from "../../lib/supabase"

const DOC_TYPES = ["Business Card", "NID", "Passport", "Photo", "Others"]
const MAX_DOCS = 5

const DOC_TYPE_CLS = {
  "Business Card": "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
  "NID": "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400",
  "Passport": "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
  "Photo": "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400",
  "Others": "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
}

function FileIcon() {
  return (
    <svg className="w-8 h-8 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

function fmtDate(d) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

// Documents tab for ClientDetail and SupplierDetail.
// Props: entityType ('client'|'supplier'), entityId (uuid), agentId (uuid)
export default function DocumentsTab({ entityType, entityId, agentId }) {
  const fileInputRef = useRef(null)
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [error, setError] = useState("")
  const [selectedType, setSelectedType] = useState("NID")

  useEffect(() => {
    if (entityId) fetchDocs()
  }, [entityId])

  const fetchDocs = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from("entity_documents")
      .select("*")
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false })
    setLoading(false)
    if (error) setError(error.message)
    else setDocs(data ?? [])
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""

    setUploading(true)
    setError("")
    try {
      const parts = file.name.split(".")
      const ext = parts.length > 1 ? parts.pop() : "bin"
      const storagePath = `${agentId}/${entityType}/${entityId}/${crypto.randomUUID()}.${ext}`

      const { error: uploadErr } = await supabase.storage.from("documents").upload(storagePath, file)
      if (uploadErr) throw uploadErr

      const { error: dbErr } = await supabase.from("entity_documents").insert({
        agent_id: agentId,
        entity_type: entityType,
        entity_id: entityId,
        doc_type: selectedType,
        file_name: file.name,
        storage_path: storagePath,
      })
      if (dbErr) throw dbErr

      await fetchDocs()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  const handleOpen = async (doc) => {
    const { data } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, "_blank")
  }

  const handleDelete = async (doc) => {
    setDeletingId(doc.id)
    await supabase.storage.from("documents").remove([doc.storage_path])
    await supabase.from("entity_documents").delete().eq("id", doc.id)
    setDocs((prev) => prev.filter((d) => d.id !== doc.id))
    setDeletingId(null)
  }

  if (loading) {
    return <div className="py-12 text-center text-sm text-gray-400 dark:text-gray-500">Loading documents…</div>
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">{error}</div>
      )}

      {docs.length === 0 ? (
        <div className="py-10 text-center">
          <FileIcon />
          <p className="mt-3 text-sm text-gray-400 dark:text-gray-500">No documents uploaded yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
          {docs.map((doc) => (
            <div key={doc.id} className="flex flex-col gap-2 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <svg className="w-5 h-5 text-gray-400 dark:text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-sm text-gray-700 dark:text-gray-300 font-medium truncate">{doc.file_name}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${DOC_TYPE_CLS[doc.doc_type] ?? "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"}`}>
                  {doc.doc_type}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">{fmtDate(doc.created_at)}</span>
              </div>
              <div className="flex items-center gap-2 pt-1 border-t border-gray-100 dark:border-gray-800 mt-auto">
                <button
                  onClick={() => handleOpen(doc)}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-400 font-medium transition-colors"
                >
                  Open
                </button>
                <span className="text-gray-200 dark:text-gray-700">|</span>
                <button
                  onClick={() => handleDelete(doc)}
                  disabled={deletingId === doc.id}
                  className="text-xs text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-400 font-medium transition-colors disabled:opacity-50"
                >
                  {deletingId === doc.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {docs.length < MAX_DOCS && (
        <div className="flex items-center gap-2 pt-4 border-t border-gray-100 dark:border-gray-800">
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="text-sm border border-gray-300 dark:border-gray-700 rounded-lg px-2 py-1.5 text-gray-600 dark:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-400 font-medium border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "+ Upload document"}
          </button>
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
          <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">{docs.length} / {MAX_DOCS}</span>
        </div>
      )}

      {docs.length >= MAX_DOCS && (
        <p className="text-xs text-gray-400 dark:text-gray-500 pt-4 border-t border-gray-100 dark:border-gray-800">Maximum of {MAX_DOCS} documents reached.</p>
      )}
    </div>
  )
}
