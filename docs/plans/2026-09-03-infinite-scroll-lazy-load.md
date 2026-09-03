# Infinite Scroll + Lazy Load Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert static per-page HTML to single-page channel view with infinite scroll, lazy-loaded JSON chunks, and persistent permalinks — while keeping static fallback (file://, SEO, archival) working.

**Architecture:** Generate JSON chunks (`channelId/chunk-0.json`, `chunk-1.json`…) instead of HTML pages. One `channelId.html` entry point loads first chunk, then lazy-loads via IntersectionObserver. Permalinks resolve timestamp → chunk index via `pages.js`, load that chunk, scroll to message. History API updates URL on scroll. Static pages still generated for fallback.

**Tech Stack:** React 18 (already), `react-window` for virtualized list, TypeScript, existing `pages.js` index repurposed for permalink resolution, `IntersectionObserver` for lazy load, History API for URL sync.

---

## Phase 1: Data Layer — JSON Chunks Instead of HTML Pages

### Task 1: Add chunk output paths to config

**Files:**
- Modify: `src/config.ts:338-340`

**Step 1: Write failing test**
```typescript
// src/config.test.ts
import { getChunkFilePath, getChunkDirPath } from "./config.js";

test("getChunkFilePath returns correct path", () => {
  expect(getChunkFilePath("C123", 0)).toBe("/path/to/slack-archive/html/C123/chunk-0.json");
  expect(getChunkFilePath("C123", 5)).toBe("/path/to/slack-archive/html/C123/chunk-5.json");
});

test("getChunkDirPath returns directory", () => {
  expect(getChunkDirPath("C123")).toBe("/path/to/slack-archive/html/C123");
});
```

**Step 2: Run test** — Expected: FAIL (functions don't exist)

**Step 3: Add to config.ts**
```typescript
// After getHTMLFilePath (line 338-340)
export function getChunkDirPath(channelId: string) {
  return path.join(HTML_DIR, channelId);
}

export function getChunkFilePath(channelId: string, chunkIndex: number) {
  return path.join(getChunkDirPath(channelId), `chunk-${chunkIndex}.json`);
}
```

**Step 4: Run test** — Expected: PASS

**Step 5: Commit**

---

### Task 2: Create chunk data type and serializer

**Files:**
- Create: `src/chunk-types.ts`
- Modify: `src/interfaces.ts` (add export)

**Step 1: Write failing test**
```typescript
// src/chunk-types.test.ts
import { ChunkData, serializeChunk, deserializeChunk } from "./chunk-types.js";
import { ArchiveMessage } from "./interfaces.js";

test("serializeChunk produces valid JSON", () => {
  const messages: ArchiveMessage[] = [{ ts: "123.456", text: "hi", user: "U1" }];
  const chunk: ChunkData = { messages, oldestTs: "123.456", newestTs: "123.456", index: 0, total: 1 };
  const json = serializeChunk(chunk);
  const parsed = JSON.parse(json);
  expect(parsed.messages).toHaveLength(1);
  expect(parsed.index).toBe(0);
});

test("deserializeChunk round-trips", () => {
  const original: ChunkData = { messages: [{ ts: "123.456", text: "hi", user: "U1" }], oldestTs: "123.456", newestTs: "123.456", index: 0, total: 1 };
  const json = serializeChunk(original);
  const restored = deserializeChunk(json);
  expect(restored.messages[0].ts).toBe("123.456");
});
```

**Step 2: Run test** — Expected: FAIL

**Step 3: Create chunk-types.ts**
```typescript
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
```

**Step 4: Run test** — Expected: PASS

**Step 5: Commit**

---

### Task 3: Modify render-plan to output chunk plans (not HTML page plans)

**Files:**
- Modify: `src/render-plan.ts`

**Step 1: Write failing test**
```typescript
// src/render-plan.test.ts
import { planChannel, ChannelPlan, PagePlan } from "./render-plan.js";

test("planChannel returns ChunkPlan with correct structure", () => {
  const messages = Array.from({ length: 2500 }, (_, i) => ({ ts: `${1000 + i}.000` }));
  const spans = messages.map((_, i) => ({ start: i * 100, end: (i + 1) * 100 }));
  
  const plan = planChannel("C123", messages, spans, { 
    chunkSize: 1000, 
    formatTimestamp: (m) => m.ts || "" 
  });
  
  expect(plan.chunksInfo).toHaveLength(3); // 2500 / 1000 = 3 chunks
  expect(plan.chunks[0].index).toBe(0);
  expect(plan.chunks[0].messages.length).toBe(1000); // Not tested here, but span is correct
});
```

**Step 2: Run test** — Expected: FAIL (type mismatch)

**Step 3: Modify render-plan.ts**
```typescript
// Replace PagePlan with ChunkPlan
export interface ChunkPlan {
  index: number;
  span: ElementSpan;
  oldestTs?: string;
}

export interface ChannelPlan {
  channelId: string;
  chunksInfo: ChunksInfo;
  chunks: Array<ChunkPlan>; // was: pages
  months: Array<MonthPage>;
}

// In planChannel function:
const chunks: Array<ChunkPlan> = []; // was: pages

for (let start = 0; start < messages.length; start += chunkSize) {
  const last = Math.min(start + chunkSize, messages.length) - 1;
  chunksInfo.push({ /* same */ });
  chunks.push({ // was: pages.push
    index: chunks.length,
    span: { start: spans[start].start, end: spans[last].end },
    oldestTs: messages[last]?.ts,
  });
}

return { channelId, chunksInfo, chunks, months: monthsToPages(...) };
```

**Step 4: Update shareOutPages to work with chunks**
```typescript
// In shareOutPages, replace plan.pages with plan.chunks
const heaviestFirst = plans
  .flatMap((plan) => plan.chunks.map((chunk) => ({ plan, chunk })))
  .sort((a, b) => weigh(b.chunk) - weigh(a.chunk));

for (const { plan, chunk } of heaviestFirst) {
  const lightest = load.indexOf(Math.min(...load));
  const bucket = buckets[lightest];
  const existing = bucket.get(plan.channelId);

  if (existing) {
    existing.chunks.push(chunk);
  } else {
    bucket.set(plan.channelId, {
      channelId: plan.channelId,
      chunksInfo: plan.chunksInfo,
      months: plan.months,
      chunks: [chunk],
    });
  }
  load[lightest] += weigh(chunk);
}
```

**Step 5: Run test** — Expected: PASS

**Step 6: Commit**

---

### Task 4: Create chunk writer (replaces HTML page writer)

**Files:**
- Create: `src/chunk-writer.ts`
- Modify: `src/create-html.tsx` (import)

**Step 1: Write failing test**
```typescript
// src/chunk-writer.test.ts
import { writeChunk, ensureChunkDir } from "./chunk-writer.js";
import fs from "fs-extra";
import path from "path";

test("writeChunk creates JSON file with correct structure", async () => {
  const testDir = "/tmp/test-chunks";
  await fs.ensureDir(testDir);
  
  const chunk = {
    messages: [{ ts: "123.456", text: "hello", user: "U1" }],
    oldestTs: "123.456",
    newestTs: "123.456",
    index: 0,
    total: 1,
  };
  
  await writeChunk(testDir, "C123", 0, chunk);
  
  const content = await fs.readFile(path.join(testDir, "C123", "chunk-0.json"), "utf-8");
  const parsed = JSON.parse(content);
  expect(parsed.messages).toHaveLength(1);
  expect(parsed.index).toBe(0);
});
```

**Step 2: Run test** — Expected: FAIL

**Step 3: Create chunk-writer.ts**
```typescript
import fs from "fs-extra";
import path from "path";
import { serializeChunk, ChunkData } from "./chunk-types.js";

export async function ensureChunkDir(channelId: string, baseDir: string): Promise<string> {
  const dir = path.join(baseDir, channelId);
  await fs.ensureDir(dir);
  return dir;
}

export async function writeChunk(
  baseDir: string,
  channelId: string,
  chunkIndex: number,
  chunk: ChunkData
): Promise<void> {
  const dir = await ensureChunkDir(channelId, baseDir);
  const filePath = path.join(dir, `chunk-${chunkIndex}.json`);
  await fs.writeFile(filePath, serializeChunk(chunk));
}
```

**Step 4: Run test** — Expected: PASS

**Step 5: Commit**

---

### Task 5: Update render-workers to write chunks instead of HTML

**Files:**
- Modify: `src/render-workers.ts`
- Modify: `src/create-html.tsx` (renderPages function)

**Step 1: Write failing test**
```typescript
// src/render-workers.test.ts (add test)
import { renderPagesInWorkers } from "./render-workers.js";

test("renderPagesInWorkers writes chunks not HTML", async () => {
  // This is an integration test - may need to mock heavily
  // For now, verify the function signature accepts chunk writer
});
```

**Step 2: Modify render-workers.ts**
```typescript
// Change renderPagesInWorkers to accept a chunk writer function
export async function renderPagesInWorkers(
  plans: Array<Array<ChannelPlan>>,
  writeChunkFn: (channelId: string, chunkIndex: number, chunk: ChunkData) => Promise<void>,
  // ... other params
) {
  // Worker logic: instead of rendering HTML, build ChunkData and call writeChunkFn
}
```

**Step 3: In create-html.tsx, update renderPages to use chunk writer**
```typescript
// In renderPages function (around line 563):
for (const page of plan.pages) { // becomes: for (const chunk of plan.chunks)
  const messages = await getMessageSlice(plan.channelId, chunk.span);
  
  const chunkData: ChunkData = {
    messages,
    oldestTs: chunk.oldestTs || messages[messages.length - 1]?.ts || "",
    newestTs: messages[0]?.ts || "",
    index: chunk.index,
    total: plan.chunks.length,
  };
  
  await writeChunk(HTML_DIR, plan.channelId, chunk.index, chunkData);
}
```

**Step 4: Run tests** — Expected: PASS

**Step 5: Commit**

---

## Phase 2: Client-Side Channel App

### Task 6: Add react-window dependency

**Files:**
- Modify: `package.json`

**Step 1: Run** `npm install react-window @types/react-window`

**Step 2: Commit**

---

### Task 7: Create ChannelApp entry component

**Files:**
- Create: `src/ChannelApp.tsx`
- Modify: `src/create-html.tsx` (add new render function)

**Step 1: Write failing test**
```typescript
// src/ChannelApp.test.tsx
import { render, screen } from "@testing-library/react";
import { ChannelApp } from "./ChannelApp.js";

test("ChannelApp renders loading state initially", () => {
  render(<ChannelApp channelId="C123" base="" chunksTotal={3} />);
  expect(screen.getByText(/loading/i)).toBeInTheDocument();
});
```

**Step 2: Create ChannelApp.tsx**
```tsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import { FixedSizeList as List } from "react-window";
import { ArchiveMessage } from "./interfaces.js";
import { useRender } from "./render-context.js";
import { ParentMessage } from "./create-html.js"; // Reuse existing message renderer

interface ChannelAppProps {
  channelId: string;
  base: string;
  chunksTotal: number;
}

interface ChunkData {
  messages: ArchiveMessage[];
  oldestTs: string;
  newestTs: string;
  index: number;
  total: number;
}

export const ChannelApp: React.FC<ChannelAppProps> = ({ channelId, base, chunksTotal }) => {
  const { users, userNames, linkContext, profileIds, base: renderBase } = useRender();
  const effectiveBase = base || renderBase;
  
  const [loadedChunks, setLoadedChunks] = useState<Map<number, ChunkData>>(new Map());
  const [loadingChunk, setLoadingChunk] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Load initial chunk (index 0 = newest messages)
  useEffect(() => {
    loadChunk(0);
  }, []);
  
  const loadChunk = useCallback(async (index: number) => {
    if (loadedChunks.has(index) || loadingChunk === index) return;
    
    setLoadingChunk(index);
    try {
      const response = await fetch(`${effectiveBase}${channelId}/chunk-${index}.json`);
      if (!response.ok) throw new Error(`Failed to load chunk ${index}`);
      const data: ChunkData = await response.json();
      setLoadedChunks(prev => new Map(prev).set(index, data));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoadingChunk(null);
    }
  }, [channelId, effectiveBase, loadedChunks, loadingChunk]);
  
  // Flatten messages from loaded chunks (newest first)
  const allMessages: ArchiveMessage[] = [];
  for (let i = 0; i < chunksTotal; i++) {
    const chunk = loadedChunks.get(i);
    if (chunk) allMessages.push(...chunk.messages);
  }
  
  const ItemRenderer = ({ index, style }: { index: number; style: React.CSSProperties }) => (
    <div style={style}>
      <ParentMessage
        message={allMessages[index]}
        channelId={channelId}
      />
    </div>
  );
  
  if (allMessages.length === 0 && loadingChunk === 0) {
    return <div className="channel-loading">Loading messages…</div>;
  }
  
  return (
    <div className="channel-app" style={{ height: "100vh", overflow: "auto" }}>
      <List
        height={window.innerHeight}
        itemCount={allMessages.length}
        itemSize={200} // Estimated, will need DynamicSizeList later
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
```

**Step 3: Run test** — Expected: PASS (basic render)

**Step 4: Commit**

---

### Task 8: Create channel entry HTML page (replaces channelId-0.html)

**Files:**
- Modify: `src/create-html.tsx` (add renderChannelEntry function)
- Modify: `src/config.ts` (add CHANNEL_ENTRY_PATH)

**Step 1: Write failing test**
```typescript
// src/create-html.test.tsx (add test)
test("renderChannelEntry generates single HTML with ChannelApp", async () => {
  // Test that a single HTML file is generated per channel
});
```

**Step 2: Add to create-html.tsx**
```tsx
// New function to render the channel entry point
async function renderChannelEntry(channel: Channel, plan: ChannelPlan, months: Array<MonthPage>) {
  const meta = channelPageMeta({
    name: channel.name || channel.id || "",
    first: plan.chunks[plan.chunks.length - 1]?.oldestTs, // Oldest message
    last: plan.chunks[0]?.oldestTs, // Newest message
    index: 0,
    total: 1, // Single entry page
    messages: plan.chunks.reduce((sum, c) => sum + c.messages?.length || 0, 0), // Need to count
    team: slackArchiveData.auth?.team,
  });
  
  const html = ReactDOMServer.renderToStaticMarkup(
    <HtmlPage meta={meta}>
      <div className="page">
        <Header
          index={0}
          chunksInfo={plan.chunksInfo}
          channel={channel}
          months={months}
        />
        <div className="messages-list">
          <ChannelApp
            channelId={channel.id!}
            base={render.base}
            chunksTotal={plan.chunks.length}
          />
        </div>
        <script src={`${render.base}channel-app.js`} />
      </div>
    </HtmlPage>
  );
  
  await write(getChannelEntryPath(channel.id!), html);
}

// Add getChannelEntryPath to config.ts
export function getChannelEntryPath(channelId: string) {
  return path.join(HTML_DIR, `${channelId}.html`);
}
```

**Step 3: Update renderPages to call renderChannelEntry once per channel**
```typescript
// In renderPages function, replace the page loop:
for (const plan of plans) {
  const channel = byId.get(plan.channelId);
  if (!channel) continue;
  
  // Write all chunks first
  for (const chunk of plan.chunks) {
    const messages = await getMessageSlice(plan.channelId, chunk.span);
    const chunkData: ChunkData = { /* build */ };
    await writeChunk(HTML_DIR, plan.channelId, chunk.index, chunkData);
  }
  
  // Then write single entry page
  await renderChannelEntry(channel, plan, plan.months);
}
```

**Step 4: Run test** — Expected: PASS

**Step 5: Commit**

---

### Task 9: Implement virtualized list with dynamic heights

**Files:**
- Modify: `src/ChannelApp.tsx`

**Step 1: Write failing test**
```typescript
// src/ChannelApp.test.tsx
test("ChannelApp uses VariableSizeList for variable height messages", () => {
  render(<ChannelApp channelId="C123" base="" chunksTotal={1} />);
  // Check VariableSizeList is used
});
```

**Step 2: Update ChannelApp to use VariableSizeList**
```tsx
import { VariableSizeList as List } from "react-window";

// Add message height cache
const heightCache = useRef<Map<number, number>>(new Map());

const getItemSize = useCallback((index: number) => {
  return heightCache.current.get(index) || 200; // Default estimate
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

return (
  <List
    height={window.innerHeight}
    itemCount={allMessages.length}
    itemSize={getItemSize}
    itemData={allMessages}
    overscanCount={5}
  >
    {ItemRenderer}
  </List>
);
```

**Step 3: Run test** — Expected: PASS

**Step 4: Commit**

---

### Task 10: Implement infinite scroll (load older chunks on scroll down)

**Files:**
- Modify: `src/ChannelApp.tsx`

**Step 1: Write failing test**
```typescript
// src/ChannelApp.test.tsx
test("ChannelApp loads next chunk when scrolled near bottom", async () => {
  // Mock fetch, render, scroll to bottom, verify next chunk loaded
});
```

**Step 2: Add scroll detection to ChannelApp**
```tsx
const listRef = useRef<List>(null);
const observerRef = useRef<IntersectionObserver | null>(null);
const sentinelRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (!sentinelRef.current) return;
  
  observerRef.current = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        // Load next older chunk
        const loadedIndices = Array.from(loadedChunks.keys()).sort((a, b) => a - b);
        const nextIndex = loadedIndices[loadedIndices.length - 1] + 1;
        if (nextIndex < chunksTotal) {
          loadChunk(nextIndex);
        }
      }
    },
    { rootMargin: "200px" }
  );
  
  observerRef.current.observe(sentinelRef.current);
  
  return () => observerRef.current?.disconnect();
}, [loadedChunks, chunksTotal, loadChunk]);

// Add sentinel at bottom of list
return (
  <div className="channel-app" style={{ height: "100vh", overflow: "auto" }}>
    <List
      ref={listRef}
      height={window.innerHeight}
      itemCount={allMessages.length}
      itemSize={getItemSize}
      overscanCount={5}
    >
      {ItemRenderer}
    </List>
    <div ref={sentinelRef} style={{ height: "1px" }} />
    {loadingChunk !== null && <div className="chunk-loading">Loading older messages…</div>}
  </div>
);
```

**Step 3: Run test** — Expected: PASS

**Step 4: Commit**

---

## Phase 3: Permalink Resolution & URL Sync

### Task 11: Update pages.js to map timestamp → chunk index

**Files:**
- Modify: `src/create-html.tsx` (writePageIndex function)
- Modify: `src/search.js` (getPageIndex if needed)

**Step 1: Write failing test**
```typescript
// src/search.test.ts
test("pages.js maps timestamp to chunk index", () => {
  const index = getPageIndex();
  // Should have chunk indices instead of page indices
});
```

**Step 2: Update writePageIndex to output chunk mapping**
```typescript
async function writePageIndex() {
  const index = getPageIndex(); // This comes from search.ts - may need update
  const published: Record<string, Array<string>> = {};
  
  for (const channelId of Object.keys(index)) {
    if (render.publishedChannels.has(channelId)) {
      // Convert page timestamps to chunk mapping
      // pages.js will now be: { channelId: { timestamps: [...], chunkIndices: [...] } }
      published[channelId] = index[channelId]; // Keep for backward compat, but note it's now chunks
    }
  }
  
  await write(
    PAGES_INDEX_PATH,
    `window.ARCHIVE_CHUNKS = ${JSON.stringify(published)};\n`,
  );
}
```

**Step 3: Update scroll.js (self-heal) to use new chunk index**
```javascript
// In static/scroll.js - update to resolve via chunks
// Check window.ARCHIVE_CHUNKS instead of ARCHIVE_PAGES
```

**Step 4: Run test** — Expected: PASS

**Step 5: Commit**

---

### Task 12: Implement permalink resolution in ChannelApp

**Files:**
- Modify: `src/ChannelApp.tsx`

**Step 1: Write failing test**
```typescript
// src/ChannelApp.test.tsx
test("ChannelApp scrolls to message on permalink load", async () => {
  // Mock chunk with target message, load with hash, verify scroll
});
```

**Step 2: Add permalink handling to ChannelApp**
```tsx
useEffect(() => {
  const hash = window.location.hash.slice(1); // Remove #
  if (!hash) return;
  
  // Check if message already loaded
  const targetMsg = allMessages.find(m => m.ts === hash);
  if (targetMsg) {
    scrollToMessage(targetMsg);
    return;
  }
  
  // Need to find which chunk has this message
  resolvePermalink(hash);
}, []);

const resolvePermalink = async (timestamp: string) => {
  // Use ARCHIVE_CHUNKS to find chunk index
  const chunks = window.ARCHIVE_CHUNKS?.[channelId];
  if (!chunks) return;
  
  // chunks is array of { oldestTs, newestTs } or similar
  // Find chunk where timestamp falls in range
  const chunkIndex = chunks.findIndex((c: any) => 
    timestamp <= c.newestTs && timestamp >= c.oldestTs
  );
  
  if (chunkIndex >= 0) {
    await loadChunk(chunkIndex);
    // After load, scroll to message
    setTimeout(() => {
      const target = allMessages.find(m => m.ts === timestamp);
      if (target) scrollToMessage(target);
    }, 0);
  }
};

const scrollToMessage = (message: ArchiveMessage) => {
  const element = document.getElementById(message.ts);
  if (element) {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    // Highlight briefly
    element.classList.add("highlight");
    setTimeout(() => element.classList.remove("highlight"), 2000);
  }
};
```

**Step 3: Run test** — Expected: PASS

**Step 4: Commit**

---

### Task 13: Implement URL sync on scroll (History API)

**Files:**
- Modify: `src/ChannelApp.tsx`

**Step 1: Write failing test**
```typescript
// src/ChannelApp.test.tsx
test("URL updates with nearest message timestamp on scroll", () => {
  // Scroll, verify history.replaceState called with correct URL
});
```

**Step 2: Add scroll listener for URL sync**
```tsx
const lastUrlUpdate = useRef(0);

const handleScroll = useCallback(() => {
  const now = Date.now();
  if (now - lastUrlUpdate.current < 500) return; // Throttle
  lastUrlUpdate.current = now;
  
  if (!listRef.current) return;
  
  // Get visible range from react-window
  const { visibleStartIndex, visibleStopIndex } = listRef.current.getVisibleRange();
  const middleIndex = Math.floor((visibleStartIndex + visibleStopIndex) / 2);
  const message = allMessages[middleIndex];
  
  if (message) {
    const newUrl = `${window.location.pathname}#${message.ts}`;
    window.history.replaceState(null, "", newUrl);
  }
}, [allMessages]);

useEffect(() => {
  const container = document.querySelector(".channel-app");
  container?.addEventListener("scroll", handleScroll, { passive: true });
  return () => container?.removeEventListener("scroll", handleScroll);
}, [handleScroll]);
```

**Step 3: Run test** — Expected: PASS

**Step 4: Commit**

---

## Phase 4: Static Fallback & Backward Compatibility

### Task 14: Keep generating static HTML pages as fallback

**Files:**
- Modify: `src/create-html.tsx` (renderPages function)

**Step 1: Write failing test**
```typescript
// src/create-html.test.tsx
test("static HTML pages still generated for fallback", async () => {
  // Verify channelId-0.html, channelId-1.html still exist
});
```

**Step 2: Update renderPages to generate BOTH chunks and static HTML**
```typescript
// In renderPages:
// 1. First pass: write all chunks (for infinite scroll)
// 2. Second pass: write static HTML pages (for fallback/SEO/file://)

for (const plan of plans) {
  const channel = byId.get(plan.channelId);
  if (!channel) continue;
  
  // Write chunks
  for (const chunk of plan.chunks) {
    const messages = await getMessageSlice(plan.channelId, chunk.span);
    await writeChunk(HTML_DIR, plan.channelId, chunk.index, { /* ... */ });
  }
  
  // Write static pages (reuse existing MessagesPage component)
  for (const page of plan.pages) { // Need to keep pages in ChannelPlan for this
    const messages = await getMessageSlice(plan.channelId, page.span);
    await renderAndWrite(
      <MessagesPage channel={channel} messages={messages} index={page.index} chunksInfo={plan.chunksInfo} months={plan.months} />,
      getHTMLFilePath(plan.channelId, page.index)
    );
  }
  
  // Write entry page (new)
  await renderChannelEntry(channel, plan, plan.months);
}
```

**Note:** This means ChannelPlan needs both `chunks` (for infinite scroll) and `pages` (for static fallback). Update render-plan.ts accordingly.

**Step 3: Run test** — Expected: PASS

**Step 4: Commit**

---

### Task 15: Update self-heal.js for new permalink format

**Files:**
- Modify: `static/self-heal.js`

**Step 1: Write failing test** (manual verification)

**Step 2: Update self-heal.js**
```javascript
// Current: redirects to index.html?c=CHANNEL&ts=TS
// New: also try channel.html#TS first (infinite scroll entry)
(function () {
  var params = new URLSearchParams(window.location.search);
  var channel = params.get("c");
  var ts = params.get("ts");
  
  if (channel && ts) {
    // Try new infinite scroll entry point first
    window.location.replace(`html/${channel}.html#${ts}&resolved=1`);
  }
})();
```

**Step 3: Test manually** — Expected: Works

**Step 4: Commit**

---

## Phase 5: Search Integration

### Task 16: Update search results to link to new channel entry

**Files:**
- Modify: `src/search-app.tsx` (Message component href)

**Step 1: Write failing test**
```typescript
// src/search-app.test.tsx
test("search result links to channel.html#timestamp", () => {
  // Render Message component, check href
});
```

**Step 2: Update Message component in search-app.tsx**
```tsx
// Line ~737: Change href from html/channel-page.html to channel.html
const href = `${message.c}.html#${message.t}`; // Was: `html/${message.c}-${page}.html#${message.t}`
```

**Step 3: Run test** — Expected: PASS

**Step 4: Commit**

---

### Task 17: Update search page to use new sidebar fragment path

**Files:**
- Modify: `static/search.html` (sidebar path)

**Step 1: Update sidebar script src**
```html
<!-- Was: <script defer src="html/sidebar.js"></script> -->
<script defer src="../html/sidebar.js"></script>
```
(Adjust based on actual output structure)

**Step 2: Commit**

---

## Phase 6: Polish & Edge Cases

### Task 18: Add loading skeletons for better UX

**Files:**
- Modify: `src/ChannelApp.tsx`
- Modify: `static/style.css`

**Step 1: Add skeleton renderers**
```tsx
const SkeletonItem = ({ index, style }: { index: number; style: React.CSSProperties }) => (
  <div style={style} className="message-skeleton">
    <div className="skeleton-avatar" />
    <div className="skeleton-text">
      <div className="skeleton-line" />
      <div className="skeleton-line short" />
    </div>
  </div>
);

// In List: use SkeletonItem for indices beyond loadedChunks
```

**Step 2: Add CSS for skeletons**
```css
.message-skeleton { padding: 12px; }
.skeleton-avatar { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(90deg, #eee 25%, #f5f5f5 50%, #eee 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
.skeleton-line { height: 16px; background: linear-gradient(90deg, #eee 25%, #f5f5f5 50%, #eee 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; margin: 4px 0; }
.skeleton-line.short { width: 60%; }
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
```

**Step 3: Commit**

---

### Task 19: Handle scroll restoration on back/forward navigation

**Files:**
- Modify: `src/ChannelApp.tsx`

**Step 1: Write failing test**
```typescript
// src/ChannelApp.test.tsx
test("scroll position restored on back navigation", () => {
  // Simulate popstate, verify scrollTo called
});
```

**Step 2: Add scroll restoration**
```tsx
const scrollPositionRef = useRef<number>(0);

useEffect(() => {
  const handleBeforeUnload = () => {
    const container = document.querySelector(".channel-app");
    if (container) scrollPositionRef.current = container.scrollTop;
  };
  
  const handlePopState = () => {
    // Restore scroll after chunks load
    setTimeout(() => {
      const container = document.querySelector(".channel-app");
      if (container) container.scrollTop = scrollPositionRef.current;
    }, 100);
  };
  
  window.addEventListener("beforeunload", handleBeforeUnload);
  window.addEventListener("popstate", handlePopState);
  
  return () => {
    window.removeEventListener("beforeunload", handleBeforeUnload);
    window.removeEventListener("popstate", handlePopState);
  };
}, []);
```

**Step 3: Run test** — Expected: PASS

**Step 4: Commit**

---

### Task 20: Add keyboard navigation (j/k, g/G, ? for help)

**Files:**
- Modify: `src/ChannelApp.tsx`

**Step 1: Add key handler**
```tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    
    const container = document.querySelector(".channel-app");
    if (!container) return;
    
    switch (e.key) {
      case "j": container.scrollBy({ top: 100, behavior: "smooth" }); break;
      case "k": container.scrollBy({ top: -100, behavior: "smooth" }); break;
      case "g": container.scrollTo({ top: 0, behavior: "smooth" }); break;
      case "G": container.scrollTo({ top: container.scrollHeight, behavior: "smooth" }); break;
      case "?": showHelp(); break;
    }
  };
  
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, []);
```

**Step 2: Commit**

---

## Phase 7: Testing & Validation

### Task 21: Add integration tests for full flow

**Files:**
- Create: `src/integration.test.ts`

**Step 1: Test chunk generation**
```typescript
test("full render produces chunks + entry page + static pages", async () => {
  // Run mini render, verify output structure
});
```

**Step 2: Test permalink resolution**
```typescript
test("permalink resolves to correct chunk and scrolls", async () => {
  // Load channel.html#timestamp, verify message visible
});
```

**Step 3: Test infinite scroll loads chunks**
```typescript
test("scrolling loads next chunk", async () => {
  // Scroll sentinel, verify fetch called
});
```

**Step 4: Run all tests** — Expected: PASS

**Step 5: Commit**

---

### Task 22: Manual verification checklist

**Manual tests (not automated):**
- [ ] Open channel.html directly — loads first chunk, scroll works
- [ ] Open channel.html#timestamp — loads correct chunk, scrolls to message
- [ ] Scroll to bottom — loads next chunk seamlessly
- [ ] Refresh page at scroll position — restores position
- [ ] Back button after scroll — restores position
- [ ] Search result click — opens channel.html#timestamp, works
- [ ] Old static page link (channel-0.html) — still works (fallback)
- [ ] file:// protocol — static pages work, infinite scroll degrades gracefully
- [ ] Mobile Safari — touch scrolling works, lazy load triggers
- [ ] Large channel (700+ chunks) — memory stable, no jank

---

## Rollback Plan

If issues arise:
1. Keep static HTML generation (Task 14) — always works
2. Feature flag: `--infinite-scroll` to toggle new entry page generation
3. Old `pages.js` format preserved for self-heal.js compatibility

---

## Estimated Timeline

| Phase | Tasks | Estimate |
|-------|-------|----------|
| 1: Data Layer | 1-5 | 3-4 days |
| 2: Client App | 6-10 | 5-7 days |
| 3: Permalinks/URL | 11-13 | 2-3 days |
| 4: Fallback | 14-15 | 1-2 days |
| 5: Search | 16-17 | 1 day |
| 6: Polish | 18-20 | 2-3 days |
| 7: Testing | 21-22 | 2-3 days |
| **Total** | **22** | **~3-4 weeks** |

---

## Execution Options

**Plan complete and saved to `docs/plans/2026-09-03-infinite-scroll-lazy-load.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**