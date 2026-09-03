import React, { useState, useEffect, useCallback, useRef } from "react";
import { List } from "react-window";
import { ArchiveMessage, ChunkData } from "./interfaces.js";
import { useRender } from "./render-context.js";
import { ParentMessage } from "./message-components.js";

interface ChannelAppProps {
  channelId: string;
  base: string;
  chunksTotal: number;
}

export const ChannelApp: React.FC<ChannelAppProps> = ({ channelId, base, chunksTotal }) => {
  const { users, userNames, linkContext, profileIds, base: renderBase } = useRender();
  const effectiveBase = base || renderBase;

  const [loadedChunks, setLoadedChunks] = useState<Map<number, ChunkData>>(new Map());
  const [loadingChunk, setLoadingChunk] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadChunk = useCallback(async (index: number) => {
    setLoadedChunks((prev) => {
      if (prev.has(index)) return prev;
      return prev;
    });
    setLoadingChunk((prev) => {
      if (prev === index) return prev;
      return index;
    });

    try {
      const response = await fetch(`${effectiveBase}${channelId}/chunk-${index}.json`);
      if (!response.ok) throw new Error(`Failed to load chunk ${index}`);
      const data: ChunkData = await response.json();
      setLoadedChunks((prev) => new Map(prev).set(index, data));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoadingChunk((prev) => (prev === index ? null : prev));
    }
  }, [channelId, effectiveBase]);

  useEffect(() => {
    loadChunk(0);
  }, [loadChunk]);

  const allMessages: ArchiveMessage[] = [];
  for (let i = 0; i < chunksTotal; i++) {
    const chunk = loadedChunks.get(i);
    if (chunk) allMessages.push(...chunk.messages);
  }

  const heightCache = useRef<Map<number, number>>(new Map());

  const getItemSize = useCallback((index: number) => {
    return heightCache.current.get(index) || 200;
  }, []);

  const ItemRenderer = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (ref.current) {
        const height = ref.current.getBoundingClientRect().height;
        heightCache.current.set(index, height);
      }
    }, [index]);

    return (
      <div ref={ref} style={style}>
        <ParentMessage message={allMessages[index]} channelId={channelId} />
      </div>
    );
  };

  if (allMessages.length === 0 && loadingChunk === 0) {
    return <div className="channel-loading">Loading messages…</div>;
  }

  return (
    <div className="channel-app" style={{ height: "100vh", overflow: "auto" }}>
      <List
        height={typeof window !== "undefined" ? window.innerHeight : 800}
        itemCount={allMessages.length}
        itemSize={getItemSize}
        itemData={allMessages}
        overscanCount={5}
      >
        {ItemRenderer}
      </List>
      {loadingChunk !== null && <div className="chunk-loading">Loading older messages…</div>}
      {error && <div className="chunk-error">{error}</div>}
    </div>
  );
};