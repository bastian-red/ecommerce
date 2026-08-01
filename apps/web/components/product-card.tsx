import { formatMoney, type Product } from '@shop/shared';
import Link from 'next/link';

/** Total available stock across a product's variants. */
export function totalAvailable(product: Product): number {
  return product.variants.reduce((sum, variant) => sum + variant.availableStock, 0);
}

/**
 * A product, as a photograph with a caption.
 *
 * The card has no border, no background and no shadow. On a page whose subject
 * is the product, each of those is chrome competing with the thing being sold —
 * the image is the interface and the rest is only a caption under it.
 *
 * The thumb holds a fixed 4:5 ratio, so a slow image never reflows the grid
 * under a shopper's cursor.
 *
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
            <img src={image.url} alt={image.alt || product.title} loading="lazy" />
          ) : (
            // The two-letter fallback for a product with no photograph. Painted
            // in --muted rather than a border colour: it is real text, and the
            // axe baseline caught 23 nodes of it below 4.5:1.
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
