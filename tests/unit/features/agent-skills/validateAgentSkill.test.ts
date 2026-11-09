import {
  AgentSkillValidationError,
  validateAgentSkillInput,
  validateAgentSkillName,
} from '@/features/agent-skills/validateAgentSkill';

describe('validateAgentSkill', () => {
  it.each(['skill', 'skill-2', 'a', 'a'.repeat(64), 'aux-tools', 'com10', 'lpt0'])('accepts portable name %s', name => {
    expect(validateAgentSkillName(name)).toBeNull();
  });

  it.each([
    '', '-skill', 'skill-', 'skill--name', 'Skill', 'skill_name', 'skill/name',
    'con', 'prn', 'aux', 'nul',
    ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
    ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
    'a'.repeat(65), 'true', 'false', 'null', 'yes', 'no', 'on', 'off',
  ])('rejects non-portable name %s', name => {
    expect(validateAgentSkillName(name)).not.toBeNull();
  });

  it('requires a non-empty description no longer than 1024 characters', () => {
    expect(() => validateAgentSkillInput({
      name: 'portable-skill',
      description: '   ',
      instructions: 'Do the work.',
    })).toThrow(AgentSkillValidationError);

    expect(() => validateAgentSkillInput({
      name: 'portable-skill',
      description: 'a'.repeat(1025),
      instructions: 'Do the work.',
    })).toThrow('1024');
  });

  it('requires non-empty instructions', () => {
    expect(() => validateAgentSkillInput({
      name: 'portable-skill',
      description: 'Portable skill',
      instructions: '\n\t ',
    })).toThrow('instructions');
  });

  it('accepts trimmed boundary values', () => {
    expect(() => validateAgentSkillInput({
      name: 'portable-skill',
      description: ` ${'a'.repeat(1024)} `,
      instructions: ' Do the work. ',
    })).not.toThrow();
  });
});
