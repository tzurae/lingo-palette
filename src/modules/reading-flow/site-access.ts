import { scriptIdFor } from './site-permission';

export type SiteAccessDependencies = {
  removePermission(match: string): Promise<boolean>;
  hasRegistration(id: string): Promise<boolean>;
  unregister(id: string): Promise<void>;
};

export async function revokeEnabledSite(
  origin: string,
  dependencies: SiteAccessDependencies,
): Promise<boolean> {
  const removed = await dependencies.removePermission(`${origin}/*`);
  if (!removed) return false;

  const id = scriptIdFor(origin);
  if (await dependencies.hasRegistration(id)) {
    await dependencies.unregister(id);
  }
  return true;
}
