import { productQuerySchema, type Category, type ProductList } from '@shop/shared';
import Link from 'next/link';
import { ProductCard } from '@/components/product-card';
import { publicApiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Rebuild the query string from validated values only.
 *
 * The parameters are parsed with the same contract the API uses before any of
 * them is echoed back into a link. A raw `searchParams` interpolated into an
 * href is a reflected-injection hole, and it also means a typo in a URL produces
 * a 500 instead of a sensible page.
 */
function buildQuery(params: Record<string, string | number | undefined>, overrides: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value !== undefined && value !== '' && value !== null) search.set(key, String(value));
  }
  search.delete('page');
  return search.toString();
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const parsed = productQuerySchema.safeParse({
    q: first(raw.q),
    category: first(raw.category),
    sort: first(raw.sort),
    page: first(raw.page),
    inStock: first(raw.inStock),
  });
  // A malformed query degrades to the default listing rather than an error page.
  const query = parsed.success ? parsed.data : productQuerySchema.parse({});

  const search = new URLSearchParams();
  if (query.q) search.set('q', query.q);
  if (query.category) search.set('category', query.category);
  if (query.inStock) search.set('inStock', 'true');
  search.set('sort', query.sort);
  search.set('page', String(query.page));
  search.set('perPage', String(query.perPage));

  const [list, categories] = await Promise.all([
    publicApiFetch<ProductList>(`/products?${search.toString()}`),
    publicApiFetch<Category[]>('/categories'),
  ]);

  const base = { q: query.q, category: query.category, sort: query.sort, inStock: query.inStock ? 'true' : undefined };

  return (
    <main className="container-wide">
      <div className="shop-layout">
        <aside className="filters">
          <form action="/products" method="get">
            <label htmlFor="q">Search</label>
            <input
              id="q"
              name="q"
              defaultValue={query.q ?? ''}
              placeholder="noise cancellation"
              data-testid="search-input"
            />
            {query.category && <input type="hidden" name="category" value={query.category} />}
            <label htmlFor="sort">Sort</label>
            <select id="sort" name="sort" defaultValue={query.sort}>
              <option value="newest">Newest</option>
              <option value="price_asc">Price, low to high</option>
              <option value="price_desc">Price, high to low</option>
              <option value="relevance">Relevance</option>
            </select>
            <label className="row" style={{ textTransform: 'none', letterSpacing: 0 }}>
              <input
                type="checkbox"
                name="inStock"
                value="true"
                defaultChecked={Boolean(query.inStock)}
                style={{ width: 'auto' }}
              />
              <span>In stock only</span>
            </label>
            <button type="submit" className="btn btn-primary" style={{ marginTop: 16, width: '100%' }}>
              Apply
            </button>
          </form>

          <label>Categories</label>
          <div className="filter-links">
            <Link href={`/products?${buildQuery(base, { category: undefined })}`} className={!query.category ? 'active' : ''}>
              All
            </Link>
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/products?${buildQuery(base, { category: category.slug })}`}
                className={query.category === category.slug ? 'active' : ''}
              >
                {category.name}
              </Link>
            ))}
          </div>
        </aside>

        <section>
          <div className="row between" style={{ marginBottom: 16 }}>
            <h1 style={{ fontSize: 24, margin: 0 }}>
              {query.q ? `Results for "${query.q}"` : 'Catalog'}
            </h1>
            <span className="product-meta" data-testid="result-count">
              {list.total} product{list.total === 1 ? '' : 's'}
            </span>
          </div>

          {list.items.length === 0 ? (
            <p className="empty" data-testid="no-results">
              Nothing matched
            </p>
          ) : (
            <div className="products">
              {list.items.map((product) => (
                <ProductCard key={product.id} product={product} showStock />
              ))}
            </div>
          )}

          {list.totalPages > 1 && (
            <div className="row" style={{ marginTop: 24, justifyContent: 'center' }}>
              {Array.from({ length: list.totalPages }, (_, index) => index + 1).map((page) => (
                <Link
                  key={page}
                  href={`/products?${buildQuery(base, {})}&page=${page}`}
                  className={`btn${page === list.page ? ' btn-primary' : ''}`}
                >
                  {page}
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
