// Passkeys belong to the domain of APP_URL, the relying party. Under another
// domain they stop working and users log in by mail once (README, „Passkeys“).
export function relyingParty() {
  const url = new URL(process.env.APP_URL);
  return { rpID: url.hostname, origins: [url.origin] };
}
