/**
 * Parsing one line of a Claude Code transcript JSONL file (session or
 * subagent) into a `TranscriptEvent`.
 *
 * The transcript format is an unofficial contract — nothing guarantees a
 * given line matches the shape this file expects — so every function here is
 * tolerant on purpose: a blank line, invalid JSON, or an unrecognized shape
 * produces `null` rather than a throw, and any block whose content would blow
 * past its size cap is truncated rather than kept whole, so one huge tool
 * result cannot blow up memory or the transcript view.
 */
import type { TranscriptBlock, TranscriptEvent } from '../../../shared/fleet';

/** `text` block cap: enough for a long paragraph, not a whole file dump. */
export const TEXT_CAP_BYTES = 16 * 1024;
/** `thinking` block cap — thinking is rendered collapsed, so it can be smaller. */
export const THINKING_CAP_BYTES = 4 * 1024;
/** `tool_use` block cap, applied to the serialized `input`. */
export const TOOL_USE_CAP_BYTES = 2 * 1024;
/** `tool_result` block cap, applied to the flattened `content`. */
export const TOOL_RESULT_CAP_BYTES = 4 * 1024;

interface Truncated {
  value: string;
  truncated: boolean;
}

/**
 * Cap `value` to `maxBytes` of UTF-8, backing off from the cut point until it
 * no longer lands inside a multi-byte character — a plain `.slice()` can
 * split a character in half and produce a mangled trailing byte.
 */
function truncateUtf8(value: string, maxBytes: number): Truncated {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= maxBytes) return { value, truncated: false };

  let end = maxBytes;
  // A UTF-8 continuation byte matches 10xxxxxx; back off until `end` sits on
  // a character boundary (a leading byte or plain ASCII).
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;

  return { value: new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, end)), truncated: true };
}

/** Flatten `tool_result` content, whether it arrived as a string or as content blocks. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string') {
          return (block as { text: string }).text;
        }
        try {
          return JSON.stringify(block);
        } catch {
          return '';
        }
      })
      .join('\n');
  }
  if (content === null || content === undefined) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return '';
  }
}

function parseBlock(raw: unknown): TranscriptBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const block = raw as Record<string, unknown>;

  switch (block.type) {
    case 'text': {
      const { value, truncated } = truncateUtf8(typeof block.text === 'string' ? block.text : '', TEXT_CAP_BYTES);
      return { type: 'text', text: value, truncated };
    }
    case 'thinking': {
      const { value, truncated } = truncateUtf8(
        typeof block.thinking === 'string' ? block.thinking : '',
        THINKING_CAP_BYTES,
      );
      return { type: 'thinking', thinking: value, truncated };
    }
    case 'tool_use': {
      let serialized: string;
      try {
        serialized = JSON.stringify(block.input ?? {});
      } catch {
        serialized = '';
      }
      const { value, truncated } = truncateUtf8(serialized, TOOL_USE_CAP_BYTES);
      return {
        type: 'tool_use',
        id: typeof block.id === 'string' ? block.id : '',
        name: typeof block.name === 'string' ? block.name : '',
        input: value,
        truncated,
      };
    }
    case 'tool_result': {
      const { value, truncated } = truncateUtf8(textOf(block.content), TOOL_RESULT_CAP_BYTES);
      return {
        type: 'tool_result',
        toolUseId: typeof block.tool_use_id === 'string' ? block.tool_use_id : '',
        content: value,
        isError: block.is_error === true,
        truncated,
      };
    }
    default:
      return null;
  }
}

/** Every transcript line type this tab does not render collapses to `'other'`. */
function roleOf(type: unknown): TranscriptEvent['role'] {
  return type === 'user' || type === 'assistant' ? type : 'other';
}

/**
 * Parse one JSONL transcript line into a `TranscriptEvent`.
 *
 * Returns `null` for a blank line, invalid JSON, or a top-level value that is
 * not an object — never throws. A recognized-but-message-less line (e.g. an
 * `attachment` event) parses to an event with empty `blocks` rather than
 * being rejected: only unparseable input is `null`.
 */
export function parseTranscriptLine(line: string): TranscriptEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const message =
    obj.message && typeof obj.message === 'object' && !Array.isArray(obj.message)
      ? (obj.message as Record<string, unknown>)
      : undefined;
  const content = message?.content;

  let blocks: TranscriptBlock[];
  if (typeof content === 'string') {
    const { value, truncated } = truncateUtf8(content, TEXT_CAP_BYTES);
    blocks = content ? [{ type: 'text', text: value, truncated }] : [];
  } else if (Array.isArray(content)) {
    blocks = content.map(parseBlock).filter((block): block is TranscriptBlock => block !== null);
  } else {
    blocks = [];
  }

  return {
    uuid: typeof obj.uuid === 'string' ? obj.uuid : null,
    role: roleOf(obj.type),
    timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : null,
    agentId: typeof obj.agentId === 'string' ? obj.agentId : null,
    sessionId: typeof obj.sessionId === 'string' ? obj.sessionId : null,
    blocks,
  };
}
