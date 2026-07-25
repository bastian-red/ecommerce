import type { AdminStockView } from '@shop/shared';
import { StockControls } from '../../../components/stock-controls';
import { apiFetch } from '../../../lib/api';

export const dynamic = 'force-dynamic';

export default async function AdminStockPage() {
  const stock = await apiFetch<AdminStockView[]>('/admin/stock');

  return (
    <>
      <h2>Stock</h2>
      <p className="muted">
        On hand is physical inventory. Reserved is the part of it promised to open orders.
        Available is what a new order can still claim. Every change here writes a ledger row.
      </p>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>SKU</th>
            <th className="num">On hand</th>
            <th className="num">Reserved</th>
            <th className="num">Available</th>
            <th>Change</th>
          </tr>
        </thead>
        <tbody>
          {stock.map((row) => (
            <tr key={row.variantId} data-testid="stock-row" data-sku={row.sku}>
              <td>
                {row.productTitle} <span className="muted">{row.variantName}</span>
              </td>
              <td className="mono">{row.sku}</td>
              <td className="num" data-testid={`onhand-${row.sku}`}>
                {row.stockOnHand}
              </td>
              <td className="num" data-testid={`reserved-${row.sku}`}>
                {row.stockReserved}
              </td>
              <td className="num" data-testid={`available-${row.sku}`}>
                {row.availableStock}
              </td>
              <td>
                <StockControls variantId={row.variantId} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
