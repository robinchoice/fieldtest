import { decode } from 'light-bolt11-decoder';

type Proof = { invoice?: string; paymentHash?: string; preimage: string };

// Checks the runner's payment proof: the preimage has to hash to the invoice's
// payment hash, and the invoice has to be for the claimed amount. Runners in
// test mode send a hash without invoice, only accepted with ALLOW_FAKE_PAYMENTS.
export function checkPayment(proof: Proof, amountSats: number, allowFake: boolean) {
  let hash = proof.paymentHash;
  if (proof.invoice) {
    try {
      const sections = decode(proof.invoice).sections;
      hash = sections.find((s) => s.name === 'payment_hash')?.value as string | undefined;
      const msat = sections.find((s) => s.name === 'amount')?.value;
      if (Number(msat) !== amountSats * 1000) return 'invoiceAmountWrong';
    } catch {
      return 'paymentProofInvalid';
    }
  } else if (!allowFake) {
    return 'paymentProofInvalid';
  }
  const preimageHash = new Bun.CryptoHasher('sha256').update(Buffer.from(proof.preimage, 'hex')).digest('hex');
  return hash && preimageHash === hash ? 'ok' : 'paymentProofInvalid';
}
