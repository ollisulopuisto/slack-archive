import { ArchiveMessage } from "./interfaces.js";

export interface ChunkData {
  messages: ArchiveMessage[];
  oldestTs: string;
  newestTs: string;
  index: number;
  total: number;
}

export function serializeChunk(chunk: ChunkData): string {
  return JSON.stringify(chunk);
}

export function deserializeChunk(json: string): ChunkData {
  return JSON.parse(json);
}