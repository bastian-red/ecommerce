import { formatMoney, type Product } from '@shop/shared';
import Link from 'next/link';

/** Total available stock across a product's variants. */
export function totalAvailable(product: Product): number {
  return product.variants.reduce((sum, variant) => sum + variant.availableStock, 0);
}

/**
 * `showStock` is off by default because the home page is ISR: a cached "3 in
 * stock" is a claim that can be a minute out of date. Listing pages that render
 * dynamically pass it, and the product page fetches live availability itself.
 */
export function ProductCard({ product, showStock = false }: { product: Product; showStock?: boolean }) {
  const available = totalAvailable(product);
  const image = product.images[0];

  return (
    <article className="card product-card" data-testid="product-card" data-slug={product.slug}>
      <Link href={`/products/${product.slug}`}>
        <div className="product-thumb">
          {image ? (
            <img src={image.url} alt={image.alt || product.title} />
          ) : (
            <span className="placeholder" aria-hidden="true">
              {product.title.slice(0, 2)}
            </span>
          )}
        </div>
        <div className="product-body">
          <h3>{product.title}</h3>
          <span className="product-meta">{product.category?.name ?? 'Uncategorised'}</span>
          <span className="price">{formatMoney(product.fromPriceCents)}</span>
          {showStock && (
            <span className="product-meta" data-testid="availability">
              {available > 0 ? `${available} in stock` : 'Sold out'}
            </span>
          )}
        </div>
      </Link>
    </article>
  );
}
