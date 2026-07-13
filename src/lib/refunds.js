// Compares cumulative actuals against agreed targets rather than exact-match/null
// checks, so a refund with partial progress on both sides — or settled in
// multiple installments — still derives the right status. A side with no
// agreed target (null) is trivially treated as done, since there's nothing
// left to collect/pay on it.
export function deriveRefundStatus(receivable, payable, received, paid) {
  const supplierDone = receivable == null || (received ?? 0) >= receivable
  const clientDone = payable == null || (paid ?? 0) >= payable
  if (supplierDone && clientDone) return "closed"
  if (supplierDone) return "supplier_refunded"
  if (clientDone) return "client_refunded"
  return "initiated"
}
