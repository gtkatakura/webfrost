import { WebFrostError } from "@webfrost/sdk";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorBanner, TagChip } from "../components";
import { useClient } from "../context";
import { useTags } from "../hooks";

const inputCls = "py-2 px-3 border border-gray-300 rounded text-sm";

export function TagsPage() {
  const client = useClient();
  const navigate = useNavigate();
  const { tags, setTags, loading, error: tagsError, setError } = useTags();

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6b7280");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const error = tagsError ?? formError;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setFormError(null);
    setError(null);
    try {
      await client.createTag(newName.trim(), newColor);
      setNewName("");
      const data = await client.listTags();
      setTags(data);
    } catch (e) {
      setFormError(e instanceof WebFrostError ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(tagId: number) {
    setFormError(null);
    setError(null);
    try {
      await client.deleteTag(tagId);
      setTags((prev) => prev.filter((t) => t.id !== tagId));
    } catch (e) {
      setFormError(e instanceof WebFrostError ? e.message : String(e));
    }
  }

  return (
    <main className="max-w-[760px] mx-auto py-8 px-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="bg-transparent border-0 text-primary cursor-pointer text-sm p-0 mb-6 inline-flex items-center gap-1"
      >
        ← Back
      </button>

      <h1 className="text-2xl font-bold mb-6 text-gray-900">Tags</h1>

      <form onSubmit={handleCreate} className="flex gap-2 mb-6 items-center">
        <input
          type="text"
          placeholder="New tag name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          required
          className={`flex-1 ${inputCls}`}
        />
        <label className="flex items-center gap-1.5 text-sm">
          Color
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="w-9 h-8 p-0.5 border border-gray-300 rounded cursor-pointer"
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

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <p className="text-gray-400">Loading…</p>
      ) : tags.length === 0 ? (
        <p className="text-gray-400">No tags yet. Create one above.</p>
      ) : (
        <ul className="list-none p-0 flex flex-col gap-2">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="flex justify-between items-center py-2.5 px-4 border border-gray-200 rounded-md bg-white"
            >
              <TagChip tag={tag} />
              <button
                type="button"
                onClick={() => handleDelete(tag.id)}
                className="bg-transparent border border-red-300 text-red-700 rounded cursor-pointer py-1 px-2.5 text-xs"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
