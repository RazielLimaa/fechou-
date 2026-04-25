export type PublicPaymentKind = "proposal" | "contract";

export type PublicPaymentReference = {
  kind: PublicPaymentKind;
  resourceId: number;
  ownerId: number;
  tokenPrefix: string;
};

export function buildPublicPaymentExternalReference(
  kind: PublicPaymentKind,
  resourceId: number,
  ownerId: number,
  tokenHash: string,
) {
  return `${kind}:${resourceId}:owner:${ownerId}:token:${tokenHash.slice(0, 20)}`;
}

export function parsePublicPaymentExternalReference(raw: string): PublicPaymentReference | null {
  const match = String(raw ?? "")
    .trim()
    .match(/^(proposal|contract):(\d+):owner:(\d+):token:([a-f0-9]{1,64})$/i);

  if (!match) return null;

  return {
    kind: match[1].toLowerCase() as PublicPaymentKind,
    resourceId: Number(match[2]),
    ownerId: Number(match[3]),
    tokenPrefix: match[4].toLowerCase(),
  };
}

export function buildSecureCheckoutIntentExternalReference(checkoutIntentId: string) {
  return `mpci:${checkoutIntentId}`;
}

export function parseSecureCheckoutIntentExternalReference(raw: string) {
  const match = String(raw ?? "")
    .trim()
    .match(/^mpci:([a-f0-9-]{36})$/i);

  return match?.[1]?.toLowerCase() ?? null;
}

export function parseLegacyProposalExternalReference(raw: string) {
  const match = String(raw ?? "")
    .trim()
    .match(/^fechou:(\d+)$/i);

  return match ? Number(match[1]) : null;
}
