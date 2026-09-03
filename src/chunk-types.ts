/**
 * One slice of a channel the reader loads on demand.
 *
 * The markup is rendered once, on the server, with the same components the
 * static pages use - so a chunk carries finished HTML rather than raw
 * messages the browser would have to re-render with a second copy of the
 * emoji, link and avatar logic. The raw timestamps at both ends let the
 * permalink index find a message's chunk without loading it.
 */
export interface ChunkData {
  /** The chunk's messages as rendered HTML, oldest first. */
  html: string;
  /** The oldest message in the chunk, Slack timestamp. */
  oldestTs: string;
  /** The newest message in the chunk, Slack timestamp. */
  newestTs: string;
  /** Zero-based position of the chunk in the channel. */
  index: number;
  /** How many chunks the channel has. */
  total: number;
}

export function serializeChunk(chunk: ChunkData): string {
  return JSON.stringify(chunk);
}

export function deserializeChunk(json: string): ChunkData {
  return JSON.parse(json);
}
