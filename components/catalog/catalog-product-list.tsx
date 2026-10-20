"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { LoaderCircleIcon } from "lucide-react";

import { ProductCard } from "@/components/catalog/product-card";
import { CatalogDeletePack } from "@/components/catalog/catalog-delete-pack";
import {
  collectCatalogPages,
  mergeUnique,
  requestNextCatalogPage,
} from "@/components/catalog/catalog-product-list-pages";
import { rememberOfflineProducts } from "@/lib/offline/cache";
import { accountGlanceAlreadyQueued } from "@/lib/inventory/format";
import type {
  CatalogListingFilter,
  InventoryProduct,
} from "@/lib/inventory/types";
import type { ProductStatus } from "@/lib/validations";

function queueableIds(products: InventoryProduct[], accountId: string | null) {
  if (!accountId) return products.map((product) => product.id);
  return products
    .filter((product) => {
      const row = product.accountStates?.find(
        (state) => state.accountId === accountId,
      );
      return !row || !accountGlanceAlreadyQueued(row);
    })
    .map((product) => product.id);
}

function toggleId(selected: Set<string>, id: string) {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function CatalogMoreStatus({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <p
        className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground"
        aria-live="polite"
      >
        <LoaderCircleIcon className="size-4 animate-spin" />
        Cargando más…
      </p>
    );
  }
  if (!error) return null;
  return (
    <div className="flex flex-col items-center gap-2 py-3" role="alert">
      <p className="text-sm text-destructive">{error}</p>
      <button
        type="button"
        className="h-11 rounded-full bg-muted px-4 text-sm font-semibold"
        onClick={onRetry}
      >
        Reintentar
      </button>
    </div>
  );
}

function CatalogProductGrid({
  products,
  view,
  selecting,
  selected,
  focusAccountId,
  onToggle,
  onHold,
}: {
  products: InventoryProduct[];
  view: "grid" | "list";
  selecting: boolean;
  selected: Set<string>;
  focusAccountId: string | null;
  onToggle: (id: string) => void;
  onHold: (id: string) => void;
}) {
  if (view === "grid") {
    return (
      <div className="grid auto-rows-fr grid-cols-2 items-stretch gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {products.map((product, index) => (
          <ProductCard
            key={product.id}
            product={product}
            view="grid"
            priority={index === 0}
            selecting={selecting}
            selected={selected.has(product.id)}
            focusAccountId={focusAccountId}
            onToggle={() => onToggle(product.id)}
            onHold={() => onHold(product.id)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {products.map((product, index) => (
        <ProductCard
          key={product.id}
          product={product}
          view="list"
          priority={index === 0}
          selecting={selecting}
          selected={selected.has(product.id)}
          focusAccountId={focusAccountId}
          onToggle={() => onToggle(product.id)}
          onHold={() => onHold(product.id)}
        />
      ))}
    </div>
  );
}

type CatalogListProps = {
  initialProducts: InventoryProduct[];
  total: number;
  q: string;
  status: "ALL" | ProductStatus;
  listing?: CatalogListingFilter;
  view: "grid" | "list";
  extraProducts?: InventoryProduct[];
};

function markQueued(
  product: InventoryProduct,
  queued: Set<string>,
  accountId: string,
): InventoryProduct {
  if (!queued.has(product.id)) return product;
  return {
    ...product,
    status: product.status === "SOLD" ? "ACTIVE" : product.status,
    soldAccountId: product.status === "SOLD" ? null : product.soldAccountId,
    accountStates: product.accountStates?.map((state) =>
      state.accountId === accountId
        ? { ...state, status: "READY_TO_POST", externalUrl: null }
        : state,
    ),
  };
}

function useCatalogSentinel(input: {
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  page: number;
  q: string;
  status: "ALL" | ProductStatus;
  listing?: CatalogListingFilter;
  sentinelRef: RefObject<HTMLDivElement | null>;
  inFlight: RefObject<boolean>;
  generation: RefObject<number>;
  setLoading: (value: boolean) => void;
  setError: (value: string | null) => void;
  setDone: (value: boolean) => void;
  setPage: (value: number) => void;
  setItems: (update: (prev: InventoryProduct[]) => InventoryProduct[]) => void;
}) {
  const {
    hasMore,
    loading,
    error,
    page,
    q,
    status,
    listing,
    sentinelRef,
    inFlight,
    generation,
    setLoading,
    setError,
    setDone,
    setPage,
    setItems,
  } = input;
  useEffect(() => {
    if (!hasMore || loading || error) return;
    const node = sentinelRef.current;
    if (!node) return;
    const query = { q, status, listing };
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || inFlight.current) return;
        requestNextCatalogPage({
          page,
          query,
          generation: generation.current,
          currentGeneration: () => generation.current,
          inFlight,
          setLoading,
          setError,
          setDone,
          setPage,
          setItems,
        });
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [
    hasMore,
    loading,
    error,
    page,
    q,
    status,
    listing,
    sentinelRef,
    inFlight,
    generation,
    setLoading,
    setError,
    setDone,
    setPage,
    setItems,
  ]);
}

async function selectEntireCatalog(input: {
  selectingAll: boolean;
  inFlight: RefObject<boolean>;
  generation: RefObject<number>;
  items: InventoryProduct[];
  page: number;
  done: boolean;
  total: number;
  query: { q: string; status: "ALL" | ProductStatus; listing?: CatalogListingFilter };
  extraProducts: InventoryProduct[];
  queueAccountId: string | null;
  setSelectingAll: (value: boolean) => void;
  setSelecting: (value: boolean) => void;
  setError: (value: string | null) => void;
  setItems: (value: InventoryProduct[]) => void;
  setPage: (value: number) => void;
  setDone: (value: boolean) => void;
  setSelected: (value: Set<string>) => void;
}) {
  if (input.selectingAll || input.inFlight.current) return;
  input.setSelectingAll(true);
  input.setSelecting(true);
  input.inFlight.current = true;
  const gen = input.generation.current;
  try {
    const batch = await collectCatalogPages({
      startItems: input.items,
      startPage: input.page,
      startDone: input.done,
      total: input.total,
      query: input.query,
      isCurrent: () => gen === input.generation.current,
    });
    if (batch.aborted || gen !== input.generation.current) return;
    if (batch.error) input.setError(batch.error);
    input.setItems(batch.items);
    input.setPage(batch.page);
    if (batch.done) input.setDone(true);
    const shown = mergeUnique(batch.items, input.extraProducts);
    input.setSelected(new Set(queueableIds(shown, input.queueAccountId)));
  } catch {
    if (gen === input.generation.current) {
      input.setError("No se han podido cargar más productos.");
    }
  } finally {
    if (gen === input.generation.current) {
      input.inFlight.current = false;
      input.setSelectingAll(false);
    }
  }
}

export function CatalogProductList({
  initialProducts,
  total,
  q,
  status,
  listing,
  view,
  extraProducts = [],
}: CatalogListProps) {
  const [items, setItems] = useState(initialProducts);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initialProducts.length >= total);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queueAccountId, setQueueAccountId] = useState<string | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const query = { q, status, listing };

  useEffect(() => {
    rememberOfflineProducts(items);
  }, [items]);

  const displayed = mergeUnique(items, extraProducts);
  const hasMore = !done && items.length < total;
  useCatalogSentinel({
    hasMore,
    loading,
    error,
    page,
    q,
    status,
    listing,
    sentinelRef,
    inFlight,
    generation,
    setLoading,
    setError,
    setDone,
    setPage,
    setItems,
  });

  return (
    <CatalogDeletePack
      products={displayed}
      selecting={selecting}
      selected={selected}
      queueAccountId={queueAccountId}
      onQueueAccountId={setQueueAccountId}
      onSelectingChange={setSelecting}
      onSelectedChange={setSelected}
      onRemoved={(ids) => {
        setItems((prev) => prev.filter((product) => !ids.includes(product.id)));
      }}
      onSelectAll={() => {
        void selectEntireCatalog({
          selectingAll,
          inFlight,
          generation,
          items,
          page,
          done,
          total,
          query,
          extraProducts,
          queueAccountId,
          setSelectingAll,
          setSelecting,
          setError,
          setItems,
          setPage,
          setDone,
          setSelected,
        });
      }}
      selectAllPending={selectingAll}
      onQueued={(ids, accountId) => {
        const queued = new Set(ids);
        setItems((prev) =>
          prev.map((product) => markQueued(product, queued, accountId)),
        );
      }}
    >
      <CatalogProductGrid
        products={displayed}
        view={view}
        selecting={selecting}
        selected={selected}
        focusAccountId={queueAccountId}
        onToggle={(id) =>
          setSelected((prev) => {
            const next = toggleId(prev, id);
            if (next.size === 0) setSelecting(false);
            return next;
          })
        }
        onHold={(id) => {
          setSelecting(true);
          setSelected(new Set([id]));
        }}
      />
      {hasMore ? <div ref={sentinelRef} className="h-8" aria-hidden /> : null}
      <CatalogMoreStatus
        loading={loading}
        error={error}
        onRetry={() => setError(null)}
      />
    </CatalogDeletePack>
  );
}
