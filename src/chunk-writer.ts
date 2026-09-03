import fs from "fs-extra";
import path from "path";
import { serializeChunk, ChunkData } from "./chunk-types.js";

export async function ensureChunkDir(
  channelId: string,
  baseDir: string,
): Promise<string> {
  const dir = path.join(baseDir, channelId);
  await fs.ensureDir(dir);
  return dir;
}

export async function writeChunk(
  baseDir: string,
  channelId: string,
  chunkIndex: number,
  chunk: ChunkData,
): Promise<void> {
  const dir = await ensureChunkDir(channelId, baseDir);
  const filePath = path.join(dir, `chunk-${chunkIndex}.json`);
  await fs.writeFile(filePath, serializeChunk(chunk));
}