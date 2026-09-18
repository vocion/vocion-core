import { describe, expect, it } from 'vitest';
import { matchSlashCommands, parseSlashCommand, slashQuery } from './slashCommands';

describe('slash commands', () => {
  it('opens the menu only for a slash alone at the start of the draft', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/ne')).toBe('ne');
    expect(slashQuery('/search hello')).toBeNull();
    expect(slashQuery('what is 1/2')).toBeNull();
    expect(slashQuery(' /new')).toBeNull();
  });

  it('matches by name and by alias — /clear is /new', () => {
    expect(matchSlashCommands('').map(c => c.name)).toEqual(['new', 'history', 'search']);
    expect(matchSlashCommands('cl').map(c => c.name)).toEqual(['new']);
    expect(matchSlashCommands('con').map(c => c.name)).toEqual(['history']);
    expect(matchSlashCommands('zzz')).toEqual([]);
  });

  it('runs /new, /clear and /history as commands, never as messages', () => {
    expect(parseSlashCommand('/new')?.action).toBe('new-chat');
    expect(parseSlashCommand('/clear ')?.action).toBe('new-chat');
    expect(parseSlashCommand('/history')?.action).toBe('all-conversations');
  });

  it('leaves /search and ordinary text to the send path', () => {
    expect(parseSlashCommand('/search stale deals')).toBeNull();
    expect(parseSlashCommand('/search')).toBeNull();
    expect(parseSlashCommand('/newish idea')).toBeNull();
    expect(parseSlashCommand('hello')).toBeNull();
  });

  it('shows the hotkey beside the verb it shares', () => {
    expect(matchSlashCommands('new')[0]?.shortcut).toBe('⌘⇧O');
  });
});
