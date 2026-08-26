#!/usr/bin/env node

// Before anything formats a date: node caches the zone the first time it
// needs it, and every page's timestamps depend on which one that was.
const tz = process.argv.indexOf("--timezone");
if (tz !== -1 && process.argv[tz + 1]) {
  const zone = process.argv[tz + 1];

  // An unknown zone is not an error to node - it renders in UTC and says
  // nothing - so a typo here would restate every timestamp in the archive.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    console.error(
      `Unknown timezone ${zone}. Use an IANA name such as Europe/Helsinki.`,
    );
    process.exit(1);
  }

  process.env.TZ = zone;
}

import("../lib/cli.js");
