'use client';

import type { Category, Product } from '@shop/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { adminCreateProduct, adminCreateVariant, adminUpdateProductStatus } from '../app/actions';

export function CreateProductForm({ categories }: { categories: Category[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="card"
      action={(formData: FormData) => {
        setError(null);
        startTransition(async () => {
          const result = await adminCreateProduct(formData);
          if (result.error) setError(result.error);
          else router.refresh();
        });
      }}
    >
      <h3>New product</h3>
      <label htmlFor="title">Title</label>
      <input id="title" name="title" required data-testid="product-title-input" />
      <label htmlFor="slug">Slug (kebab-case)</label>
      <input id="slug" name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" data-testid="product-slug-input" />
      <label htmlFor="description">Description</label>
      <textarea id="description" name="description" rows={3} data-testid="product-description-input" />
      <label htmlFor="categoryId">Category</label>
      <select id="categoryId" name="categoryId" defaultValue="">
        <option value="">None</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
      <label htmlFor="status">Status</label>
      {/* Draft by default: a product with no variants and no price should never
          be one careless click away from the storefront. */}
      <select id="status" name="status" defaultValue="DRAFT" data-testid="product-status-input">
        <option value="DRAFT">Draft</option>
        <option value="ACTIVE">Active</option>
      </select>
      <button type="submit" className="btn btn-primary" style={{ marginTop: 16 }} disabled={pending} data-testid="create-product">
        {pending ? 'Creating…' : 'Create product'}
      </button>
      {error && (
        <p className="error" data-testid="create-product-error">
          {error}
        </p>
      )}
    </form>
  );
}

export function CreateVariantForm({ product }: { product: Product }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="card"
      action={(formData: FormData) => {
        setError(null);
        startTransition(async () => {
          const result = await adminCreateVariant(product.id, formData);
          if (result.error) setError(result.error);
          else router.refresh();
        });
      }}
    >
      <h3>Add a variant to {product.title}</h3>
      <label htmlFor={`sku-${product.id}`}>SKU</label>
      <input id={`sku-${product.id}`} name="sku" required style={{ textTransform: 'uppercase' }} data-testid="variant-sku-input" />
      <label htmlFor={`name-${product.id}`}>Name</label>
      <input id={`name-${product.id}`} name="name" required data-testid="variant-name-input" />
      <label htmlFor={`price-${product.id}`}>Price (cents)</label>
      {/* Cents, not dollars, all the way to the input. Converting in the browser
          is where a float sneaks into money. */}
      <input id={`price-${product.id}`} name="priceCents" type="number" min={0} required data-testid="variant-price-input" />
      <label htmlFor={`stock-${product.id}`}>Initial stock</label>
      <input id={`stock-${product.id}`} name="stockOnHand" type="number" min={0} defaultValue={0} data-testid="variant-stock-input" />
      <button type="submit" className="btn btn-primary" style={{ marginTop: 16 }} disabled={pending} data-testid="create-variant">
        {pending ? 'Adding…' : 'Add variant'}
      </button>
      {error && (
        <p className="error" data-testid="create-variant-error">
          {error}
        </p>
      )}
    </form>
  );
}

export function StatusSelect({ product }: { product: Product }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <select
      value={product.status}
      disabled={pending}
      // One select per row, so a visible <label> would repeat "Status" down the
      // whole table. The name has to say which product it belongs to anyway:
      // "Status" alone tells a screen-reader user nothing about which of eight
      // rows they are on. The axe baseline flagged all eight as unnamed.
      aria-label={`Status for ${product.title}`}
      data-testid={`status-${product.slug}`}
      onChange={(event) => {
        const status = event.target.value as 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
        startTransition(async () => {
          await adminUpdateProductStatus(product.id, status);
          router.refresh();
        });
      }}
    >
      <option value="DRAFT">Draft</option>
      <option value="ACTIVE">Active</option>
      <option value="ARCHIVED">Archived</option>
    </select>
  );
}
