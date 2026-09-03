import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { ChannelApp } from "./ChannelApp.js";
import { RenderContextProvider } from "./render-context.js";
import { emptyRenderContext } from "./render-context.js";

vi.mock("react-window", () => ({
  List: function List({
    children,
    itemCount,
    height,
    itemSize,
    overscanCount,
  }: any) {
    const items = [];
    for (let i = 0; i < itemCount; i++) {
      const childElement = children({
        index: i,
        style: { position: "absolute", top: itemSize(i), height: itemSize(i) },
      });
      items.push(
        React.cloneElement(childElement as React.ReactElement, { key: i }),
      );
    }
    return (
      <div data-testid="virtual-list" style={{ height }}>
        {items}
      </div>
    );
  },
}));

vi.mock("./message-components.js", () => ({
  ParentMessage: ({ message }: { message: any }) => (
    <div data-testid="parent-message" data-ts={message.ts}>
      {message.text}
    </div>
  ),
}));

const mockContext = {
  ...emptyRenderContext(),
  base: "/html/",
  root: "../",
  users: {
    U1: {
      id: "U1",
      profile: { display_name: "user1", image_512: "avatar.png" },
    },
  },
  userNames: {},
  userAvatars: {},
  userStatuses: {},
  botIds: new Set(),
  skippedFileOwners: new Set(),
  profileIds: new Set(["U1"]),
  publishedChannels: new Set(["C123"]),
  channels: [],
  linkContext: {
    teamUrl: "https://example.slack.com",
    teamId: "T123",
    files: {},
    filesBaseUrl: "/files/",
    channels: new Set(["C123"]),
  },
  gaps: [],
  estimates: {},
  stats: null,
  teamMeta: { title: "Test Workspace", description: "Test" },
  renderedAt: new Date().toISOString(),
  slackArchiveData: {
    channels: {},
    auth: {
      team: "Test Workspace",
      url: "https://example.slack.com",
      team_id: "T123",
      user_id: "U1",
    },
  },
  me: { id: "U1", profile: { display_name: "user1" } },
};

const renderWithContext = (component: React.ReactElement) => {
  return render(
    <RenderContextProvider.Provider value={mockContext}>
      {component}
    </RenderContextProvider.Provider>,
  );
};

describe("ChannelApp", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("renders loading state initially", () => {
    renderWithContext(<ChannelApp channelId="C123" base="" chunksTotal={3} />);
    expect(screen.getByText(/loading messages/i)).toBeInTheDocument();
  });

  it("loads first chunk on mount", async () => {
    const mockChunk = {
      messages: [{ ts: "123.456", text: "hello", user: "U1" }],
      oldestTs: "123.456",
      newestTs: "123.456",
      index: 0,
      total: 3,
    };

    (global.fetch as vi.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockChunk,
    });

    renderWithContext(
      <ChannelApp channelId="C123" base="/html/" chunksTotal={3} />,
    );

    await waitFor(() => {
      expect(screen.queryByText(/loading messages/i)).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("parent-message")).toHaveTextContent("hello");
  });

  it("shows error when chunk load fails", async () => {
    (global.fetch as vi.Mock).mockRejectedValueOnce(new Error("Network error"));

    renderWithContext(
      <ChannelApp channelId="C123" base="/html/" chunksTotal={3} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });
});
