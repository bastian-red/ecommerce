import { formatMoney, type Product } from '@shop/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AddToCart } from '@/components/add-to-cart';
import { ApiError, cachedApiFetch } from '@/lib/api';

// ISR again, tagged so an admin edit invalidates exactly this page's data.
export const revalidate = 60;

// Route props are typed as Promises throughout this app. That is the Next 15
// signature, and it is already correct on the pinned 14.2: `await` on a
// non-thenable returns it unchanged, so the code runs identically on both and
// does not need rewriting at the next major.

async function loadProduct(slug: string): Promise<Product | null> {
  try {
    return await cachedApiFetch<Product>(`/products/${slug}`, ['catalog', `product:${slug}`]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await loadProduct(slug);
  if (!product) return { title: 'Not found' };
  return {
    title: `${product.title} — Shop`,
    // Truncated rather than passed whole: a description meta tag with 5000
    // characters in it is worse than none.
    description: product.description.slice(0, 160),
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await loadProduct(slug);
  if (!product) notFound();

  const image = product.images[0];

  return (
    <main className="container-wide">
      {/* Gallery left, buy panel right and sticky. On a long description the
          "Add to cart" button would otherwise scroll off, and a shopper who has
          decided should never have to scroll back up to act on it. */}
      <div className="product-detail">
        <div className="gallery">
          {image ? (
            <img src={image.url} alt={image.alt || product.title} />
          ) : (
            <div className="product-thumb">
              <span className="placeholder" aria-hidden="true">
                {product.title.slice(0, 2)}
              </span>
            </div>
          )}
        </div>

        <div className="buy-panel">
          <div>
            <span className="eyebrow">{product.category?.name ?? 'Uncategorised'}</span>
            <h1 data-testid="product-title">{product.title}</h1>
            <p className="price" data-testid="product-price">
              {formatMoney(product.fromPriceCents)}
            </p>
          </div>
          <p className="muted">{product.description}</p>
          <AddToCart variants={product.variants} slug={product.slug} />
        </div>
      </div>
    </main>
  );
}
