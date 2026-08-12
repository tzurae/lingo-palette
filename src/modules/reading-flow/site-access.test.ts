import { describe, expect, it, vi } from 'vitest';
import { revokeEnabledSite } from './site-access';

describe('Enabled Site revocation', () => {
  it('removes only the exact origin and unregisters its persistent script', async () => {
    const removePermission = vi.fn(async () => true);
    const hasRegistration = vi.fn(async () => true);
    const unregister = vi.fn(async () => undefined);

    await expect(
      revokeEnabledSite('https://reading.example', {
        removePermission,
        hasRegistration,
        unregister,
      }),
    ).resolves.toBe(true);

    expect(removePermission).toHaveBeenCalledWith('https://reading.example/*');
    expect(hasRegistration).toHaveBeenCalledWith(
      'enabled_site_68747470733a2f2f72656164696e672e6578616d706c65',
    );
    expect(unregister).toHaveBeenCalledWith(
      'enabled_site_68747470733a2f2f72656164696e672e6578616d706c65',
    );
  });

  it('leaves script registration untouched when permission removal is denied', async () => {
    const hasRegistration = vi.fn(async () => true);
    const unregister = vi.fn(async () => undefined);

    await expect(
      revokeEnabledSite('https://reading.example', {
        async removePermission() {
          return false;
        },
        hasRegistration,
        unregister,
      }),
    ).resolves.toBe(false);

    expect(hasRegistration).not.toHaveBeenCalled();
    expect(unregister).not.toHaveBeenCalled();
  });
});
