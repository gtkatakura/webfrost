import {
  InvalidTagNameError,
  addTagToSnapshot,
  createTag,
  deleteTag,
  getOrCreateTag,
  getSnapshot,
  getTag,
  listSnapshotTags,
  listTags,
} from "@webfrost/core";
import { type Command, type Group, parseId } from "../cli";
import { CliError } from "../errors";
import { safeText } from "../sanitize";
import { withDb } from "./shared";

const tagAdd: Command = {
  kind: "command",
  name: "add",
  summary: "Tag a snapshot (the tag is created if it does not exist)",
  args: [
    { name: "snapshot-id", description: "Snapshot id" },
    { name: "name", description: "Tag name" },
  ],
  examples: ["webfrost tag add 12 reading-list"],
  async run(ctx) {
    const snapshotId = parseId(ctx.args[0] ?? "", "snapshot id", ["tag", "add"]);
    const tagName = ctx.args[1] ?? "";
    await withDb(ctx, async (db) => {
      if (!(await getSnapshot(db, snapshotId)))
        throw new CliError(`Snapshot ${snapshotId} not found.`);
      let tag: Awaited<ReturnType<typeof getOrCreateTag>>;
      try {
        tag = await getOrCreateTag(db, tagName);
      } catch (err) {
        if (err instanceof InvalidTagNameError)
          throw new CliError(`Invalid tag name: ${err.message}.`);
        throw err;
      }
      await addTagToSnapshot(db, snapshotId, tag.id);
      ctx.logger.info(`Tag "${safeText(tag.name)}" added to snapshot ${snapshotId}.`);
    });
    return 0;
  },
};

const tagList: Command = {
  kind: "command",
  name: "list",
  summary: "List all tags, or the tags of one snapshot",
  args: [{ name: "snapshot-id", description: "Only the tags of this snapshot", required: false }],
  examples: ["webfrost tag list", "webfrost tag list 12"],
  async run(ctx) {
    const snapshotArg = ctx.args[0];
    await withDb(ctx, async (db) => {
      let tags: Awaited<ReturnType<typeof listTags>>;
      let empty = "No tags.";
      if (snapshotArg !== undefined) {
        const snapshotId = parseId(snapshotArg, "snapshot id", ["tag", "list"]);
        if (!(await getSnapshot(db, snapshotId)))
          throw new CliError(`Snapshot ${snapshotId} not found.`);
        tags = await listSnapshotTags(db, snapshotId);
        empty = "No tags on this snapshot.";
      } else {
        tags = await listTags(db);
      }
      if (tags.length === 0) console.log(empty);
      for (const t of tags)
        console.log(
          `${t.id}\t${safeText(t.slug)}\t${safeText(t.name)}\t${safeText(t.color ?? "-")}`,
        );
    });
    return 0;
  },
};

const tagCreate: Command = {
  kind: "command",
  name: "create",
  summary: "Create a tag",
  args: [{ name: "name", description: "Tag name" }],
  options: { color: { type: "string", value: "hex", description: "Colour, for example #ff0000" } },
  examples: ['webfrost tag create News --color "#ff0000"'],
  async run(ctx) {
    const name = ctx.args[0] ?? "";
    const color = ctx.string("color");
    await withDb(ctx, async (db) => {
      try {
        const tag = await createTag(db, name, color);
        console.log(`Tag created: ${tag.id}\t${safeText(tag.slug)}\t${safeText(tag.name)}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (err instanceof InvalidTagNameError)
          throw new CliError(`Invalid tag name: ${err.message}.`);
        if (/unique/i.test(msg)) throw new CliError(`Tag "${name}" already exists.`);
        throw err;
      }
    });
    return 0;
  },
};

const tagRemove: Command = {
  kind: "command",
  name: "remove",
  summary: "Delete a tag and remove it from every snapshot",
  args: [{ name: "tag-id", description: "Tag id (see `webfrost tag list`)" }],
  examples: ["webfrost tag remove 3"],
  async run(ctx) {
    const tagId = parseId(ctx.args[0] ?? "", "tag id", ["tag", "remove"]);
    await withDb(ctx, async (db) => {
      const tag = await getTag(db, tagId);
      if (!tag) throw new CliError(`Tag ${tagId} not found.`);
      await deleteTag(db, tagId);
      ctx.logger.info(`Tag "${safeText(tag.name)}" removed.`);
    });
    return 0;
  },
};

export const tagGroup: Group = {
  kind: "group",
  name: "tag",
  summary: "Manage tags (add, list, create, remove)",
  children: [tagAdd, tagList, tagCreate, tagRemove],
};
