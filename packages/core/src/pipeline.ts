import type Database from "bun:sqlite";

export async function addUrl(db: Database, url: string): Promise<void> {
  const row = db
    .query<{ id: number }, [string]>(
      "INSERT INTO snapshots (url, status) VALUES (?, 'pending') RETURNING id",
    )
    .get(url);

  if (!row) throw new Error("Failed to insert snapshot");
  const snapshotId = row.id;

  db.query<null, [number]>("INSERT INTO job_queue (snapshot_id, status) VALUES (?, 'running')").run(
    snapshotId,
  );

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    db.query<null, [number]>("UPDATE snapshots SET status = 'failed' WHERE id = ?").run(snapshotId);
    db.query<null, [number]>("UPDATE job_queue SET status = 'failed' WHERE snapshot_id = ?").run(
      snapshotId,
    );
    return;
  }

  if (!response.ok) {
    db.query<null, [number]>("UPDATE snapshots SET status = 'failed' WHERE id = ?").run(snapshotId);
    db.query<null, [number]>("UPDATE job_queue SET status = 'failed' WHERE snapshot_id = ?").run(
      snapshotId,
    );
    return;
  }

  const html = await response.text();

  db.query<null, [number, string]>(
    "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'html', ?)",
  ).run(snapshotId, html);

  db.query<null, [number]>("UPDATE snapshots SET status = 'done' WHERE id = ?").run(snapshotId);
  db.query<null, [number]>("UPDATE job_queue SET status = 'done' WHERE snapshot_id = ?").run(
    snapshotId,
  );
}
