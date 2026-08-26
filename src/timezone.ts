/**
 * Which clock the archive's timestamps are shown on.
 *
 * Every message on every page is formatted in the renderer's local timezone.
 * A container has no timezone, so it is UTC - which means the same archive
 * rendered on a laptop in Helsinki and on the NAS in a container produces
 * pages three hours apart, for the same messages, with nothing on the page
 * saying which clock it used. One publish silently restated ten years of
 * timestamps.
 *
 * So the zone is stated rather than inherited, like the file modes and the
 * exclusions before it. Unset, it stays whatever the machine is - which is
 * right for somebody rendering their own archive locally, and wrong for
 * anything published from more than one place.
 */
export function useTimezone(zone: string | undefined) {
  if (!zone) return;

  // A zone node does not recognise is not an error to it: TZ=Europe/Hensinki
  // formats every date in UTC and says nothing. A typo would publish the whole
  // archive on the wrong clock and report success, so it is checked here,
  // where the only cost of being wrong is an exit.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    throw new Error(
      `Unknown timezone ${zone}. Use an IANA name such as Europe/Helsinki; ` +
        `node would otherwise render every timestamp in UTC without saying so.`,
    );
  }

  // Node reads TZ when it first needs it and caches; setting it before any
  // date is formatted is what makes this work.
  process.env.TZ = zone;
}
