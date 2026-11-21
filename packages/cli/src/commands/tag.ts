import {
  addTagToSnapshot,
  createTag,
  deleteTag,
  getSnapshot,
  getTag,
  listSnapshotTags,
  listTags,
} from "@webfrost/core";
import { type Command, type Group, parseId } from "../cli";
import { CliError } from "../errors";
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
    await withDb(ctx, (db) => {
      if (!getSnapshot(db, snapshotId)) throw new CliError(`Snapshot ${snapshotId} not found.`);
      const tag = listTags(db).find((t) => t.name === tagName) ?? createTag(db, tagName);
      addTagToSnapshot(db, snapshotId, tag.id);
      ctx.logger.info(`Tag "${tag.name}" added to snapshot ${snapshotId}.`);
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
    await withDb(ctx, (db) => {
      let tags: ReturnType<typeof listTags>;
      let empty = "No tags.";
      if (snapshotArg !== undefined) {
        const snapshotId = parseId(snapshotArg, "snapshot id", ["tag", "list"]);
        if (!getSnapshot(db, snapshotId)) throw new CliError(`Snapshot ${snapshotId} not found.`);
        tags = listSnapshotTags(db, snapshotId);
        empty = "No tags on this snapshot.";
      } else {
        tags = listTags(db);
      }
      if (tags.length === 0) console.log(empty);
      for (const t of tags) console.log(`${t.id}\t${t.slug}\t${t.name}\t${t.color ?? "-"}`);
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
    await withDb(ctx, (db) => {
      try {
        const tag = createTag(db, name, color);
        console.log(`Tag created: ${tag.id}\t${tag.slug}\t${tag.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
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
    await withDb(ctx, (db) => {
      const tag = getTag(db, tagId);
      if (!tag) throw new CliError(`Tag ${tagId} not found.`);
      deleteTag(db, tagId);
      ctx.logger.info(`Tag "${tag.name}" removed.`);
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
