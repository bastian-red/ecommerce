import { formatMoney, type Category, type Product } from '@shop/shared';
import Link from 'next/link';
import { CreateProductForm, StatusSelect } from '../../../components/product-admin-forms';
import { apiFetch, publicApiFetch } from '../../../lib/api';

export const dynamic = 'force-dynamic';

export default async function AdminProductsPage() {
  const [products, categories] = await Promise.all([
    apiFetch<Product[]>('/admin/products'),
    publicApiFetch<Category[]>('/categories'),
  ]);

  return (
    <>
      <h1>Products</h1>
      <div className="shop-layout" style={{ gridTemplateColumns: '1fr 340px' }}>
        <section>
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Slug</th>
                <th className="num">Variants</th>
                <th className="num">From</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} data-testid="admin-product-row" data-slug={product.slug}>
                  <td>
                    <Link href={`/admin/products/${product.id}`}>{product.title}</Link>
                  </td>
                  <td className="mono">{product.slug}</td>
                  <td className="num">{product.variants.length}</td>
                  <td className="num">{formatMoney(product.fromPriceCents)}</td>
                  <td>
                    <StatusSelect product={product} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <aside>
          <CreateProductForm categories={categories} />
        </aside>
      </div>
    </>
  );
}
