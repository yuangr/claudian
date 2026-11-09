import {
  detectBuiltInCommand,
  detectSideChatCommand,
  isSideChatCommandSupported,
} from '@/core/commands/builtInCommands';

const forkCapable = { providerId: 'claude' as const, supportsFork: true };
const forkIncapable = { providerId: 'opencode' as const, supportsFork: false };

describe('detectSideChatCommand', () => {
  it.each([
    ['/side', ''],
    ['/btw', ''],
    ['/SIDE', ''],
    ['/side explore an append-only log', 'explore an append-only log'],
    ['/btw   spaced argument  ', 'spaced argument'],
    ['/side line one\nline two', 'line one\nline two'],
    ['/side\nquestion', 'question'],
    ['/btw\r\nquestion\nsecond line', 'question\nsecond line'],
    ['  /side leading whitespace', 'leading whitespace'],
  ])('recognizes %j with argument %j', (input, argument) => {
    expect(detectSideChatCommand(input)).toEqual({
      alias: input.trim().slice(1).split(/[\s]/)[0].toLowerCase(),
      argument,
    });
  });

  it.each([
    '/sid',
    '/sideways ask this',
    '/btwx',
    'please use /side later',
    'side',
    '',
  ])('treats %j as ordinary input', (input) => {
    expect(detectSideChatCommand(input)).toBeNull();
  });

  it('stays reserved for providers without fork support so it never reaches provider chat', () => {
    expect(detectSideChatCommand('/side explore')).toEqual({
      alias: 'side',
      argument: 'explore',
    });
    expect(isSideChatCommandSupported(forkIncapable)).toBe(false);
    expect(isSideChatCommandSupported(forkCapable)).toBe(true);
  });

  it.each(['\n', '\r', '\u2028', '\u2029'])('keeps the built-in matcher single-line for %j', separator => {
    expect(detectBuiltInCommand('/side explore', forkCapable))
      .toMatchObject({ args: 'explore', command: { action: 'side' } });
    expect(detectBuiltInCommand('/side line one\nline two', forkCapable)).toBeNull();
    expect(detectBuiltInCommand(`/clear line one${separator}line two`, forkCapable)).toBeNull();
    expect(detectBuiltInCommand(`/clear${separator}Explain this command`, forkCapable)).toBeNull();
  });

  it('admits a command whose separator is ordinary whitespace and tolerates outer line breaks', () => {
    expect(detectBuiltInCommand('/clear Explain this command', forkCapable))
      .toMatchObject({ args: 'Explain this command', command: { action: 'clear' } });
    expect(detectBuiltInCommand('/clear\tExplain this command', forkCapable))
      .toMatchObject({ args: 'Explain this command', command: { action: 'clear' } });
    expect(detectBuiltInCommand('\n/clear\n'))
      .toMatchObject({ args: '', command: { action: 'clear' } });
  });
});
