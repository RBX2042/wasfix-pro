"use client";
import dynamic from "next/dynamic";

const PartViewer3D = dynamic(() => import("./PartViewer3D"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-72 md:h-96 bg-muted animate-pulse rounded-xl" />
  ),
});

export default function PartViewer3DWrapper({ category }: { category?: string }) {
  return <PartViewer3D category={category} />;
}
