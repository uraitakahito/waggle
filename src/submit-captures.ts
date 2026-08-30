#!/usr/bin/env node
import { runClient } from "./client/run.js";
import { parseClientOptions } from "./config/cli-options.js";
import { fatal } from "./logger.js";

const main = async (): Promise<void> => {
  const options = parseClientOptions(process.argv);
  await runClient(options);
};

main().catch(fatal);
