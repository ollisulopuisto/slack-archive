import { createSearchDatabase } from "./search.js";
import ora from "ora";

async function main() {
  const spinner = ora("Building search database...").start();
  try {
    await createSearchDatabase(spinner);
    spinner.succeed("Search database successfully built!");
  } catch (err) {
    spinner.fail("Failed to build search database.");
    console.error(err);
    process.exit(1);
  }
}

main();
