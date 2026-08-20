import { describe, expect, it } from 'vitest';

import {
  TEXT_CAP_BYTES,
  THINKING_CAP_BYTES,
  TOOL_RESULT_CAP_BYTES,
  TOOL_USE_CAP_BYTES,
  parseTranscriptLine,
} from '../extension/fleet/lib/transcript';

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

describe('parseTranscriptLine', () => {
  it('returns null for corrupt JSON rather than throwing', () => {
    // A line cut off mid-object, as a partial disk write or a torn tail read
    // would produce.
    const corrupt = '{"type":"user","message":{"role":"user","content":"hel';
    expect(() => parseTranscriptLine(corrupt)).not.toThrow();
    expect(parseTranscriptLine(corrupt)).toBeNull();
  });

  it('returns null for a blank line', () => {
    expect(parseTranscriptLine('')).toBeNull();
    expect(parseTranscriptLine('   \n')).toBeNull();
  });

  it('returns null for valid JSON that is not an object (e.g. a bare array)', () => {
    expect(parseTranscriptLine('[1,2,3]')).toBeNull();
    expect(parseTranscriptLine('"just a string"')).toBeNull();
  });

  it('parses a user event whose content is a plain string', () => {
    const event = parseTranscriptLine(
      line({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-08-19T10:00:00Z',
        agentId: 'a1',
        sessionId: 's1',
        message: { role: 'user', content: 'hello there' },
      }),
    );
    expect(event).toEqual({
      uuid: 'u1',
      role: 'user',
      timestamp: '2026-08-19T10:00:00Z',
      agentId: 'a1',
      sessionId: 's1',
      blocks: [{ type: 'text', text: 'hello there', truncated: false }],
    });
  });

  it('parses an assistant event with text and thinking blocks', () => {
    const event = parseTranscriptLine(
      line({
        type: 'assistant',
        uuid: 'u2',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'let me consider', signature: 'sig' },
            { type: 'text', text: 'the answer is 4' },
          ],
        },
      }),
    );
    expect(event?.role).toBe('assistant');
    expect(event?.blocks).toEqual([
      { type: 'thinking', thinking: 'let me consider', truncated: false },
      { type: 'text', text: 'the answer is 4', truncated: false },
    ]);
  });

  it('parses a tool_use block', () => {
    const event = parseTranscriptLine(
      line({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'call_1', name: 'Read', input: { path: 'a.ts' } }],
        },
      }),
    );
    expect(event?.blocks).toEqual([
      {
        type: 'tool_use',
        id: 'call_1',
        name: 'Read',
        input: JSON.stringify({ path: 'a.ts' }, null, 2),
        truncated: false,
      },
    ]);
  });

  it('pretty-prints a multi-property tool_use input across lines instead of one unbroken blob', () => {
    const event = parseTranscriptLine(
      line({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'call_edit',
              name: 'Edit',
              input: { file_path: 'a.ts', old_string: 'line one\nline two', new_string: 'line one\nline three' },
            },
          ],
        },
      }),
    );
    const block = event?.blocks[0] as { type: 'tool_use'; input: string };

    // Each top-level property gets its own line; a real newline inside
    // `old_string`/`new_string` still serializes to the two characters `\n`
    // (JSON has no other way to keep it valid), so this only asserts the
    // structural indentation, not decoding that escape.
    expect(block.input).toBe(
      JSON.stringify(
        { file_path: 'a.ts', old_string: 'line one\nline two', new_string: 'line one\nline three' },
        null,
        2,
      ),
    );
    expect(block.input.split('\n').length).toBeGreaterThan(1);
  });

  it('parses a tool_result whose content is a plain string', () => {
    const event = parseTranscriptLine(
      line({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'file contents here' }],
        },
      }),
    );
    expect(event?.blocks).toEqual([
      {
        type: 'tool_result',
        toolUseId: 'call_1',
        content: 'file contents here',
        isError: false,
        truncated: false,
      },
    ]);
  });

  it('parses a tool_result whose content is an array of content blocks', () => {
    const event = parseTranscriptLine(
      line({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_2',
              content: [
                { type: 'text', text: 'line one' },
                { type: 'text', text: 'line two' },
              ],
              is_error: true,
            },
          ],
        },
      }),
    );
    expect(event?.blocks).toEqual([
      {
        type: 'tool_result',
        toolUseId: 'call_2',
        content: 'line one\nline two',
        isError: true,
        truncated: false,
      },
    ]);
  });

  it('drops an unrecognized block type instead of throwing', () => {
    const event = parseTranscriptLine(
      line({
        type: 'assistant',
        message: { content: [{ type: 'redacted_thinking', data: 'xyz' }, { type: 'text', text: 'ok' }] },
      }),
    );
    expect(event?.blocks).toEqual([{ type: 'text', text: 'ok', truncated: false }]);
  });

  it('parses an attachment-style event (no message) as an event with empty blocks, not null', () => {
    const event = parseTranscriptLine(line({ type: 'attachment', uuid: 'a1', attachment: { kind: 'image' } }));
    expect(event).not.toBeNull();
    expect(event?.role).toBe('other');
    expect(event?.blocks).toEqual([]);
  });

  describe('size caps', () => {
    it('truncates an oversized text block to 16KB', () => {
      const big = 'x'.repeat(TEXT_CAP_BYTES + 500);
      const event = parseTranscriptLine(line({ type: 'assistant', message: { content: [{ type: 'text', text: big }] } }));
      const block = event?.blocks[0];
      expect(block?.type).toBe('text');
      expect(block && 'truncated' in block ? block.truncated : undefined).toBe(true);
      expect(new TextEncoder().encode((block as { text: string }).text).length).toBeLessThanOrEqual(TEXT_CAP_BYTES);
    });

    it('truncates an oversized thinking block to 4KB', () => {
      const big = 'y'.repeat(THINKING_CAP_BYTES + 500);
      const event = parseTranscriptLine(
        line({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: big }] } }),
      );
      const block = event?.blocks[0] as { type: 'thinking'; thinking: string; truncated: boolean };
      expect(block.truncated).toBe(true);
      expect(new TextEncoder().encode(block.thinking).length).toBeLessThanOrEqual(THINKING_CAP_BYTES);
    });

    it('truncates an oversized tool_use input to 2KB', () => {
      const bigInput = { blob: 'z'.repeat(TOOL_USE_CAP_BYTES + 500) };
      const event = parseTranscriptLine(
        line({
          type: 'assistant',
          message: { content: [{ type: 'tool_use', id: 't1', name: 'Write', input: bigInput }] },
        }),
      );
      const block = event?.blocks[0] as { type: 'tool_use'; input: string; truncated: boolean };
      expect(block.truncated).toBe(true);
      expect(new TextEncoder().encode(block.input).length).toBeLessThanOrEqual(TOOL_USE_CAP_BYTES);
    });

    it('truncates an oversized tool_result content to 4KB', () => {
      const big = 'w'.repeat(TOOL_RESULT_CAP_BYTES + 500);
      const event = parseTranscriptLine(
        line({
          type: 'user',
          message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: big }] },
        }),
      );
      const block = event?.blocks[0] as { type: 'tool_result'; content: string; truncated: boolean };
      expect(block.truncated).toBe(true);
      expect(new TextEncoder().encode(block.content).length).toBeLessThanOrEqual(TOOL_RESULT_CAP_BYTES);
    });

    it('does not truncate a text block right at the cap', () => {
      const exact = 'a'.repeat(TEXT_CAP_BYTES);
      const event = parseTranscriptLine(line({ type: 'assistant', message: { content: [{ type: 'text', text: exact }] } }));
      const block = event?.blocks[0] as { type: 'text'; truncated: boolean };
      expect(block.truncated).toBe(false);
    });

    it('truncating a multi-byte string cuts on a character boundary, not mid-character', () => {
      // Each "€" is 3 bytes in UTF-8; with a byte cap that is not a multiple
      // of 3, a naive byte-slice would split the final character.
      const euros = '€'.repeat(Math.ceil(TEXT_CAP_BYTES / 3) + 20);
      const event = parseTranscriptLine(line({ type: 'assistant', message: { content: [{ type: 'text', text: euros }] } }));
      const block = event?.blocks[0] as { type: 'text'; text: string; truncated: boolean };
      expect(block.truncated).toBe(true);
      // Every remaining character must be a whole, valid "€" — none of them
      // decoded to the U+FFFD replacement character a split would produce.
      expect(block.text.includes('�')).toBe(false);
      expect([...block.text].every((ch) => ch === '€')).toBe(true);
    });
  });
});
