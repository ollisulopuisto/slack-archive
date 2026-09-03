// @ts-nocheck
/**
 * The search page's browser app.
 *
 * Compiled by tsc (JSX -> React.createElement) and copied into html/ with the
 * import lines stripped, so it runs as a plain script next to the UMD React
 * build. file:// blocks module scripts; a CDN copy of babel-standalone is how
 * this used to compile in the reader's browser, and that is an eval plus a
 * third party on every search.
 */
import React from "react";
import ReactDOM from "react-dom";

declare const MiniSearch: any;
declare function createDbWorker(...args: any[]): Promise<any>;
declare function buildSearchSql(request: any): any;
declare function parseSearchQuery(query: string): any;
declare function getSearchFilter(filters: any): any;
declare function filterResultsByPhrases(rows: any, phrases: any): any;
declare function sortSearchResults(
  rows: any,
  sort: any,
  hasQuery: boolean,
): any;
declare function splitSearchHighlight(text: string, query: string): any;
declare function splitEmoji(text: string, index: any): any;
declare function messageLink(channelId: string, ts: string): string;

// How much of the database one page-load may pull down before it gives
// up. Every query it can answer reads a few hundred kilobytes; anything
// approaching this means a query fell back to scanning, and a phone on
// cellular should be told rather than billed.
const MAX_BYTES = 64 * 1024 * 1024;

// Big enough that one request covers several pages of the database,
// small enough that a query is not a download.
const CHUNK = 4096;

/**
 * A date from a picker as epoch seconds, in the reader's own timezone.
 *
 * `new Date("2025-01-01")` is midnight UTC, which is the previous evening
 * in Helsinki - a message sent at 01:30 would fall outside a range that
 * visibly includes its day. Constructed from the parts instead, which is
 * local by definition.
 */
function startOfDay(value, addDays = 0) {
  if (!value) return undefined;

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;

  return Math.floor(new Date(year, month - 1, day + addDays).getTime() / 1000);
}

class App extends React.PureComponent {
  constructor(props) {
    super(props);

    this.handleSearchChange = this.handleSearchChange.bind(this);
    this.handleSearchClear = this.handleSearchClear.bind(this);
    this.handleChannelChange = this.handleChannelChange.bind(this);
    this.handleUserChange = this.handleUserChange.bind(this);
    this.handleFromChange = this.handleFromChange.bind(this);
    this.handleToChange = this.handleToChange.bind(this);
    this.handleSortChange = this.handleSortChange.bind(this);
    this.handleThreadChange = this.handleThreadChange.bind(this);
    this.handleResetFilters = this.handleResetFilters.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handlePopState = this.handlePopState.bind(this);

    this.searchInputRef = React.createRef();
    // Queries are answered over the network now, so they come back out
    // of order. Only the newest one is allowed to render.
    this.queryId = 0;
    this.pending = null;

    const params = new URLSearchParams(window.location.search);
    const query = params.get("q") || "";
    const channelParam = params.get("channel") || params.get("c") || "";
    const userParam = params.get("user") || params.get("u") || "";
    const fromParam = params.get("from") || "";
    const toParam = params.get("to") || "";
    const sortParam = params.get("sort");
    const threadParam = params.get("thread") || params.get("threads") || "all";

    const initialSort =
      sortParam === "oldest" ||
      sortParam === "newest" ||
      sortParam === "relevance" ||
      sortParam === "score"
        ? sortParam === "score"
          ? "relevance"
          : sortParam
        : "relevance";

    this.state = {
      matchingMessages: [],
      searchValue: query,
      selectedChannel: channelParam,
      selectedUser: userParam,
      fromDate: fromParam,
      toDate: toParam,
      sortOrder: initialSort,
      threadFilter: ["all", "roots", "replies"].includes(threadParam)
        ? threadParam
        : "all",
      ready: false,
      searching: false,
      error: null,
      channels: {},
      users: {},
    };
  }

  componentDidMount() {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("popstate", this.handlePopState);

    const built = window.SEARCH_INDEXES || { db: true, js: false };
    // ?index=js or ?index=db forces one of them, which is how you find
    // out whether a slow search is the index or the archive.
    const forced = new URLSearchParams(window.location.search).get("index");

    if (forced === "js" && built.js) return this.loadJsIndex("asked for");
    if (forced === "db" && built.db) return this.openDatabase();

    // A database read over range requests cannot be read from file://:
    // there are no range requests there, and a worker loaded from file://
    // is refused. So an archive opened as a folder of files uses the
    // JavaScript index, if it was built - and an archive served over
    // HTTP uses the database, which is what makes it work on a phone.
    if (built.db && window.location.protocol !== "file:") {
      this.openDatabase();
    } else if (built.js) {
      this.loadJsIndex(
        built.db
          ? "opened from a folder rather than served, so the database index cannot be read"
          : null,
      );
    } else {
      this.setState({
        error:
          "this archive was built with --search-index db, and a database index needs to be served over HTTP rather than opened as a file",
      });
    }
  }

  componentWillUnmount() {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("popstate", this.handlePopState);
  }

  handleKeyDown(event) {
    const target = event.target || document.activeElement;
    const tagName = target && target.tagName;
    const isInputFocused =
      tagName === "INPUT" ||
      tagName === "TEXTAREA" ||
      tagName === "SELECT" ||
      (target && target.isContentEditable);

    if (event.key === "/" && !isInputFocused) {
      event.preventDefault();
      if (this.searchInputRef && this.searchInputRef.current) {
        this.searchInputRef.current.focus();
        this.searchInputRef.current.select();
      }
    } else if (event.key === "Escape") {
      if (
        this.searchInputRef &&
        this.searchInputRef.current &&
        document.activeElement === this.searchInputRef.current
      ) {
        this.searchInputRef.current.blur();
      }
    }
  }

  handlePopState() {
    const searchParams = new URLSearchParams(window.location.search);
    const searchValue = searchParams.get("q") || "";
    const selectedChannel =
      searchParams.get("channel") || searchParams.get("c") || "";
    const selectedUser =
      searchParams.get("user") || searchParams.get("u") || "";
    const fromDate = searchParams.get("from") || "";
    const toDate = searchParams.get("to") || "";
    const sortParam = searchParams.get("sort");
    const threadParam =
      searchParams.get("thread") || searchParams.get("threads") || "all";

    const sortOrder =
      sortParam === "oldest" ||
      sortParam === "newest" ||
      sortParam === "relevance" ||
      sortParam === "score"
        ? sortParam === "score"
          ? "relevance"
          : sortParam
        : "relevance";

    const threadFilter = ["all", "roots", "replies"].includes(threadParam)
      ? threadParam
      : "all";

    this.setState(
      {
        searchValue,
        selectedChannel,
        selectedUser,
        fromDate,
        toDate,
        sortOrder,
        threadFilter,
      },
      () => this.updateResults(),
    );
  }

  syncUrlParams() {
    const {
      searchValue,
      selectedChannel,
      selectedUser,
      fromDate,
      toDate,
      sortOrder,
      threadFilter,
    } = this.state;

    const params = new URLSearchParams();
    if (searchValue.trim()) params.set("q", searchValue.trim());
    if (selectedChannel) params.set("channel", selectedChannel);
    if (selectedUser) params.set("user", selectedUser);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    if (sortOrder && sortOrder !== "relevance") params.set("sort", sortOrder);
    if (threadFilter && threadFilter !== "all")
      params.set("thread", threadFilter);

    const indexParam = new URLSearchParams(window.location.search).get("index");
    if (indexParam) params.set("index", indexParam);

    const qs = params.toString();
    const newUrl = `${window.location.pathname}${qs ? "?" + qs : ""}${window.location.hash}`;
    window.history.replaceState(null, "", newUrl);
  }

  hasSearchCriteria() {
    const {
      searchValue,
      selectedChannel,
      selectedUser,
      fromDate,
      toDate,
      threadFilter,
    } = this.state;
    return Boolean(
      (searchValue && searchValue.trim().length > 1) ||
      selectedChannel ||
      selectedUser ||
      fromDate ||
      toDate ||
      (threadFilter && threadFilter !== "all"),
    );
  }

  /**
   * The whole corpus in one script tag, indexed here in the browser.
   */
  loadJsIndex(reason) {
    if (reason) console.info(`Using the JavaScript index: ${reason}`);

    if (!window.search_data) {
      setTimeout(() => this.loadJsIndex(null), 100);
      return;
    }

    const { messages, channels, users } = window.search_data;
    const allMessages = [];

    for (const channel in messages) {
      for (const message of messages[channel]) {
        allMessages.push(
          Object.assign({}, message, {
            c: channel,
            id: `${channel}-${message.t}`,
          }),
        );
      }
    }

    const miniSearch = new MiniSearch({
      idField: "id",
      fields: ["m"],
      storeFields: ["t", "u", "m", "c", "p"],
    });
    miniSearch.addAll(allMessages);

    this.miniSearch = miniSearch;
    this.setState({ ready: true, channels, users }, () => {
      if (this.hasSearchCriteria()) this.updateResults();
    });
  }

  /** The same rows the database returns, from the JavaScript index. */
  searchJsIndex(
    text,
    channel,
    user,
    after,
    before,
    sort = "relevance",
    threads = "all",
  ) {
    const { cleanQuery, phrases } = parseSearchQuery(text);
    const options = { combineWith: "AND", prefix: true };
    const filter = getSearchFilter({ channel, user, threads });

    if (filter) options.filter = filter;

    let results;
    if (cleanQuery) {
      results = this.miniSearch.search(cleanQuery, options);
    } else if (channel || user || after || before || threads !== "all") {
      results = this.miniSearch.search(MiniSearch.wildcard, options);
    } else {
      results = [];
    }

    // The dates are applied AFTER the index, not inside it: MiniSearch
    // holds no timestamps to filter on.
    if (after || before) {
      results = results.filter((result) => {
        const seconds = Number(result.t);
        if (after && seconds < after) return false;
        if (before && seconds >= before) return false;
        return true;
      });
    }

    results = filterResultsByPhrases(results, phrases);

    if (typeof sortSearchResults === "function") {
      results = sortSearchResults(results, sort, !!cleanQuery);
    } else {
      if (sort === "newest") {
        results.sort((a, b) => Number(b.t) - Number(a.t));
      } else if (sort === "oldest") {
        results.sort((a, b) => Number(a.t) - Number(b.t));
      } else if (!cleanQuery) {
        results.sort((a, b) => Number(b.t) - Number(a.t));
      }
    }

    return results.slice(0, 50).map((result) => {
      return {
        id: result.id,
        c: result.c,
        u: result.u,
        t: result.t,
        p: result.p,
        m_text: result.m,
      };
    });
  }

  async openDatabase() {
    try {
      const worker = await createDbWorker(
        [
          {
            from: "inline",
            config: {
              serverMode: "full",
              url: new URL("data/search.db", document.baseURI).href,
              requestChunkSize: CHUNK,
            },
          },
        ],
        new URL("html/sqlite.worker.js", document.baseURI).href,
        new URL("html/sql-wasm.wasm", document.baseURI).href,
        MAX_BYTES,
      );

      const channelRows = await worker.db.query(
        "select id, name from channels order by name",
      );
      const userRows = await worker.db.query(
        "select id, name from users order by name",
      );

      const channels = {};
      for (const row of channelRows) channels[row.id] = row.name;
      const users = {};
      for (const row of userRows) users[row.id] = row.name;

      this.worker = worker;
      this.setState({ ready: true, channels, users }, () => {
        if (this.hasSearchCriteria()) this.updateResults();
      });
    } catch (error) {
      console.error("could not open the search database", error);

      if ((window.SEARCH_INDEXES || {}).js) {
        this.loadJsIndex("the database could not be opened");
        return;
      }

      this.setState({ error: String((error && error.message) || error) });
    }
  }

  handleSearchChange({ target: { value } }) {
    this.setState({ searchValue: value }, () => {
      clearTimeout(this.pending);
      this.pending = setTimeout(() => this.updateResults(), 250);
    });
  }

  handleChannelChange({ target: { value } }) {
    this.setState({ selectedChannel: value }, () => this.updateResults());
  }

  handleUserChange({ target: { value } }) {
    this.setState({ selectedUser: value }, () => this.updateResults());
  }

  handleFromChange({ target: { value } }) {
    this.setState({ fromDate: value }, () => this.updateResults());
  }

  handleToChange({ target: { value } }) {
    this.setState({ toDate: value }, () => this.updateResults());
  }

  handleSortChange({ target: { value } }) {
    this.setState({ sortOrder: value }, () => this.updateResults());
  }

  handleThreadChange({ target: { value } }) {
    this.setState({ threadFilter: value }, () => this.updateResults());
  }

  handleSearchClear() {
    clearTimeout(this.pending);
    this.setState({ searchValue: "" }, () => {
      this.updateResults();
      if (this.searchInputRef.current) {
        this.searchInputRef.current.focus();
      }
    });
  }

  handleResetFilters() {
    clearTimeout(this.pending);
    this.queryId++;
    this.setState(
      {
        searchValue: "",
        matchingMessages: [],
        selectedChannel: "",
        selectedUser: "",
        fromDate: "",
        toDate: "",
        sortOrder: "relevance",
        threadFilter: "all",
        searching: false,
      },
      () => {
        this.syncUrlParams();
        if (this.searchInputRef.current) {
          this.searchInputRef.current.focus();
        }
      },
    );
  }

  async updateResults() {
    const {
      searchValue,
      selectedChannel,
      selectedUser,
      fromDate,
      toDate,
      sortOrder,
      threadFilter,
    } = this.state;

    const text = searchValue.trim();
    const after = startOfDay(fromDate);
    const before = startOfDay(toDate, 1);
    const query = buildSearchSql({
      query: text.length > 1 ? text : "",
      channel: selectedChannel,
      user: selectedUser,
      after,
      before,
      sort: sortOrder,
      threads: threadFilter,
    });

    this.syncUrlParams();

    if (!query || (!this.worker && !this.miniSearch)) {
      this.setState({ matchingMessages: [], searching: false });
      return;
    }

    const id = ++this.queryId;
    this.setState({ searching: true });

    try {
      const rows = this.worker
        ? await this.worker.db.query(query.sql, query.params)
        : this.searchJsIndex(
            text.length > 1 ? text : "",
            selectedChannel,
            selectedUser,
            after,
            before,
            sortOrder,
            threadFilter,
          );

      if (id !== this.queryId) return;

      this.setState({ matchingMessages: rows, searching: false });
    } catch (error) {
      if (id !== this.queryId) return;

      console.error("search failed", error);
      this.setState({
        matchingMessages: [],
        searching: false,
        error: String((error && error.message) || error),
      });
    }
  }

  render() {
    const {
      matchingMessages,
      searchValue,
      selectedChannel,
      selectedUser,
      fromDate,
      toDate,
      sortOrder,
      threadFilter,
      ready,
      searching,
      error,
      channels,
      users,
    } = this.state;

    if (error) {
      return (
        <div className="App">
          <article className="main">
            <p className="search-error">
              The search database could not be read: {error}
            </p>
            <p>
              Every message is still on the channel pages; only the search box
              needs it.
            </p>
          </article>
        </div>
      );
    }

    const asked =
      searchValue ||
      selectedChannel ||
      selectedUser ||
      fromDate ||
      toDate ||
      threadFilter !== "all";

    const hasFiltersActive =
      Boolean(searchValue) ||
      Boolean(selectedChannel) ||
      Boolean(selectedUser) ||
      Boolean(fromDate) ||
      Boolean(toDate) ||
      sortOrder !== "relevance" ||
      threadFilter !== "all";

    return (
      <div className="App">
        <article className="main">
          {ready ? (
            <Header
              onChange={this.handleSearchChange}
              onChannelChange={this.handleChannelChange}
              onUserChange={this.handleUserChange}
              onFromChange={this.handleFromChange}
              onToChange={this.handleToChange}
              onSortChange={this.handleSortChange}
              onThreadChange={this.handleThreadChange}
              onSearchClear={this.handleSearchClear}
              onResetFilters={this.handleResetFilters}
              value={searchValue}
              selectedChannel={selectedChannel}
              selectedUser={selectedUser}
              fromDate={fromDate}
              toDate={toDate}
              sortOrder={sortOrder}
              threadFilter={threadFilter}
              hasFiltersActive={hasFiltersActive}
              searchInputRef={this.searchInputRef}
              channels={channels}
              users={users}
            />
          ) : (
            <p>Opening the search index…</p>
          )}

          {matchingMessages.length > 0 ? (
            <div>
              <ResultsMeta
                count={matchingMessages.length}
                searching={searching}
              />
              <MessagesList
                messages={matchingMessages}
                channels={channels}
                users={users}
                query={searchValue}
              />
            </div>
          ) : (
            <p className="SearchSummary empty">
              {searching
                ? "Searching…"
                : asked
                  ? "No matches found."
                  : "Start typing or apply filters to search messages."}
            </p>
          )}
        </article>
      </div>
    );
  }
}

const ResultsMeta = ({ count, searching }) => {
  if (searching || !count) return null;
  return (
    <div className="SearchSummary">
      <span>
        {count >= 50
          ? "Showing top 50 messages"
          : `Found ${count} ${count === 1 ? "message" : "messages"}`}
      </span>
    </div>
  );
};

/**
 * Highlight matched query terms inside a text string.
 */
function renderHighlight(text, query) {
  if (!text) return null;
  if (typeof splitSearchHighlight !== "function" || !query || !query.trim()) {
    return text;
  }

  const segments = splitSearchHighlight(text, query);
  return segments.map((segment, idx) =>
    segment.match ? (
      <mark key={idx} className="search-highlight">
        {segment.text}
      </mark>
    ) : (
      <React.Fragment key={idx}>{segment.text}</React.Fragment>
    ),
  );
}

/**
 * A result with its emoji shown as emoji and search terms highlighted.
 */
const EmojiText = ({ text, query }) => {
  if (typeof splitEmoji !== "function") {
    return renderHighlight(text || "", query);
  }

  return splitEmoji(text || "", window.ARCHIVE_EMOJI || {}).map(
    (part, index) =>
      part.kind === "image" ? (
        <img
          key={index}
          className="emoji"
          src={`html/${part.ref}`}
          alt={`:${part.name}:`}
          title={`:${part.name}:`}
          loading="lazy"
        />
      ) : (
        <React.Fragment key={index}>
          {renderHighlight(part.text, query)}
        </React.Fragment>
      ),
  );
};

const MessagesList = ({ messages, channels, users, query }) => (
  <ul className="MessagesList">
    {messages.map((message) => (
      <Message
        key={message.id}
        message={message}
        channels={channels}
        users={users}
        query={query}
      />
    ))}
  </ul>
);

const Message = ({ message, channels, users, query }) => {
  // The entry page resolves the timestamp with its own chunk index, and a
  // thread reply opens where its parent is rendered.
  const href = messageLink(message.c, message.t);
  const isReply = Boolean(message.p && message.p !== message.t);

  return (
    <a href={href} target="_blank">
      <li className={`Message ${isReply ? "is-reply" : ""}`}>
        <p className="MessageMeta">
          <span className="Channel">#{channels[message.c]}</span>
          {isReply ? (
            <span className="ThreadBadge ReplyBadge">💬 Reply</span>
          ) : (
            <span className="ThreadBadge RootBadge">Topic</span>
          )}
          <span className="MetaSeparator">·</span>
          <Timestamp timestamp={message.t} />
        </p>
        <p className="MessageBody">
          <strong>@{users[message.u] || message.u}: </strong>
          <EmojiText text={message.m_text} query={query} />
        </p>
      </li>
    </a>
  );
};

const Timestamp = ({ timestamp }) => {
  const splitTs = timestamp.split(".") || [];
  const jsTs = parseInt(
    `${splitTs[0]}${(splitTs[1] || "000").slice(0, 3)}`,
    10,
  );
  const date = new Date(jsTs);

  return (
    <span className="timestamp">
      <span className="c-timestamp__label">{date.toLocaleString()}</span>
    </span>
  );
};

const Header = (props) => (
  <header className="Header">
    <h1>Message Search</h1>
    <SearchBox {...props} />
  </header>
);

const SearchBox = ({
  onChange,
  onChannelChange,
  onUserChange,
  onFromChange,
  onToChange,
  onSortChange,
  onThreadChange,
  onSearchClear,
  onResetFilters,
  value,
  selectedChannel,
  selectedUser,
  fromDate,
  toDate,
  sortOrder,
  threadFilter,
  hasFiltersActive,
  searchInputRef,
  channels,
  users,
}) => {
  const sortedChannels = Object.entries(channels).sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  const sortedUsers = Object.entries(users).sort((a, b) =>
    a[1].localeCompare(b[1]),
  );

  return (
    <div className="SearchBox">
      <div className="Search">
        <input
          type="text"
          value={value}
          onChange={onChange}
          ref={searchInputRef}
          placeholder="Search messages... (press / to focus)"
          autoComplete="none"
          autoCorrect="none"
          autoCapitalize="none"
          spellCheck="false"
        />
        {!value && <kbd className="SearchShortcut">/</kbd>}
        {value && (
          <button
            className="clear"
            onClick={onSearchClear}
            title="Clear search text"
            type="button"
          >
            &times;
          </button>
        )}
      </div>
      <div className="Filters">
        <select
          value={selectedChannel}
          onChange={onChannelChange}
          aria-label="Filter by channel"
        >
          <option value="">All Channels</option>
          {sortedChannels.map(([id, name]) => (
            <option key={id} value={id}>
              #{name}
            </option>
          ))}
        </select>
        <select
          value={selectedUser}
          onChange={onUserChange}
          aria-label="Filter by user"
        >
          <option value="">All Users</option>
          {sortedUsers.map(([id, name]) => (
            <option key={id} value={id}>
              @{name}
            </option>
          ))}
        </select>
        <select
          value={threadFilter}
          onChange={onThreadChange}
          aria-label="Filter by thread type"
        >
          <option value="all">All Messages</option>
          <option value="roots">Channel Topics Only</option>
          <option value="replies">Thread Replies Only</option>
        </select>
        <select
          value={sortOrder}
          onChange={onSortChange}
          aria-label="Sort order"
        >
          <option value="relevance">Sort: Best match</option>
          <option value="newest">Sort: Newest first</option>
          <option value="oldest">Sort: Oldest first</option>
        </select>
        <label className="DateFilter">
          <span>From</span>
          <input type="date" value={fromDate} onChange={onFromChange} />
        </label>
        <label className="DateFilter">
          <span>To</span>
          <input type="date" value={toDate} onChange={onToChange} />
        </label>
        {hasFiltersActive && (
          <button
            type="button"
            className="ResetFilters"
            onClick={onResetFilters}
            title="Reset all filters and query"
          >
            Reset filters
          </button>
        )}
      </div>
    </div>
  );
};

ReactDOM.render(React.createElement(App), document.getElementById("search"));
