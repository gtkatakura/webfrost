import type { WebFrostClient } from "@webfrost/sdk";
import { Route, Routes } from "react-router-dom";
import { ClientContext, defaultClient } from "./context";
import { Layout } from "./layouts/Layout";
import { ImportPage } from "./pages/ImportPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { SnapshotDetailPage } from "./pages/SnapshotDetailPage";
import { SnapshotListPage } from "./pages/SnapshotListPage";
import { TagsPage } from "./pages/TagsPage";

export default function App({ client = defaultClient }: { client?: WebFrostClient }) {
  return (
    <ClientContext.Provider value={client}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<SnapshotListPage />} />
          <Route path="snapshots" element={<SnapshotListPage />} />
          <Route path="snapshots/:id" element={<SnapshotDetailPage />} />
          <Route path="tags" element={<TagsPage />} />
          <Route path="schedules" element={<PlaceholderPage title="Schedules" />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="settings" element={<PlaceholderPage title="Settings" />} />
        </Route>
      </Routes>
    </ClientContext.Provider>
  );
}
