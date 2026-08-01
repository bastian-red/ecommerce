import type { StockLedgerEntry } from '@shop/shared';
import { apiFetch } from '../../../lib/api';

export const dynamic = 'force-dynamic';

function delta(value: number): { text: string; className: string } {
  if (value === 0) return { text: '0', className: 'muted' };
  return {
    text: value > 0 ? `+${value}` : String(value),
    className: value > 0 ? 'delta-pos' : 'delta-neg',
  };
}

export default async function AdminLedgerPage() {
  const entries = await apiFetch<StockLedgerEntry[]>('/admin/ledger');

  return (
    <>
      <h1>Stock ledger</h1>
      <p className="muted">
        Append-only, one row per movement. Summing on-hand deltas for a variant reconstructs its
        stock from zero, which is how a lost update would be caught.
      </p>
      {entries.length === 0 ? (
        <p className="empty">No movements yet</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>SKU</th>
              <th>Movement</th>
              <th className="num">On hand</th>
              <th className="num">Reserved</th>
              <th>Order</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const onHand = delta(entry.onHandDelta);
              const reserved = delta(entry.reservedDelta);
              return (
                <tr key={entry.id} data-testid="ledger-row" data-kind={entry.kind}>
                  <td className="mono">{entry.createdAt.slice(0, 19).replace('T', ' ')}</td>
                  <td className="mono">{entry.sku}</td>
                  <td>
                    <span className="badge">{entry.kind}</span>
                  </td>
                  <td className={`num ${onHand.className}`}>{onHand.text}</td>
                  <td className={`num ${reserved.className}`}>{reserved.text}</td>
                  <td className="mono">{entry.orderNumber ?? '-'}</td>
                  <td className="muted">{entry.reason || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
