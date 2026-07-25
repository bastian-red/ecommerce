import { formatMoney, type Product } from '@shop/shared';
import { notFound } from 'next/navigation';
import { CreateVariantForm, StatusSelect } from '../../../../components/product-admin-forms';
import { ApiError, apiFetch } from '../../../../lib/api';

export const dynamic = 'force-dynamic';

export default async function AdminProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let product: Product;
  try {
    product = await apiFetch<Product>(`/admin/products/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <>
      <div className="row between">
        <h2>{product.title}</h2>
        <StatusSelect product={product} />
      </div>
      <p className="product-meta">
        {product.slug} · {product.category?.name ?? 'Uncategorised'}
      </p>

      <div className="shop-layout" style={{ gridTemplateColumns: '1fr 340px' }}>
        <section>
          <h3>Variants</h3>
          {product.variants.length === 0 ? (
            <p className="empty">No variants yet. A product with no variant cannot be bought.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>SKU</th>
                  <th className="num">Price</th>
                  <th className="num">Available</th>
                </tr>
              </thead>
              <tbody>
                {product.variants.map((variant) => (
                  <tr key={variant.id} data-testid="admin-variant-row" data-sku={variant.sku}>
                    <td>{variant.name}</td>
                    <td className="mono">{variant.sku}</td>
                    <td className="num">{formatMoney(variant.priceCents)}</td>
                    <td className="num">{variant.availableStock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <aside>
          <CreateVariantForm product={product} />
        </aside>
      </div>
    </>
  );
}
