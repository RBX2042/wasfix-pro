"use client";
import * as React from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartItem = {
  partId: string;
  sku: string;
  name: string;
  brand: string;
  priceEur: number;
  imageUrl?: string | null;
  quantity: number;
};

type CartState = {
  items: CartItem[];
  isOpen: boolean;
  add: (item: Omit<CartItem, "quantity">, qty?: number) => void;
  remove: (partId: string) => void;
  setQty: (partId: string, qty: number) => void;
  clear: () => void;
  setOpen: (open: boolean) => void;
};

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      isOpen: false,
      add: (item, qty = 1) =>
        set((s) => {
          // Match on SKU (stable), not partId (changes when DB is reseeded)
          const existing = s.items.find((i) => i.sku === item.sku);
          if (existing) {
            return {
              items: s.items.map((i) =>
                i.sku === item.sku ? { ...i, quantity: i.quantity + qty, partId: item.partId } : i
              ),
              isOpen: true,
            };
          }
          return { items: [...s.items, { ...item, quantity: qty }], isOpen: true };
        }),
      remove: (partId) => set((s) => ({ items: s.items.filter((i) => i.partId !== partId && i.sku !== partId) })),
      setQty: (partId, qty) =>
        set((s) => ({
          items:
            qty <= 0
              ? s.items.filter((i) => i.partId !== partId && i.sku !== partId)
              : s.items.map((i) => (i.partId === partId || i.sku === partId ? { ...i, quantity: qty } : i)),
        })),
      clear: () => set({ items: [] }),
      setOpen: (isOpen) => set({ isOpen }),
    }),
    {
      name: "wasfix-cart",
      // Bump version when cart logic changes; old persisted carts get reset
      version: 2,
      migrate: () => ({ items: [], isOpen: false }),
    }
  )
);

export function CartProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function cartTotal(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.priceEur * i.quantity, 0);
}

export function cartCount(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity, 0);
}
