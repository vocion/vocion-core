import { describe, expect, it } from 'vitest';
import { canBePersonal, CONNECTOR_KIND_NAME, kindOfWorkspace, wrongKindLine } from './connectorKinds';

describe('the two kinds of connector', () => {
  it('names them once: Team connectors and Personal connectors', () => {
    expect(CONNECTOR_KIND_NAME).toEqual({ team: 'Team connectors', personal: 'Personal connectors' });
  });

  it('a Personal workspace holds personal connectors; every other workspace holds team ones', () => {
    expect(kindOfWorkspace('personal')).toBe('personal');
    expect(kindOfWorkspace('shared')).toBe('team');
    expect(kindOfWorkspace(undefined)).toBe('team');
  });

  it('only the person\'s own mail, calendar, files, DMs and GitHub can be personal', () => {
    expect(['gmail', 'google-calendar', 'drive', 'slack', 'github'].every(canBePersonal)).toBe(true);
    expect(canBePersonal('hubspot')).toBe(false);
  });

  it('says in one line which kind a request needs, who reads it and where it is connected', () => {
    expect(wrongKindLine({ name: 'HubSpot', needs: 'team', href: '/w/northwind/dashboard/connectors' }))
      .toBe('HubSpot is a team connector — your team\'s agents use it, and an admin connects it. Connect it in [Team connectors](/w/northwind/dashboard/connectors).');
    expect(wrongKindLine({ name: 'Your own Gmail', needs: 'personal' }))
      .toBe('Your own Gmail is a personal connector — only your personal assistant reads it, and only you can connect it. Connect it in Personal connectors.');
  });
});
