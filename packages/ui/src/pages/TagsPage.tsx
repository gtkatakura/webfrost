import { ArrowLeft, Tag } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { TagChip } from "../components";
import { useAuth } from "../context/auth";
import { useTags } from "../hooks";

const inputCls =
  "py-2 px-3 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500";

export function TagsPage() {
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const { tags, loading, createTag, deleteTag } = useTags();

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6b7280");
  const [creating, setCreating] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite || !newName.trim()) return;
    setCreating(true);
    try {
      await createTag({ name: newName.trim(), color: newColor });
      toast.success(`Tag "${newName.trim()}" created`);
      setNewName("");
    } catch {
      // error handled in hook
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(tagId: number, tagName: string) {
    if (!canWrite) return;
    try {
      await deleteTag(tagId);
      toast.success(`Tag "${tagName}" deleted`);
    } catch {
      // error handled in hook
    }
  }

  return (
    <main className="max-w-[760px] mx-auto py-8 px-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="bg-transparent border-0 text-primary cursor-pointer text-sm p-0 mb-6 inline-flex items-center gap-1.5 hover:opacity-80 transition-opacity"
      >
        <ArrowLeft size={14} /> Back
      </button>

      <h1 className="text-2xl font-bold mb-6 text-gray-900 dark:text-gray-100">Tags</h1>

      {canWrite && (
        <form onSubmit={handleCreate} className="flex gap-2 mb-6 items-center">
          <input
            type="text"
            placeholder="New tag name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            className={`flex-1 ${inputCls}`}
          />
          <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
            Color
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="w-9 h-8 p-0.5 border border-gray-300 dark:border-gray-600 rounded cursor-pointer bg-transparent"
            />
          </label>
          <button
            type="submit"
            disabled={creating}
            className={`py-2 px-5 bg-primary text-white border-0 rounded font-semibold ${
              creating ? "cursor-not-allowed opacity-70" : "cursor-pointer"
            }`}
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-gray-400 dark:text-gray-500">Loading…</p>
      ) : tags.length === 0 ? (
        <div className="text-center mt-16 flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <Tag size={28} className="text-gray-400 dark:text-gray-500" />
          </div>
          <div>
            <p className="text-gray-700 dark:text-gray-300 font-semibold">No tags yet</p>
            <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">
              {canWrite
                ? "Create a tag above to organize your snapshots."
                : "No tags have been created."}
            </p>
          </div>
        </div>
      ) : (
        <ul className="list-none p-0 flex flex-col gap-2">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="flex justify-between items-center py-2.5 px-4 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800"
            >
              <TagChip tag={tag} />
              {canWrite && (
                <button
                  type="button"
                  onClick={() => handleDelete(tag.id, tag.name)}
                  className="bg-transparent border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 rounded cursor-pointer py-1 px-2.5 text-xs hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
