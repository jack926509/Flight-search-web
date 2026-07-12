export interface ExternalCostInput {
  directPrice: number | null;
  mainTicketPrice: number;
  positioningTicketPrice: number | null;
  baggageCost: number;
  lodgingCost: number;
  transferCost: number;
  reserveCost: number;
}

export interface ExternalCostResult {
  total: number | null;
  saving: number | null;
  verdict: "needs-positioning" | "worth-considering" | "limited-saving" | "not-worth-it";
}

export function calculateExternalCost(input: ExternalCostInput): ExternalCostResult {
  if (input.positioningTicketPrice === null || input.positioningTicketPrice <= 0) {
    return { total: null, saving: null, verdict: "needs-positioning" };
  }

  const total = input.mainTicketPrice + input.positioningTicketPrice + input.baggageCost
    + input.lodgingCost + input.transferCost + input.reserveCost;
  const saving = input.directPrice === null ? null : input.directPrice - total;
  const verdict = saving === null
    ? "limited-saving"
    : saving <= 0
      ? "not-worth-it"
      : saving < 3_000
        ? "limited-saving"
        : "worth-considering";
  return { total, saving, verdict };
}
