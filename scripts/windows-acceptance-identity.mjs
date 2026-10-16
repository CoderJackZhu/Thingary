export const defaultAcceptanceIdentity = 'local.thingary.win.acceptance';

export function isAcceptanceIdentity(identity) {
  return typeof identity === 'string' && /^local\.thingary\.win\.acceptance(?:\.[a-z0-9][a-z0-9-]{0,31})?$/.test(identity);
}

export function acceptanceProfile(identity = defaultAcceptanceIdentity) {
  if (!isAcceptanceIdentity(identity)) throw new Error('Only an isolated Windows acceptance identity is allowed.');
  const suffix = identity.slice(defaultAcceptanceIdentity.length + 1);
  return {
    identity,
    productName: 'Thingary Windows Acceptance' + (suffix ? ' ' + suffix : ''),
    outputName: 'acceptance' + (suffix ? '-' + suffix : ''),
  };
}
