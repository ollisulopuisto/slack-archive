import React from "react";
import { ArchiveMessage } from "./interfaces.js";
import { useRender } from "./render-context.js";
import { splitQuotes } from "./blockquotes.js";
import { renderMessageHtml } from "./message-html.js";
import { Avatar } from "./create-html.js";
import { Reaction } from "./create-html.js";
import { getName } from "./users.js";
import { nameAt, UserName, UserNames } from "./user-names.js";
import { profileHref } from "./create-html.js";
import { slackTimestampToIso } from "./timestamp.js";
import { formatTimestamp } from "./create-html.js";

interface FilesProps {
  message: ArchiveMessage;
  channelId: string;
}
const Files: React.FunctionComponent<FilesProps> = (props) => {
  const { message, channelId } = props;
  const { files } = message;
  const { skippedFileOwners, base, linkContext } = useRender();

  if (!files || files.length === 0) return null;

  if (message.user && skippedFileOwners.has(message.user)) {
    return (
      <div className="files">
        {files.map((file: any) => (
          <span key={file.id} className="file-gone">
            {file.name || "A file"} - not archived, it is already here
          </span>
        ))}
      </div>
    );
  }

  const fileElements = files.map((file: any) => {
    const { thumb_1024, thumb_720, thumb_480, thumb_pdf } = file;
    const thumb = thumb_1024 || thumb_720 || thumb_480 || thumb_pdf;
    const name = file.name;

    if (!name) {
      const elsewhere = file.url_private_download || file.permalink;

      if (elsewhere) {
        return (
          <a key={file.id} href={elsewhere} target="_blank" rel="noreferrer">
            {file.name || file.title || elsewhere}
          </a>
        );
      }

      return (
        <span key={file.id} className="file-gone">
          {file.name || "A file"} - Slack no longer has this one
        </span>
      );
    }

    let src = `${linkContext.filesBaseUrl}files/${channelId}/${name}`;
    let href = src;

    if (file.mimetype?.startsWith("image")) {
      return (
        <a key={file.id} href={href} target="_blank">
          <img className="file" src={src} />
        </a>
      );
    }

    if (file.mimetype?.startsWith("video")) {
      return <video key={file.id} controls src={src} />;
    }

    if (file.mimetype?.startsWith("audio")) {
      return <audio key={file.id} controls src={src} />;
    }

    if (!file.mimetype?.startsWith("image") && thumb) {
      src = `${linkContext.filesBaseUrl}files/${channelId}/${name}`;

      return (
        <a key={file.id} href={href} target="_blank">
          <img className="file" src={src} />
        </a>
      );
    }

    return (
      <a key={file.id} href={href} target="_blank">
        {file.name}
      </a>
    );
  });

  return <div className="files">{fileElements}</div>;
};

interface ParentMessageProps {
  message: ArchiveMessage;
  channelId: string;
}
export const ParentMessage: React.FunctionComponent<ParentMessageProps> = (props) => {
  const { message, channelId } = props;
  const hasFiles = !!message.files;

  return (
    <Message message={message} channelId={channelId}>
      {hasFiles ? <Files message={message} channelId={channelId} /> : null}
      {message.reactions?.map((reaction: any) => (
        <Reaction key={reaction.name} reaction={reaction} />
      ))}
      {message.replies?.map((reply) => (
        <ParentMessage
          message={reply as ArchiveMessage}
          channelId={channelId}
          key={reply.ts}
        />
      ))}
    </Message>
  );
};

interface MessageProps {
  message: ArchiveMessage;
  channelId: string;
  children?: React.ReactNode;
}
const Message: React.FunctionComponent<MessageProps> = (props) => {
  const { users, userNames, linkContext, profileIds, base } = useRender();

  const { message, channelId } = props;
  const username = getName(message.user, users);

  const iso = slackTimestampToIso(message.ts);
  const thenKnownAs = iso ? nameAt(userNames, message.user, iso) : null;
  const wasCalled =
    thenKnownAs && thenKnownAs.toLowerCase() !== (username || "").toLowerCase()
      ? thenKnownAs
      : null;
  const profile = profileHref(message.user, profileIds);

  const sender = (
    <span
      className="sender"
      title={wasCalled ? `Then known as ${wasCalled}` : undefined}
    >
      {username}
    </span>
  );

  return (
    <div className="message-gutter" id={message.ts}>
      <div className="" data-stringify-ignore="true">
        {profile ? (
          <a
            href={profile}
            className="author-link"
            title={`${username} - ten years of them`}
          >
            <Avatar userId={message.user} />
          </a>
        ) : (
          <Avatar userId={message.user} />
        )}
      </div>
      <div className="">
        {profile ? (
          <a href={profile} className="author-link">
            {sender}
          </a>
        ) : (
          sender
        )}
        <a
          className="timestamp"
          href={`#${message.ts}`}
          title="Link to this message"
        >
          <span className="c-timestamp__label">{formatTimestamp(message)}</span>
        </a>
        <br />
        <div className="text">
          {splitQuotes(message.text).map((block, i) => {
            const html = renderMessageHtml(block.text, {
              users,
              linkContext,
              base,
            });

            return block.quote ? (
              <blockquote key={i} dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <div key={i} dangerouslySetInnerHTML={{ __html: html }} />
            );
          })}
        </div>
        {props.children}
      </div>
    </div>
  );
};