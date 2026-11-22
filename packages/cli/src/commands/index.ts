import type { CommandNode } from "../cli";
import { adminGroup } from "./admin";
import {
  addCommand,
  deleteCommand,
  initCommand,
  listCommand,
  searchCommand,
  searchRebuildCommand,
} from "./archive";
import { doctorCommand } from "./doctor";
import { importCommand } from "./import";
import { exportCommand, pushCommand } from "./push";
import { scheduleGroup } from "./schedule";
import { serveCommand } from "./serve";
import { setupCommand } from "./setup";
import { tagGroup } from "./tag";

/** Every command, in the order `webfrost --help` lists them. */
export const commands: CommandNode[] = [
  serveCommand,
  setupCommand,
  doctorCommand,
  addCommand,
  listCommand,
  searchCommand,
  importCommand,
  exportCommand,
  pushCommand,
  deleteCommand,
  scheduleGroup,
  tagGroup,
  adminGroup,
  initCommand,
  searchRebuildCommand,
];
