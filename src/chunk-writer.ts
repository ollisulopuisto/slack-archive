import fs from "fs-extra";
import path from "path";
import { serializeChunk, ChunkData } from "./chunk-types.js";

/**
 * Sanitize channelId and ensure target chunk directory remains contained within baseDir
 * to prevent directory traversal / arbitrary file write vulnerabilities.
 */
export async function ensureChunkDir(
  channelId: string,
  baseDir: string,
): Promise<string> {
  const normalized = (channelId || "").trim().replace(/\\/g, "/");
  const safeChannel =
    path.posix.basename(normalized).replace(/^\.+/, "") || "unknown";
  const targetDir = path.join(baseDir, safeChannel);
  const resolvedBase = path.resolve(baseDir) + path.sep;
  const dir = path.resolve(targetDir).startsWith(resolvedBase)
    ? targetDir
    : path.join(baseDir, "unknown");

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
  const safeIndex =
    Number.isSafeInteger(chunkIndex) && chunkIndex >= 0 ? chunkIndex : 0;
  const filePath = path.join(dir, `chunk-${safeIndex}.json`);
  await fs.writeFile(filePath, serializeChunk(chunk));
}
